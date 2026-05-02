const els = {
  eyebrow: document.querySelector("#eyebrow"),
  title: document.querySelector("#title"),
  prompt: document.querySelector("#prompt"),
  question: document.querySelector("#question"),
  answer: document.querySelector("#answer"),
  feedback: document.querySelector("#feedback"),
  result: document.querySelector("#result"),
  resultIcon: document.querySelector("#resultIcon"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSummary: document.querySelector("#resultSummary"),
  resultImprove: document.querySelector("#resultImprove"),
  resultExplanation: document.querySelector("#resultExplanation"),
  submit: document.querySelector("#submit"),
  idk: document.querySelector("#idk")
};

let activeQuiz = null;
let hasAttempted = false;

init();

async function init() {
  const stored = await chrome.storage.local.get("activeQuiz");
  activeQuiz = stored.activeQuiz;

  if (!activeQuiz) {
    els.title.textContent = "No quiz pending";
    els.question.textContent = "You can close this window.";
    els.answer.hidden = true;
    els.submit.hidden = true;
    els.idk.hidden = true;
    return;
  }

  els.eyebrow.textContent = "Flashcard";
  els.title.textContent = activeQuiz.title || "Quiz";
  els.question.textContent = activeQuiz.question;
  els.answer.focus();

  els.submit.addEventListener("click", submitAnswer);
  els.idk.addEventListener("click", askChatGpt);
  els.answer.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      submitAnswer();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!hasAttempted) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function submitAnswer() {
  const answer = els.answer.value.trim();
  if (!answer) {
    els.feedback.textContent = "Write at least a quick attempt first.";
    els.answer.focus();
    return;
  }

  hasAttempted = true;
  els.feedback.textContent = "";
  els.submit.disabled = true;
  els.idk.disabled = true;
  els.submit.textContent = "Checking";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHECK_ANSWER",
      answer
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not check answer");
    }

    renderResult(response.result);
  } catch (error) {
    hasAttempted = false;
    els.feedback.textContent = error.message || "Could not check answer.";
    els.submit.disabled = false;
    els.idk.disabled = false;
    els.submit.textContent = "Submit";
  }
}

async function askChatGpt() {
  hasAttempted = true;
  const prompt = buildHelpPrompt();

  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    // Clipboard access can be unavailable in extension popups; the URL still carries the prompt.
  }

  await chrome.runtime.sendMessage({
    type: "OPEN_CHATGPT_HELP",
    prompt
  });
}

function renderResult(result) {
  els.prompt.hidden = true;
  els.result.hidden = false;
  els.result.classList.toggle("is-correct", result.isCorrect);
  els.result.classList.toggle("is-wrong", !result.isCorrect);
  els.resultIcon.textContent = result.isCorrect ? "✓" : "!";
  els.resultTitle.textContent = result.isCorrect ? "Correct" : "Not quite";
  els.resultSummary.textContent = result.summary;
  els.resultImprove.textContent = result.improvement;
  els.resultExplanation.textContent = result.explanation;
  els.submit.textContent = "Done";
  els.submit.disabled = false;
  els.submit.removeEventListener("click", submitAnswer);
  els.submit.addEventListener("click", () => window.close());
  els.idk.hidden = true;
}

function buildHelpPrompt() {
  const question = activeQuiz?.question || "this topic";
  const topic = activeQuiz?.sourceText || activeQuiz?.title || "this topic";
  const expected = activeQuiz?.expectedAnswer
    ? `\n\nExpected answer/reference:\n${activeQuiz.expectedAnswer}`
    : "";

  return [
    "I got this quiz question and I don't know how to answer it:",
    question,
    "",
    `Please explain ${topic} clearly, show me how to think through the answer, and then give me a similar practice question.${expected}`
  ].join("\n");
}
