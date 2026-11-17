# TechDoc Reader 📖

A Chrome extension that helps you read English technical documentation more easily.

Select any English text on a webpage to translate it instantly, get an AI-powered explanation based on its context, and save useful expressions for later review.

## Why I Built This

While studying programming, I often read English documentation such as React, PyTorch, and MDN.

Sometimes, regular translators don't handle technical terms very well. Even when a sentence is translated correctly, it can still be difficult to understand what certain words or expressions mean in a technical context.

I wanted a simple tool that would let me translate and understand unfamiliar expressions without constantly switching between documentation, translators, and AI chatbots.

That's why I built TechDoc Reader.

## Features

- **Instant Translation** — Select English text and click the translation button to see the result.
- **AI Explanations** — Get explanations of technical terms and expressions based on the surrounding context.
- **Vocabulary Collection** — Save original text, translations, explanations, and source links for later review.
- **Search & Export** — Search or delete saved entries and export them as a CSV file.
- **Hybrid Translation** — Use Chrome's built-in Translator API for on-device translation, with optional OpenAI or Claude support.

## How It Works

1. Open a webpage containing English technical documentation.
2. Click the extension icon and select **Enable on this page**.
3. Highlight the text you want to translate.
4. Click the translation button that appears.
5. View the translation, request an AI explanation, or save the expression to your vocabulary collection.

## Installation

1. Clone this repository.

   ```bash
   git clone https://github.com/chanran-maru/techdoc-reader.git
   ```

2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the project folder.
5. Open a webpage and enable the extension to start using it.

**Notes:**
- Chrome's built-in Translator API requires Chrome 138 or later on desktop. The translation model may need to be downloaded on first use.
- AI explanations require an OpenAI or Anthropic API key and permission to send text to the selected provider.
- Basic on-device translation works without an API key.
- The extension must be enabled again after refreshing the page or opening a new document.

## Tech Stack

- JavaScript (Vanilla JS)
- Chrome Extension Manifest V3
- Chrome Built-in AI (Translator API)
- OpenAI API / Anthropic API
- Chrome Storage API
- Shadow DOM

## Implementation Notes

### On-Device Translation

I used Chrome's built-in Translator API as the primary translation method to reduce unnecessary API calls and costs.

If the built-in translation is unavailable or fails, users can choose to use an external AI provider instead.

### API Key Management

API requests are handled through the extension's background Service Worker rather than the webpage.

API keys are stored in session storage by default, with an option to keep them in local storage. Keys are never passed to the content script.

### UI Isolation

I used Shadow DOM to prevent the extension's styles from interfering with the existing webpage.

The extension also runs only on pages where the user explicitly enables it.

### Context-Aware Explanations

When requesting an AI explanation, the extension extracts nearby text from the same paragraph or element.

This gives the AI additional context, making it easier to explain technical expressions accurately.

### Security and Privacy

- External AI requests require user permission.
- On-device translations are processed locally.
- Text and AI responses are rendered using `textContent` instead of `innerHTML`.
- Vocabulary entries are stored locally using `chrome.storage.local`.
- API keys are kept in session storage by default.

For more details about security decisions and testing, see [SECURITY.md](SECURITY.md).

## Testing

Security-related tests can be run with Node.js 18 or later.

```bash
node --test tests/security.test.cjs
```

The tests cover message validation, API key handling, user permissions, request limits, and vocabulary storage.

## Future Improvements

- [ ] Add a demo GIF and publish to the Chrome Web Store
- [ ] Add keyboard shortcuts for translation
- [ ] Build a vocabulary review mode with flashcards
- [ ] Support custom glossaries for technical terms
- [ ] Add Anki export
- [ ] Set up GitHub Actions for automated testing

## License

This project is licensed under the MIT License.
