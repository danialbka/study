const DEFAULT_SETTINGS = {
  enabled: false,
  intervalMinutes: 60,
  sourceText: "JavaScript fundamentals",
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

const ALARM_NAME = "quiz-interrupter-next";
const QUIZ_PATH = "quiz.html";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  if (!current.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  await scheduleNextQuiz();
});

chrome.runtime.onStartup.addListener(scheduleNextQuiz);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.settings) {
    scheduleNextQuiz();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  await openQuizWindow(settings);
  await scheduleNextQuiz();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const active = await chrome.storage.local.get("activeQuiz");
  if (!active.activeQuiz || active.activeQuiz.windowId !== windowId) return;
  if (active.activeQuiz.attempted) return;

  await chrome.storage.local.remove("activeQuiz");

  const settings = await getSettings();
  if (settings.enabled) {
    await openQuizWindow(settings);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "QUIZ_ATTEMPTED") {
    markAttempted(sender.tab?.windowId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "OPEN_CHATGPT_HELP") {
    openChatGptHelp(message.prompt, sender.tab).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "OPEN_TEST_QUIZ") {
    getSettings()
      .then(openQuizWindow)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CHECK_ANSWER") {
    checkAnswer(message.answer)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return normalizeSettings(settings);
}

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const intervalMinutes = getIntervalMinutes(settings);
  const sourceText = settings.sourceText || settings.topic || DEFAULT_SETTINGS.sourceText;
  return {
    ...merged,
    intervalMinutes,
    sourceText: String(sourceText).trim(),
    openRouterApiKey: String(merged.openRouterApiKey || "").trim(),
    questions: normalizeQuestions(merged.questions)
  };
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) return DEFAULT_SETTINGS.questions;

  const cleaned = questions
    .map((item) => ({
      question: String(item?.question || "").trim(),
      answer: String(item?.answer || "").trim()
    }))
    .filter((item) => item.question);

  return cleaned.length ? cleaned : DEFAULT_SETTINGS.questions;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function getIntervalMinutes(settings) {
  if (settings.intervalMinutes !== undefined) {
    return clampNumber(settings.intervalMinutes, 1, 10080);
  }

  return clampNumber(settings.minMinutes || DEFAULT_SETTINGS.intervalMinutes, 1, 10080);
}

async function scheduleNextQuiz() {
  await chrome.alarms.clear(ALARM_NAME);
  const settings = await getSettings();
  if (!settings.enabled) return;

  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: settings.intervalMinutes });
  await chrome.storage.local.set({
    nextQuizAt: Date.now() + settings.intervalMinutes * 60 * 1000
  });
}

async function openQuizWindow(settings) {
  const existing = await chrome.storage.local.get("activeQuiz");
  if (existing.activeQuiz && !existing.activeQuiz.attempted) {
    try {
      await chrome.windows.update(existing.activeQuiz.windowId, { focused: true });
      return;
    } catch {
      await chrome.storage.local.remove("activeQuiz");
    }
  }

  const quiz = buildQuiz(settings);
  await chrome.storage.local.set({
    activeQuiz: {
      ...quiz,
      attempted: false,
      openedAt: Date.now()
    }
  });

  const width = 480;
  const height = 520;
  const bounds = await getCenteredBounds(width, height);
  const window = await chrome.windows.create({
    url: chrome.runtime.getURL(QUIZ_PATH),
    type: "popup",
    width,
    height,
    left: bounds.left,
    top: bounds.top,
    focused: true
  });

  await chrome.storage.local.set({
    activeQuiz: {
      ...quiz,
      attempted: false,
      openedAt: Date.now(),
      windowId: window.id
    }
  });
}

async function getCenteredBounds(width, height) {
  try {
    const currentWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    const left = Math.round((currentWindow.left || 0) + ((currentWindow.width || width) - width) / 2);
    const top = Math.round((currentWindow.top || 0) + ((currentWindow.height || height) - height) / 2);
    return { left: Math.max(0, left), top: Math.max(0, top) };
  } catch {
    return { left: 120, top: 120 };
  }
}

function buildQuiz(settings) {
  const item = settings.questions[Math.floor(Math.random() * settings.questions.length)];
  return {
    title: "Quick check",
    question: item.question,
    expectedAnswer: item.answer,
    sourceText: settings.sourceText
  };
}

async function markAttempted(windowId) {
  const { activeQuiz } = await chrome.storage.local.get("activeQuiz");
  if (!activeQuiz) return;

  await chrome.storage.local.set({
    activeQuiz: {
      ...activeQuiz,
      attempted: true,
      attemptedAt: Date.now(),
      windowId: windowId || activeQuiz.windowId
    }
  });
}

async function openChatGptHelp(prompt, tab) {
  await markAttempted(tab?.windowId);

  const url = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { url });
    return;
  }

  await chrome.tabs.create({ url });
}

async function checkAnswer(userAnswer) {
  const [{ activeQuiz }, settings] = await Promise.all([
    chrome.storage.local.get("activeQuiz"),
    getSettings()
  ]);

  if (!activeQuiz) {
    throw new Error("No active quiz found");
  }

  if (!settings.openRouterApiKey) {
    throw new Error("Add your OpenRouter API key in settings first");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.openRouterApiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Quiz Interrupter"
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: [
            "You are grading a flashcard answer.",
            "Return only valid JSON with this exact shape:",
            "{\"isCorrect\":true,\"summary\":\"...\",\"improvement\":\"...\",\"explanation\":\"...\"}",
            "Mark isCorrect true when the answer captures the core idea, even if wording differs.",
            "Mark isCorrect false when the answer is missing the main idea, misleading, or too vague.",
            "summary should be one short sentence responding to the learner's answer.",
            "improvement should say where they could improve.",
            "explanation should teach the correct answer clearly in 2-4 short sentences."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Question: ${activeQuiz.question}`,
            `Reference answer: ${activeQuiz.expectedAnswer || "No reference answer provided."}`,
            `Learner answer: ${String(userAnswer || "").trim()}`
          ].join("\n\n")
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
  const result = normalizeCheckResult(parseModelJson(content));
  await markAttempted(activeQuiz.windowId);
  return result;
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

function normalizeCheckResult(result) {
  const isCorrect =
    result?.isCorrect === true ||
    String(result?.isCorrect).trim().toLowerCase() === "true";

  return {
    isCorrect,
    summary: String(result?.summary || "").trim() || "I checked your answer.",
    improvement: String(result?.improvement || "").trim() || "Try to be specific and include the core idea.",
    explanation: String(result?.explanation || "").trim() || "Review the reference answer and compare it with your response."
  };
}
