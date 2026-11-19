// Service worker: LLM API 호출 담당 (API 키를 페이지 컨텍스트에 노출하지 않기 위해 여기서만 호출)
importScripts("security.js");

const ERRORS = {
  INVALID_REQUEST: "허용되지 않거나 잘못된 요청입니다.",
  CLOUD_DISABLED: "외부 전송이 꺼져 있습니다. 설정에서 선택한 텍스트/문맥의 AI 제공자 전송을 허용하세요.",
  RATE_LIMIT: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  TIMEOUT: "AI 요청 시간이 초과되었습니다. 다시 시도하세요.",
  API_ERROR: "AI 제공자 요청에 실패했습니다. 설정과 사용량을 확인하세요.",
  STORAGE_ERROR: "설정을 읽거나 저장하지 못했습니다. 확장을 다시 로드해 주세요.",
  VOCAB_FULL: "단어장이 가득 찼습니다. 항목을 삭제한 후 저장하세요.",
};
let storageQueue = Promise.resolve();
const inFlight = new Set();

function serializeStorage(task) {
  const result = storageQueue.then(task);
  storageQueue = result.catch(() => {});
  return result;
}

function fail(code) { throw new Error(code); }
function bounded(value, max, required = false) {
  return typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
}

// Register the listener synchronously; all operations wait for access restrictions/migration.
const ready = (async () => {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
  const { settings = {}, vocab = [], securityVersion } = await chrome.storage.local.get(["settings", "vocab", "securityVersion"]);
  if (securityVersion !== 2) {
    const { apiKey, sessionKeySlot, ...preferences } = settings;
    const update = { settings: preferences, securityVersion: 2 };
    if (securityVersion !== 1) {
      Object.assign(preferences, { rememberKey: false, allowCloudTranslation: false, allowCloudExplanation: false });
      update.vocab = vocab.map((entry) => ({ ...entry, url: TechDocSecurity.sourceURL(entry.url) }));
    }
    await chrome.storage.session.remove(["apiKey", "keyProvider"]);
    await chrome.storage.local.set(update);
  }
})();
// Keep initialization failures handled even before a message arrives; requests fail closed.
ready.catch(() => {});

const DEFAULT_MODELS = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5",
};

const PROMPTS = {
  translate:
    "너는 개발자를 위한 번역가다. 주어진 영어 텍스트를 자연스러운 한국어로 번역해라. " +
    "기술 용어는 처음 등장할 때 원어를 괄호로 병기해라. 번역문만 출력해라.",
  explain:
    "너는 영어 기술 문서를 읽는 한국인 개발자를 돕는 튜터다. " +
    "사용자가 선택한 표현이 주어진 문맥에서 무슨 뜻인지 한국어로 설명해라. 형식:\n" +
    "• 문맥상 의미: (한두 문장)\n" +
    "• 기술적 배경: (필요할 때만, 한두 문장)\n" +
    "• 비슷한 표현/예문: (짧게 하나)\n" +
    "전체 6줄 이내로 간결하게.",
};

const SESSION_KEY_SLOTS = ["sessionKeyA", "sessionKeyB"];

async function readSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const { sessionKeySlot, apiKey = "", ...preferences } = settings;
  let activeKey = "";
  if (preferences.rememberKey === true) {
    activeKey = apiKey;
  } else if (SESSION_KEY_SLOTS.includes(sessionKeySlot)) {
    const record = (await chrome.storage.session.get(sessionKeySlot))[sessionKeySlot];
    if (record && record.provider === preferences.provider) activeKey = record.apiKey;
  }
  return { provider: "openai", model: "", ...preferences, apiKey: activeKey };
}

async function saveSettings({ provider, model, rememberKey, allowCloudTranslation, allowCloudExplanation, apiKey }) {
  const settings = { provider, model, rememberKey, allowCloudTranslation, allowCloudExplanation };
  if (rememberKey) {
    settings.apiKey = apiKey;
  } else if (apiKey) {
    const { settings: previous } = await chrome.storage.local.get("settings");
    settings.sessionKeySlot = SESSION_KEY_SLOTS.find(slot => slot !== previous?.sessionKeySlot);
    await chrome.storage.session.set({ [settings.sessionKeySlot]: { provider, apiKey } });
  }
  // Only this write activates the new credential and permissions.
  try {
    await chrome.storage.local.set({ settings });
  } catch (error) {
    if (settings.sessionKeySlot) await chrome.storage.session.remove(settings.sessionKeySlot);
    throw error;
  }
  // Cleanup cannot undo a committed save. Unreferenced slots expire with the session.
  await chrome.storage.session.remove(SESSION_KEY_SLOTS.filter(slot => slot !== settings.sessionKeySlot)).catch(() => {});
}

async function fetchJSON(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, credentials: "omit", redirect: "error" });
    if (!res.ok) fail("API_ERROR");
    return await res.json();
  } catch (error) {
    fail(controller.signal.aborted ? "TIMEOUT" : "API_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI({ apiKey, model }, system, user) {
  const data = await fetchJSON("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.openai,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 600,
    }),
  });
  const text = data.choices?.[0]?.message?.content;
  if (!bounded(text, 12000, true)) fail("API_ERROR");
  return text.trim();
}

