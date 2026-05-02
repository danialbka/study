const DEFAULT_SETTINGS = {
  enabled: false,
  intervalMinutes: 60,
  sourceText: "JavaScript fundamentals",
  generatedFromSource: "",
  openRouterApiKey: "",
  questions: [
    {
      question: "What is one thing you remember about closures?",
      answer: "A closure lets a function remember variables from its outer scope."
    },
    {
      question: "Explain the difference between let and const.",
      answer: "let can be reassigned. const cannot be reassigned, though object contents can still mutate."
    }
  ]
};

const fields = {
  enabled: document.querySelector("#enabled"),
  intervalMinutes: document.querySelector("#intervalMinutes"),
  sourceText: document.querySelector("#sourceText"),
  openRouterApiKey: document.querySelector("#openRouterApiKey"),
  generateQuestions: document.querySelector("#generateQuestions"),
  cardSummary: document.querySelector("#cardSummary"),
  save: document.querySelector("#save"),
  testNow: document.querySelector("#testNow"),
  status: document.querySelector("#status"),
  nextQuiz: document.querySelector("#nextQuiz")
};

let currentQuestions = [];
let lastGeneratedSource = "";

init();

async function init() {
  const { settings, nextQuizAt } = await chrome.storage.local.get(["settings", "nextQuizAt"]);
  renderSettings(normalizeSettings(settings));
  renderNextQuiz(nextQuizAt);

  fields.save.addEventListener("click", saveSettings);
  fields.testNow.addEventListener("click", testNow);
  fields.generateQuestions.addEventListener("click", generateQuestions);
  fields.sourceText.addEventListener("input", renderSourceChangeState);
}

function renderSettings(settings) {
  fields.enabled.checked = Boolean(settings.enabled);
  fields.intervalMinutes.value = settings.intervalMinutes;
  fields.sourceText.value = settings.sourceText;
  fields.openRouterApiKey.value = settings.openRouterApiKey || "";
  renderCardSummary(settings.questions, settings.generatedFromSource);
}

async function saveSettings() {
  try {
    const settings = await prepareSettingsForSave();
    await chrome.storage.local.set({ settings });
    showStatus(settings.generatedFromSource === settings.sourceText ? "Saved with fresh flashcards" : "Saved");
    return true;
  } catch (error) {
    showStatus(error.message || "Could not save");
    return false;
  }
}

async function testNow() {
  const saved = await saveSettings();
  if (!saved) return;
  const response = await chrome.runtime.sendMessage({ type: "OPEN_TEST_QUIZ" });
  showStatus(response?.ok ? "Test quiz opened" : "Could not open test quiz");
}

async function generateQuestions() {
  const settings = readSettings();
  if (!settings.openRouterApiKey) {
    showStatus("Add your OpenRouter API key first");
    fields.openRouterApiKey.focus();
    return;
  }

  fields.generateQuestions.disabled = true;
  fields.generateQuestions.textContent = "Generating";
  showStatus("Generating question cards");

  try {
    const questions = await requestQuestionCards(settings);
    const generatedSettings = {
      ...settings,
      questions,
      generatedFromSource: settings.sourceText
    };
    await chrome.storage.local.set({
      settings: generatedSettings
    });
    renderCardSummary(questions, settings.sourceText);
    showStatus(`Generated ${questions.length} cards`);
  } catch (error) {
    showStatus(error.message || "Could not generate cards");
  } finally {
    fields.generateQuestions.disabled = false;
    fields.generateQuestions.textContent = "Generate flashcards";
  }
}

function readSettings() {
  return {
    enabled: fields.enabled.checked,
    intervalMinutes: clamp(Number(fields.intervalMinutes.value), 1, 10080),
    sourceText: fields.sourceText.value.trim() || DEFAULT_SETTINGS.sourceText,
    openRouterApiKey: fields.openRouterApiKey.value.trim(),
    questions: getCurrentQuestions(),
    generatedFromSource: fields.sourceText.value.trim() === lastGeneratedSource ? lastGeneratedSource : ""
  };
}

