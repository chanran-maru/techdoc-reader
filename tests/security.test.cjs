const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const source = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const extensionURL = (file) => `chrome-extension://test-extension/${file}`;
const pageSender = { id: "test-extension", frameId: 0, tab: { id: 1 }, url: "https://docs.test/guide?token=private#secret" };
const popupSender = { id: "test-extension", url: extensionURL("popup.html") };
const optionsSender = { id: "test-extension", tab: { id: 2 }, url: extensionURL("options.html") };
const llm = { type: "llm", mode: "explain", text: "example", context: "some context" };
const settings = { provider: "openai", apiKey: "test-only-key", model: "", rememberKey: false, allowCloudTranslation: true, allowCloudExplanation: true };
const entry = { text: "example", context: "context", title: "Document", translation: "번역", explanation: "설명" };

function worker(initial = {}, fetchImpl, sessionInitial = {}) {
  let listener;
  let now = 100000;
  const timers = new Map();
  let timerId = 0;
  const accesses = [];
  const requests = [];
  function area(initialData, name) {
    const data = structuredClone(initialData);
    return {
      data,
      async setAccessLevel(options) { accesses.push([name, options.accessLevel]); },
      async get(keys) {
        const names = typeof keys === "string" ? [keys] : keys;
        return Object.fromEntries(names.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
      },
      async set(values) { Object.assign(data, structuredClone(values)); },
    };
  }
  const local = area(initial, "local"), session = area(sessionInitial, "session");
  const sandbox = vm.createContext({
    URL, crypto: webcrypto, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { storage: { local, session }, runtime: { id: "test-extension", getURL: extensionURL,
      onMessage: { addListener(fn) { listener = fn; } }, async openOptionsPage() {} } },
    async fetch(url, options) {
      requests.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      return { ok: true, async json() { return url.includes("anthropic")
        ? { content: [{ type: "text", text: "설명" }] }
        : { choices: [{ message: { content: "설명" } }] }; } };
    },
  });
  sandbox.importScripts = (file) => vm.runInContext(source(file), sandbox);
  vm.runInContext(source("background.js"), sandbox);
  return {
    local: local.data, session: session.data, requests, accesses, timers,
    advance(ms) { now += ms; },
    send(message, sender = pageSender) { return new Promise((resolve) => listener(message, sender, resolve)); },
  };
}

async function configured(fetchImpl) {
  const w = worker({ securityVersion: 1 }, fetchImpl);
  assert.equal((await w.send({ type: "saveSettings", settings }, optionsSender)).ok, true);
  return w;
}

test("manifest grants page access only through activeTab", () => {
  const manifest = JSON.parse(source("manifest.json"));
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions, ["storage", "activeTab", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.openai.com/*", "https://api.anthropic.com/*"]);
});

test("migration restricts storage, moves legacy key to session, disables cloud, sanitizes old URLs", async () => {
  const w = worker({ settings: { apiKey: "legacy-key", provider: "openai" }, vocab: [{ ...entry, url: pageSender.url }] });
  const result = await w.send({ type: "getSettings" }, optionsSender);
  assert.equal(result.settings.apiKey, "legacy-key");
  assert.equal(w.local.settings.apiKey, undefined);
  assert.equal(w.session.apiKey, "legacy-key");
  assert.equal(w.local.settings.allowCloudTranslation, false);
  assert.equal(w.local.settings.allowCloudExplanation, false);
  assert.equal(w.local.vocab[0].url, "https://docs.test/guide");
  assert.deepEqual(w.accesses, [["local", "TRUSTED_CONTEXTS"], ["session", "TRUSTED_CONTEXTS"]]);
  assert.equal((await w.send(llm)).ok, false);
  assert.equal(w.requests.length, 0);
});

test("key is never returned to page scripts; privileged operations reject page senders", async () => {
  const w = await configured();
  for (const message of [{ type: "getSettings" }, { type: "saveSettings", settings }, { type: "getVocab" },
    { type: "deleteWord", id: "anything" }, { type: "clearVocab" }]) {
    const result = await w.send(message);
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes("test-only-key"));
  }
});

test("API key persistence is opt-in, reversible, and empty save removes key", async () => {
  const w = await configured();
  assert.equal(w.local.settings.apiKey, undefined);
  assert.equal(w.session.apiKey, settings.apiKey);
  await w.send({ type: "saveSettings", settings: { ...settings, rememberKey: true } }, optionsSender);
  assert.equal(w.local.settings.apiKey, settings.apiKey);
  await w.send({ type: "saveSettings", settings }, optionsSender);
  assert.equal(w.local.settings.apiKey, undefined);
  await w.send({ type: "saveSettings", settings: { ...settings, apiKey: "" } }, optionsSender);
  assert.equal(w.session.apiKey, "");
  assert.equal((await w.send(llm)).error, "NO_KEY");
});

test("invalid senders and non-page contexts cannot invoke the API", async () => {
  const w = await configured();
  for (const sender of [{ ...pageSender, id: "foreign-extension" }, { ...pageSender, frameId: 1 },
    { ...pageSender, url: "file:///private" }, { ...pageSender, documentLifecycle: "prerender" },
    popupSender, optionsSender, { id: "test-extension", url: extensionURL("unknown.html") }]) {
    assert.equal((await w.send(llm, sender)).ok, false);
  }
  assert.equal(w.requests.length, 0);
});

test("worker validates mode, input types, lengths and settings before network", async () => {
  const w = await configured();
  for (const bad of [{ mode: "constructor" }, { mode: "toString" }, { text: "A".repeat(1001) },
    { text: {} }, { text: " " }, { context: "A".repeat(601) }, { context: null }]) {
    assert.equal((await w.send({ ...llm, ...bad })).ok, false);
  }
  for (const bad of [{ provider: "other" }, { apiKey: "bad\nkey" }, { model: "x".repeat(121) },
    { model: "model\nname" }, { allowCloudTranslation: "true" }]) {
    assert.equal((await w.send({ type: "saveSettings", settings: { ...settings, ...bad } }, optionsSender)).ok, false);
  }
  assert.equal(w.requests.length, 0);
});

test("separate explicit consent gates translation and explanation", async () => {
  const w = await configured();
  await w.send({ type: "saveSettings", settings: { ...settings, allowCloudTranslation: false } }, optionsSender);
  assert.equal((await w.send({ ...llm, mode: "translate" })).ok, false);
  assert.equal(w.requests.length, 0);
  assert.equal((await w.send(llm)).ok, true);
  assert.equal(w.requests.length, 1);
  assert.ok(!w.requests[0].options.body.includes("docs.test"));
  assert.equal(w.requests[0].options.credentials, "omit");
  assert.equal(w.requests[0].options.redirect, "error");
  assert.equal(w.timers.size, 0);
});

test("both providers accept valid requests; translation excludes surrounding context", async () => {
  const w = await configured();
  assert.equal((await w.send({ ...llm, mode: "translate" })).ok, true);
  assert.equal(JSON.parse(w.requests[0].options.body).messages[1].content, llm.text);
  await w.send({ type: "saveSettings", settings: { ...settings, provider: "anthropic" } }, optionsSender);
  w.advance(2100);
  assert.equal((await w.send(llm)).ok, true);
  assert.equal(w.requests[1].url, "https://api.anthropic.com/v1/messages");
});

test("per-tab throttling persists across worker restart and expires", async () => {
  const w = await configured();
  assert.equal((await w.send(llm)).ok, true);
  assert.equal((await w.send(llm)).ok, false);
  const restarted = worker(w.local, undefined, w.session);
  assert.equal((await restarted.send(llm)).ok, false);
  restarted.advance(61000);
  assert.equal((await restarted.send(llm)).ok, true);
});

test("rolling per-tab and global request quotas are enforced", async () => {
  const w = await configured();
  for (let i = 0; i < 10; i++) {
    assert.equal((await w.send(llm)).ok, true);
    w.advance(2100);
  }
  assert.equal((await w.send(llm)).ok, false);
  for (let i = 0; i < 10; i++) {
    assert.equal((await w.send(llm, { ...pageSender, tab: { id: i + 10 } })).ok, true);
  }
  assert.equal((await w.send(llm, { ...pageSender, tab: { id: 999 } })).ok, false);
  assert.equal(w.requests.length, 20);
});

test("concurrent API calls are bounded and duplicate tab calls are rejected", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const w = await configured(async () => { await gate; return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) }; });
  const pending = [1, 2, 3].map((id) => w.send(llm, { ...pageSender, tab: { id } }));
  while (w.requests.length < 3) await new Promise(setImmediate);
  assert.equal((await w.send(llm)).ok, false);
  assert.equal((await w.send(llm, { ...pageSender, tab: { id: 4 } })).ok, false);
  release();
  for (const result of await Promise.all(pending)) assert.equal(result.ok, true);
});

test("API errors never forward raw provider secrets to the page", async () => {
  const w = await configured(async () => ({ ok: false, json: async () => ({ error: { message: "secret-test-only-key" } }) }));
  const result = await w.send(llm);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("test-only-key"));
  assert.equal(w.timers.size, 0);
});

test("timeout aborts the request and releases the concurrency slot", async () => {
  const w = await configured(async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const pending = w.send(llm);
  while (!w.requests.length) await new Promise(setImmediate);
  for (const fn of [...w.timers.values()]) fn();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /시간/);
  assert.equal(w.requests[0].options.signal.aborted, true);
  assert.equal(w.timers.size, 0);
});

test("word writes are serialized and source URLs come from validated sender", async () => {
  const w = await configured();
  const results = await Promise.all(["one", "two"].map((text) => w.send({ type: "saveWord", entry: { ...entry, text, url: "javascript:alert(1)" } })));
  assert.ok(results.every((result) => result.ok));
  assert.equal(w.local.vocab.length, 2);
  assert.ok(w.local.vocab.every((v) => v.url === "https://docs.test/guide"));
  const id = w.local.vocab[0].id;
  await w.send({ type: "deleteWord", id }, popupSender);
  assert.equal(w.local.vocab.length, 1);
  await w.send({ type: "clearVocab" }, popupSender);
  assert.equal(w.local.vocab.length, 0);
});

test("malformed and oversized saved entries are rejected", async () => {
  const w = await configured();
  for (const bad of [{ text: "" }, { context: "A".repeat(601) }, { translation: "A".repeat(12001) }, { title: null }]) {
    assert.equal((await w.send({ type: "saveWord", entry: { ...entry, ...bad } })).ok, false);
  }
});

test("shared CSV escaping neutralizes formula prefixes and preserves CSV quoting", () => {
  const context = vm.createContext({ URL });
  vm.runInContext(source("security.js"), context);
  const { csvCell, sourceURL } = context.TechDocSecurity;
  for (const value of ["=1+1", "+SUM(1,2)", "-1+1", "@SUM(1,2)", " \t=1+1", "\u0000=1+1", "\ttext", "\ntext", "\rtext"]) {
    assert.ok(csvCell(value).startsWith('"\''), JSON.stringify(value));
  }
  assert.equal(csvCell('normal, "quoted"\ntext'), '"normal, ""quoted""\ntext"');
  assert.equal(sourceURL("https://user:pass@docs.test/path?token=secret#private"), "https://docs.test/path");
  for (const url of ["javascript:alert(1)", "data:text/html,bad", "file:///private", "not a URL"]) assert.equal(sourceURL(url), "");
});

function content() {
  const events = {}, messages = [], timers = new Map();
  let timerId = 0;
  class Element {
    constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    attachShadow(options) { this.shadowMode = options.mode; return this.testShadow = new Element("shadow"); }
    click(trusted = false) { const event = { isTrusted: trusted }; return this.listeners.click?.(event) ?? this.onclick?.(event); }
  }
  const root = new Element("root"); root.clientWidth = 1200;
  const selection = { toString: () => "example text", rangeCount: 1,
    anchorNode: { nodeType: 3, parentElement: { closest: () => ({ innerText: "context" }) } },
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 10, top: 10, bottom: 20 }) }) };
  const sandbox = {
    document: { documentElement: root, title: "Document", createElement: (tag) => new Element(tag), addEventListener: (type, fn) => { events[type] = fn; } },
    window: { scrollX: 0, scrollY: 0, getSelection: () => selection }, self: {}, Node: { TEXT_NODE: 3 },
    setTimeout(fn, delay) { if (delay === 0) fn(); else timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { sendMessage(msg, callback) { messages.push(msg); const res = { ok: true, text: "번역" }; callback?.(res); return Promise.resolve(res); } } },
  };
  vm.runInNewContext(source("content.js"), sandbox);
  return { root, messages, timers, select(trusted) { events.mouseup({ isTrusted: trusted, composedPath: () => [] }); } };
}

test("synthetic selection and clicks cannot translate, explain, or save", async () => {
  const c = content();
  c.select(false);
  assert.equal(c.root.children.length, 0);
  c.select(true);
  const host = c.root.children[0];
  assert.equal(host.shadowMode, "closed");
  const bubble = host.testShadow.children[1];
  await bubble.click(false);
  assert.equal(c.messages.length, 0);
  await bubble.click(true);
  assert.equal(c.messages.length, 1); // trusted fallback translation
  const actions = host.testShadow.children[2].children[6].children;
  await actions[0].click(false);
  await actions[1].click(false);
  assert.equal(c.messages.length, 1);
  await actions[0].click(true);
  await actions[1].click(true);
  assert.deepEqual(c.messages.map((m) => m.type), ["llm", "llm", "saveWord"]);
  assert.equal(c.timers.size, 0);
  assert.equal(c.messages[2].entry.url, undefined);
});

test("popup export uses formula defense and URL sanitization for every text field", () => {
  const context = vm.createContext({ URL });
  vm.runInContext(source("security.js"), context);
  const popup = source("popup.js");
  vm.runInContext(popup.slice(popup.indexOf("function toCSV("), popup.indexOf('document.getElementById("export")')), context);
  const csv = context.toCSV([{ ...entry, text: "=1+1", translation: "+SUM(1,2)", explanation: "@SUM(1,2)", context: " -1+1", url: pageSender.url, createdAt: 0 }]);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'+SUM(1,2)"'));
  assert.ok(csv.includes('"\'@SUM(1,2)"'));
  assert.ok(csv.includes('"\' -1+1"'));
  assert.ok(!csv.includes("private"));
  assert.ok(!csv.includes("secret"));
});

function extensionPage(file, w, sender) {
  class Element {
    constructor() { this.value = ""; this.checked = false; this.children = []; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
  }
  const elements = Object.fromEntries([...source(file.replace(".js", ".html")).matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  const injections = [];
  const sandbox = vm.createContext({
    URL, Blob, confirm: () => true,
    document: { getElementById: (id) => { assert.ok(elements[id], `missing HTML element: ${id}`); return elements[id]; }, createElement: () => new Element() },
    chrome: {
      runtime: { sendMessage: (message) => w.send(message, sender), async openOptionsPage() {} },
      tabs: { async query() { return [{ id: 1, url: pageSender.url }]; } },
      scripting: { async executeScript(injection) { injections.push(injection); } },
    },
  });
  vm.runInContext(source("security.js"), sandbox);
  vm.runInContext(source(file), sandbox);
  return { elements, injections };
}

test("settings page loads and saves via Worker with explicit consent and session-only key", async () => {
  const w = worker();
  const { elements } = extensionPage("options.js", w, optionsSender);
  await new Promise(setImmediate);
  assert.equal(elements.save.disabled, false);
  assert.equal(elements.allowCloudTranslation.checked, false);
  assert.equal(elements.allowCloudExplanation.checked, false);
  elements.apiKey.value = "  test-key  ";
  elements.allowCloudExplanation.checked = true;
  await elements.save.onclick();
  assert.equal(w.session.apiKey, "test-key");
  assert.equal(w.local.settings.apiKey, undefined);
  assert.equal(w.local.settings.allowCloudExplanation, true);
  assert.equal(w.local.settings.allowCloudTranslation, false);
  assert.match(elements.status.textContent, /저장했습니다/);
});

test("popup renders, activates only the top frame, and deletes via Worker", async () => {
  const w = await configured();
  await w.send({ type: "saveWord", entry });
  const { elements, injections } = extensionPage("popup.js", w, popupSender);
  await new Promise(setImmediate);
  assert.equal(elements.list.children.length, 1);
  const meta = elements.list.children[0].children.at(-1);
  assert.equal(meta.children[0].href, "https://docs.test/guide");
  assert.equal(meta.children[0].rel, "noopener noreferrer");
  await elements.enable.onclick();
  assert.equal(injections[0].target.tabId, 1);
  assert.deepEqual(Array.from(injections[0].target.frameIds), [0]);
  assert.deepEqual(Array.from(injections[0].files), ["content.js"]);
  await meta.children[1].onclick();
  assert.equal(w.local.vocab.length, 0);
  await w.send({ type: "saveWord", entry });
  await elements.clear.onclick();
  assert.equal(w.local.vocab.length, 0);
});

test("storage initialization failure blocks API requests", async () => {
  const w = worker({ securityVersion: 1, settings });
  // get() is async; failing the subsequent migration access simulates corrupt storage.
  const broken = worker({ settings, vocab: null });
  assert.equal((await broken.send(llm)).ok, false);
  assert.equal(broken.requests.length, 0);
  assert.equal((await w.send({ type: "getSettings" }, optionsSender)).ok, true);
});

test("malformed and oversized API output is rejected", async () => {
  for (const content of [null, {}, "A".repeat(12001)]) {
    const w = await configured(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }));
    assert.equal((await w.send(llm)).ok, false);
  }
});