async function callAnthropic({ apiKey, model }, system, user) {
  const data = await fetchJSON("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.anthropic,
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!Array.isArray(data.content)) fail("API_ERROR");
  const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  if (!bounded(text, 12000, true)) fail("API_ERROR");
  return text.trim();
}

async function callLLM({ mode, text, context }, sender) {
  if (!["translate", "explain"].includes(mode) || !bounded(text, 1000, true) || !bounded(context, 600)) fail("INVALID_REQUEST");
  const settings = await serializeStorage(readSettings);
  const consent = mode === "translate" ? settings.allowCloudTranslation : settings.allowCloudExplanation;
  if (consent !== true) fail("CLOUD_DISABLED");
  if (!["openai", "anthropic"].includes(settings.provider)) fail("INVALID_REQUEST");
  if (!settings.apiKey) {
    const err = new Error("NO_KEY");
    throw err;
  }
  const system = PROMPTS[mode];
  const user =
    mode === "explain"
      ? `선택한 표현: "${text}"\n\n문맥: "${context || text}"`
      : text;

  const tabId = sender.tab.id;
  if (inFlight.has(tabId) || inFlight.size >= 3) fail("RATE_LIMIT");
  inFlight.add(tabId);
  try {
    await serializeStorage(async () => {
      const { llmRequests = [] } = await chrome.storage.session.get("llmRequests");
      const now = Date.now();
      const recent = llmRequests.filter((r) => now - r.at < 60000);
      const tabRequests = recent.filter((r) => r.tabId === tabId);
      if (recent.length >= 20 || tabRequests.length >= 10 || tabRequests.some((r) => now - r.at < 2000)) fail("RATE_LIMIT");
      await chrome.storage.session.set({ llmRequests: [...recent, { tabId, at: now }] });
    });
    return await (settings.provider === "anthropic"
      ? callAnthropic(settings, system, user)
      : callOpenAI(settings, system, user));
  } finally {
    inFlight.delete(tabId);
  }
}

function isPageSender(sender) {
  return Number.isInteger(sender.tab?.id) && sender.frameId === 0 &&
    (!sender.documentLifecycle || sender.documentLifecycle === "active") &&
    Boolean(TechDocSecurity.sourceURL(sender.url));
}

async function handleMessage(msg, sender) {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== "object") fail("INVALID_REQUEST");
  const page = isPageSender(sender);
  const popup = !sender.tab && sender.url === chrome.runtime.getURL("popup.html");
  // Options may also be opened in a browser tab; exact extension URL is required.
  const settingsPage = sender.url === chrome.runtime.getURL("options.html");
  if (!(page || popup || settingsPage)) fail("INVALID_REQUEST");
  try { await ready; } catch { fail("STORAGE_ERROR"); }

  if (msg.type === "llm" && page) return { text: await callLLM(msg, sender) };
  if (msg.type === "getSettings" && settingsPage) return { settings: await serializeStorage(readSettings) };
  if (msg.type === "saveSettings" && settingsPage) {
    const s = msg.settings;
    if (!s || !["openai", "anthropic"].includes(s.provider) || !bounded(s.apiKey, 512) || /\s/.test(s.apiKey) ||
        !bounded(s.model, 120) || (s.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(s.model)) ||
        ![s.rememberKey, s.allowCloudTranslation, s.allowCloudExplanation].every((v) => typeof v === "boolean")) fail("INVALID_REQUEST");
    await serializeStorage(() => saveSettings(s));
    return {};
  }
  if (msg.type === "saveWord" && page) {
    const v = msg.entry;
    if (!v || !bounded(v.text, 1000, true) || !bounded(v.context, 600) || !bounded(v.title, 300) ||
        !bounded(v.translation, 12000) || !bounded(v.explanation, 12000)) fail("INVALID_REQUEST");
    await serializeStorage(async () => {
      const { vocab = [] } = await chrome.storage.local.get("vocab");
      const existing = vocab.find((entry) => entry.text.toLowerCase() === v.text.toLowerCase());
      if (!existing && vocab.length >= 1000) fail("VOCAB_FULL");
      const entry = { id: existing?.id ?? crypto.randomUUID(), text: v.text, context: v.context,
        title: v.title, url: TechDocSecurity.sourceURL(sender.url),
        translation: v.translation || existing?.translation || "", explanation: v.explanation || existing?.explanation || "",
        count: (existing?.count ?? 0) + 1, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
      await chrome.storage.local.set({ vocab: [entry, ...vocab.filter((item) => item.id !== entry.id)] });
    });
    return {};
  }
  if (msg.type === "getVocab" && popup) {
    const { vocab = [] } = await chrome.storage.local.get("vocab");
    return { vocab };
  }
  if (msg.type === "deleteWord" && popup && bounded(msg.id, 100, true)) {
    await serializeStorage(async () => {
      const { vocab = [] } = await chrome.storage.local.get("vocab");
      await chrome.storage.local.set({ vocab: vocab.filter((v) => v.id !== msg.id) });
    });
    return {};
  }
  if (msg.type === "clearVocab" && popup) {
    await serializeStorage(() => chrome.storage.local.set({ vocab: [] }));
    return {};
  }
  if (msg.type === "openOptions" && page) { await chrome.runtime.openOptionsPage(); return {}; }
  fail("INVALID_REQUEST");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false,
      error: error.message === "NO_KEY" ? "NO_KEY" : (ERRORS[error.message] || ERRORS.STORAGE_ERROR) }));
  return true;
});
