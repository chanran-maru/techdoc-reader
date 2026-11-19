# Privacy Policy for TechDoc Reader

**Effective date:** November 20, 2026  
**Extension:** TechDoc Reader  
**Developer:** TechDoc Reader (independent developer)  
**Source code:** https://github.com/chanran-maru/techdoc-reader

## 1. Overview

TechDoc Reader is a Chrome extension that helps users understand English technical documentation through translation, AI-powered explanations, and a personal vocabulary collection. This policy explains what information the extension processes, where it is stored, and when information is sent to third-party services.

## 2. Information the Extension Processes

Depending on which features you use, TechDoc Reader processes:

- **Selected text:** Text you select on a webpage for translation or explanation.
- **Surrounding context:** Nearby webpage text used to generate context-aware AI explanations.
- **Saved vocabulary:** Saved expressions, translations, explanations, surrounding context, page titles, source URLs, and save/update timestamps.
- **Preferences and credentials:** Your chosen AI provider, model, feature consent settings, and any API key you enter.

The extension does not require you to create a TechDoc Reader account or provide your name or email address.

## 3. On-Device Translation

When Chrome's built-in Translator API is available and successfully processes your request, translation is performed through Chrome's on-device translation feature. TechDoc Reader does not send the selected text to OpenAI or Anthropic for this translation.

If on-device translation is unavailable or fails, the extension may attempt translation through the external AI provider you selected, but only if you have enabled external translation, provided an API key, and requested the translation. Otherwise, the external request is not performed.

## 4. External AI Services

If you enable cloud-based translation or AI explanations and use those features, TechDoc Reader sends the information required for the request directly from the extension to the AI provider you selected:

- **OpenAI:** https://openai.com/policies/privacy-policy/
- **Anthropic:** https://www.anthropic.com/legal/privacy

For cloud translation, the extension sends selected text. For AI explanations, it sends selected text and surrounding context. The extension also sends your API key to the selected provider for authentication.

These third-party providers process requests under their own terms and privacy policies. Their data retention and handling practices are outside the developer's direct control. Avoid selecting sensitive, confidential, or personal information for external AI processing.

## 5. Local Storage and API Keys

TechDoc Reader uses Chrome's extension storage facilities:

- `chrome.storage.local` stores extension settings and saved vocabulary on your device.
- By default, API keys are held in `chrome.storage.session`, which is temporary and is not intended for persistent storage across browser sessions.
- If you explicitly choose to remember an API key, it is stored in `chrome.storage.local` on your device instead.

API keys are used to authenticate requests to your selected AI provider. They are not inserted into the webpages you visit. Chrome local extension storage should not be treated as an encrypted secret vault, particularly on shared or compromised devices.

## 6. Sharing and Use of Information

TechDoc Reader uses information to provide its core translation, explanation, settings, and vocabulary features. The extension does not include advertising or analytics integrations in the reviewed version, and the developer does not operate a backend server that receives your vocabulary collection.

The extension does not sell user data or share it for advertising, credit assessment, or unrelated purposes. Information is sent to the selected AI provider only as needed for the external AI feature you have enabled and requested.

## 7. Retention and Deletion

Saved vocabulary and settings remain in your browser's extension storage until you delete or change them, clear the extension's stored data, or uninstall the extension. You can delete individual vocabulary items or clear your entire vocabulary collection from the extension interface.

You can change or remove your API key in the extension's settings. Session-stored credentials are temporary, while a key saved using the remember option stays in local extension storage until changed or removed.

Deleting local extension data does not necessarily delete information already processed by OpenAI or Anthropic. Consult the provider's applicable policies and controls for their retention and deletion practices.

## 8. Website Access and Permissions

TechDoc Reader uses `activeTab` and `scripting` to activate its text-selection interface on the current webpage when you choose to enable the extension. Its host permissions allow connections to the OpenAI and Anthropic API domains for optional AI features. The `storage` permission supports local preferences, credentials, and vocabulary.

The extension is not designed to collect your browsing history or continuously monitor all pages you visit. When you save a vocabulary entry, it stores the source page title and a sanitized source URL; URL query strings, fragments, and embedded credentials are removed before storage.

## 9. Security

The extension restricts access to stored data, processes AI requests in its background service worker, and uses HTTPS endpoints for supported AI providers. No software can guarantee absolute security. Do not store sensitive API keys using the remember option on a shared device.

## 10. Changes to This Policy

This policy may be updated if the extension's features or data practices change. The updated version will be published in the project's GitHub repository with a revised effective date.

## 11. Contact

For questions or privacy-related requests, open an issue in the project's public GitHub repository:

https://github.com/chanran-maru/techdoc-reader/issues

**Do not include API keys, confidential text, or other sensitive information in a public GitHub issue.**
