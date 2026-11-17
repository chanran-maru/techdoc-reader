// Content script: 텍스트 선택 감지 → 번역 버튼 → 결과 패널
// UI는 Shadow DOM 안에 넣어서 페이지 CSS와 충돌하지 않게 한다.
(() => {
  if (window.__techdocReaderLoaded) return;
  window.__techdocReaderLoaded = true;

  const MAX_LEN = 1000;
  let host, shadow, bubble, panel;
  let current = null; // { text, context, url, title, translation, explanation }
  let translatorPromise = null;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif; }
    .bubble {
      position: absolute; z-index: 2147483647;
      background: #2563eb; color: #fff; border: none; border-radius: 6px;
      padding: 4px 10px; font-size: 13px; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,.2);
    }
    .bubble:hover { background: #1d4ed8; }
    .panel {
      position: absolute; z-index: 2147483647; width: 360px; max-height: 420px; overflow: auto;
      background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 10px;
      padding: 12px 14px; font-size: 14px; line-height: 1.55;
      box-shadow: 0 8px 24px rgba(0,0,0,.15);
    }
    .label { font-size: 11px; font-weight: 600; color: #6b7280; margin: 8px 0 2px; text-transform: uppercase; letter-spacing: .03em; }
    .label:first-child { margin-top: 0; }
    .original { color: #374151; font-style: italic; }
    .result, .explain { white-space: pre-wrap; }
    .muted { color: #9ca3af; }
    .error { color: #b91c1c; }
    .actions { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
    .actions button {
      border: 1px solid #d1d5db; background: #f9fafb; color: #111827; border-radius: 6px;
      padding: 4px 10px; font-size: 12px; cursor: pointer;
    }
    .actions button:hover { background: #f3f4f6; }
    .actions button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .actions button:disabled { opacity: .5; cursor: default; }
    .link { color: #2563eb; cursor: pointer; text-decoration: underline; }
  `;

  // ---------- UI ----------
  function ensureUI() {
    if (host) return;
    host = document.createElement("div");
    host.id = "techdoc-reader-host";
    Object.assign(host.style, { position: "absolute", top: "0", left: "0", width: "0", height: "0", zIndex: "2147483647" });
    shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = STYLE;

    bubble = document.createElement("button");
    bubble.className = "bubble";
    bubble.textContent = "번역";
    bubble.hidden = true;
    bubble.addEventListener("mousedown", (e) => e.preventDefault()); // 선택 해제 방지
    bubble.addEventListener("click", openPanel);

    panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;

    shadow.append(style, bubble, panel);
    document.documentElement.appendChild(host);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // LLM 출력은 항상 textContent로 (XSS 방지)
    return e;
  }

  function placeAt(node, rect, below = true) {
    const x = rect.left + window.scrollX;
    const y = (below ? rect.bottom : rect.top) + window.scrollY + 6;
    const maxX = window.scrollX + document.documentElement.clientWidth - 370;
    node.style.left = `${Math.max(window.scrollX + 8, Math.min(x, maxX))}px`;
    node.style.top = `${y}px`;
  }

  function hideAll() {
    if (!host) return;
    bubble.hidden = true;
    panel.hidden = true;
  }

  // ---------- 선택 처리 ----------
  function getContext(sel, text) {
    const node = sel.anchorNode;
    const elNode = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const block = elNode?.closest?.("p, li, td, th, blockquote, dd, figcaption, h1, h2, h3, h4, h5, pre, div");
    let ctx = (block?.innerText || text).replace(/\s+/g, " ").trim();
    if (ctx.length > 600) {
      const i = Math.max(0, ctx.indexOf(text));
      const start = Math.max(0, i - 250);
      ctx = ctx.slice(start, start + 600);
    }
    return ctx;
  }

  document.addEventListener("mouseup", (e) => {
    if (!e.isTrusted) return;
    if (host && e.composedPath().includes(host)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!text || text.length > MAX_LEN || !/[A-Za-z]/.test(text) || sel.rangeCount === 0) {
        if (bubble && !bubble.hidden) bubble.hidden = true;
        return;
      }
      ensureUI();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      current = {
        text,
        context: getContext(sel, text),
        title: document.title.slice(0, 300),
        rect,
      };
      panel.hidden = true;
      bubble.hidden = false;
      placeAt(bubble, rect);
    }, 0);
  });

  document.addEventListener("mousedown", (e) => {
    if (host && !e.composedPath().includes(host)) hideAll();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideAll();
  });

  // ---------- 번역 ----------
  async function translateBuiltin(text, onProgress) {
    if (!("Translator" in self)) throw new Error("UNSUPPORTED");
    if (!translatorPromise) {
      translatorPromise = (async () => {
        const opts = { sourceLanguage: "en", targetLanguage: "ko" };
        const availability = await Translator.availability(opts);
        if (availability === "unavailable") throw new Error("UNSUPPORTED");
        return Translator.create({
          ...opts,
          monitor(m) {
            m.addEventListener("downloadprogress", (ev) =>
              onProgress?.(`번역 모델 다운로드 중… ${Math.round(ev.loaded * 100)}%`)
            );
          },
        });
      })().catch((err) => {
        translatorPromise = null;
        throw err;
      });
    }
    const translator = await translatorPromise;
    return translator.translate(text);
  }

  function askLLM(mode, data) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "llm", mode, text: data.text, context: data.context }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || "알 수 없는 오류"));
        resolve(res.text);
      });
    });
  }

  async function translate(data, setStatus) {
    let timer;
    try {
      // 외부 전송 허용 여부는 Worker에서 별도로 검사한다.
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("TIMEOUT")), 30000); });
      const text = await Promise.race([translateBuiltin(data.text, setStatus), timeout]);
      return { text, engine: "Chrome 내장 번역" };
    } catch (e) {
      return { text: await askLLM("translate", data), engine: "LLM" };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- 패널 ----------
  function noKeyMessage(target) {
    target.replaceChildren(
      el("span", "error", "API 키가 설정되지 않았습니다. "),
      Object.assign(el("span", "link", "설정 열기"), {
        onclick: (event) => { if (event.isTrusted) chrome.runtime.sendMessage({ type: "openOptions" }); },
      })
    );
  }

  function showError(target, err) {
    if (err.message === "NO_KEY") noKeyMessage(target);
    else {
      target.className = "error";
      target.textContent = `오류: ${err.message}`;
    }
  }

  async function openPanel(event) {
    if (!event.isTrusted || !current || bubble.hidden) return;
    const data = current;
    bubble.hidden = true;
    panel.replaceChildren();

    const resultEl = el("div", "result muted", "번역 중…");
    const engineEl = el("div", "label", "번역");
    const explainLabel = el("div", "label", "AI 설명");
    const explainEl = el("div", "explain");
    explainLabel.hidden = explainEl.hidden = true;

    const explainBtn = el("button", null, "AI 설명");
    const saveBtn = el("button", "primary", "단어장에 저장");
    const closeBtn = el("button", null, "닫기");
    closeBtn.onclick = hideAll;

    explainBtn.onclick = async (event) => {
      if (!event.isTrusted || explainBtn.disabled) return;
      explainBtn.disabled = true;
      explainLabel.hidden = explainEl.hidden = false;
      explainEl.className = "explain muted";
      explainEl.textContent = "설명 생성 중…";
      try {
        data.explanation = await askLLM("explain", data);
        explainEl.className = "explain";
        explainEl.textContent = data.explanation;
      } catch (err) {
        showError(explainEl, err);
        explainBtn.disabled = false;
      }
    };

    saveBtn.onclick = async (event) => {
      if (!event.isTrusted || saveBtn.disabled) return;
      saveBtn.disabled = true;
      try {
        await saveWord(data);
        saveBtn.textContent = "저장됨 ✓";
      } catch (err) {
        saveBtn.disabled = false;
        showError(resultEl, err);
      }
    };

    const actions = el("div", "actions");
    actions.append(explainBtn, saveBtn, closeBtn);
    panel.append(el("div", "label", "원문"), el("div", "original", data.text), engineEl, resultEl, explainLabel, explainEl, actions);

    panel.hidden = false;
    placeAt(panel, data.rect);

    try {
      const { text, engine } = await translate(data, (msg) => (resultEl.textContent = msg));
      data.translation = text;
      engineEl.textContent = `번역 · ${engine}`;
      resultEl.className = "result";
      resultEl.textContent = text;
    } catch (err) {
      showError(resultEl, err);
    }
  }

  // ---------- 단어장 ----------
  async function saveWord(data) {
    const res = await chrome.runtime.sendMessage({ type: "saveWord", entry: {
      text: data.text,
      translation: data.translation || "",
      explanation: data.explanation || "",
      context: data.context,
      title: data.title,
    } });
    if (!res?.ok) throw new Error(res?.error || "저장하지 못했습니다.");
  }
})();