async function prepareSettingsForSave() {
  const settings = readSettings();
  if (!settings.openRouterApiKey) return settings;
  if (settings.generatedFromSource === settings.sourceText) return settings;

  setBusy(true);
  showStatus("Generating flashcards");

  try {
    const questions = await requestQuestionCards(settings);
    renderCardSummary(questions, settings.sourceText);
    return {
      ...settings,
      questions,
      generatedFromSource: settings.sourceText
    };
  } finally {
    setBusy(false);
  }
}

function normalizeSettings(settings = {}) {
  const migratedSource = settings.sourceText || settings.topic || DEFAULT_SETTINGS.sourceText;
  const merged = { ...DEFAULT_SETTINGS, ...settings, sourceText: migratedSource };
  const intervalMinutes =
    settings.intervalMinutes !== undefined
      ? settings.intervalMinutes
      : settings.minMinutes || DEFAULT_SETTINGS.intervalMinutes;

  return {
    ...merged,
    generatedFromSource: String(merged.generatedFromSource || "").trim(),
    intervalMinutes: clamp(Number(intervalMinutes), 1, 10080)
  };
}

async function requestQuestionCards(settings) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.openRouterApiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Quiz Interrupter"
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      temperature: 0.3,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content: [
            "You format raw study material into flashcard quiz cards.",
            "Return only valid JSON with this exact shape:",
            "{\"questions\":[{\"question\":\"...\",\"answer\":\"...\"}]}",
            "Create 8 cards unless the source clearly needs fewer.",
            "Questions must test recall, reasoning, definitions, examples, and common mistakes where useful.",
            "Do not ask vague questions like 'what did the notes say'.",
            "Answers should be concise, correct, and complete enough for self-checking."
          ].join(" ")
        },
        {
          role: "user",
          content: settings.sourceText
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorText.slice(0, 120)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = parseModelJson(content);
  const questions = normalizeGeneratedQuestions(parsed.questions);

  if (!questions.length) {
    throw new Error("The model did not return usable cards");
  }

  return questions;
}

function parseModelJson(content) {
  if (!content) throw new Error("The model returned an empty response");

  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model response was not JSON");
    return JSON.parse(match[0]);
  }
}

function normalizeGeneratedQuestions(questions) {
  if (!Array.isArray(questions)) return [];

  return questions
    .map((item) => ({
      question: String(item?.question || "").trim(),
      answer: String(item?.answer || "").trim()
    }))
    .filter((item) => item.question && item.answer)
    .slice(0, 20);
}

function getCurrentQuestions() {
  return normalizeGeneratedQuestions(currentQuestions.length ? currentQuestions : DEFAULT_SETTINGS.questions);
}

function renderCardSummary(questions, source = "") {
  const cards = normalizeGeneratedQuestions(questions);
  currentQuestions = cards;
  lastGeneratedSource = String(source || "").trim();
  fields.cardSummary.textContent = cards.length
    ? `${cards.length} flashcards ready${lastGeneratedSource ? "" : " from default set"}`
    : "No flashcards generated yet";
}

function renderSourceChangeState() {
  const sourceText = fields.sourceText.value.trim() || DEFAULT_SETTINGS.sourceText;
  if (sourceText === lastGeneratedSource) {
    renderCardSummary(currentQuestions, lastGeneratedSource);
    return;
  }

  fields.cardSummary.textContent = fields.openRouterApiKey.value.trim()
    ? "Source changed; flashcards will auto-generate on save"
    : "Source changed; add an OpenRouter API key to auto-generate";
}

function setBusy(isBusy) {
  fields.save.disabled = isBusy;
  fields.testNow.disabled = isBusy;
  fields.generateQuestions.disabled = isBusy;
  fields.generateQuestions.textContent = isBusy ? "Generating" : "Generate flashcards";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function renderNextQuiz(nextQuizAt) {
  if (!nextQuizAt || nextQuizAt < Date.now()) {
    fields.nextQuiz.textContent = "";
    return;
  }

  fields.nextQuiz.textContent = `Next quiz around ${new Date(nextQuizAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function showStatus(message) {
  fields.status.textContent = message;
  window.setTimeout(() => {
    fields.status.textContent = "";
  }, 1800);
}
