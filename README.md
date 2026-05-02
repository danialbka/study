# Quiz Interrupter

A minimal Chrome extension that opens quiz cards at the interval you set. The quiz window stays active until the user submits an answer or clicks **I don't know**, which opens ChatGPT with a help prompt.

## Load it

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.

## Use it

- Click the extension icon to open settings.
- Turn it on.
- Choose the interval in minutes.
- Add an OpenRouter API key.
- Paste a topic, notes, or syllabus points into **Quiz source**.
- Click **Save** to automatically create fresh question cards with `deepseek/deepseek-v4-flash`.
- Use **Generate flashcards** when you want to refresh the cards immediately without changing other settings.
- Submit an answer in the quiz popup to have OpenRouter check it, show a correct/wrong result, and explain where to improve.

The **Test now** button opens a quiz window shortly after saving, so you can check the flow without waiting for the full interval.
