const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const qEl = document.getElementById("q");
let vocab = [];
const statusEl = document.getElementById("status");

async function request(message) {
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) throw new Error(res?.error || "요청을 처리하지 못했습니다.");
  return res;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function render() {
  const q = qEl.value.trim().toLowerCase();
  const items = q
    ? vocab.filter((v) => `${v.text} ${v.translation}`.toLowerCase().includes(q))
    : vocab;
  countEl.textContent = `(${vocab.length})`;
  listEl.replaceChildren();

  if (items.length === 0) {
    listEl.append(el("div", "empty", vocab.length ? "검색 결과가 없습니다." : "문서에서 텍스트를 드래그해 저장해보세요."));
    return;
  }

  for (const v of items) {
    const li = el("li");
    li.append(el("div", "word", v.text));
    if (v.translation) li.append(el("div", "tr", v.translation));
    if (v.explanation) li.append(el("div", "ex", v.explanation));

    const meta = el("div", "meta");
    const link = el("a", null, v.title || v.url);
    const sourceURL = TechDocSecurity.sourceURL(v.url);
    if (sourceURL) link.href = sourceURL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = v.context || "";
    const del = el("button", "del", "삭제");
    del.onclick = async () => {
      del.disabled = true;
      try {
        await request({ type: "deleteWord", id: v.id });
        vocab = (await request({ type: "getVocab" })).vocab;
        render();
      } catch (error) {
        statusEl.textContent = error.message;
        del.disabled = false;
      }
    };
    meta.append(link, del);
    li.append(meta);
    listEl.append(li);
  }
}

function toCSV(rows) {
  const esc = TechDocSecurity.csvCell;
  const header = ["text", "translation", "explanation", "context", "url", "savedAt"];
  const lines = rows.map((v) =>
    [v.text, v.translation, v.explanation, v.context, TechDocSecurity.sourceURL(v.url), new Date(v.createdAt).toISOString()].map(esc).join(",")
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n"); // BOM: 엑셀 한글 깨짐 방지
}

document.getElementById("export").onclick = () => {
  const blob = new Blob([toCSV(vocab)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `techdoc-vocab-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

document.getElementById("settings").onclick = () => chrome.runtime.openOptionsPage();
qEl.addEventListener("input", render);

document.getElementById("enable").onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !TechDocSecurity.sourceURL(tab.url)) throw new Error("일반 HTTP/HTTPS 웹페이지에서 사용해 주세요.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["content.js"] });
    statusEl.textContent = "활성화했습니다. 페이지에서 영어 텍스트를 선택하세요. 페이지를 새로 열면 다시 활성화하세요.";
  } catch {
    statusEl.textContent = "이 페이지에서는 활성화할 수 없습니다. 일반 웹페이지에서 다시 시도하세요.";
  }
};

document.getElementById("clear").onclick = async () => {
  if (!confirm("저장한 단어를 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
  try {
    await request({ type: "clearVocab" });
    vocab = [];
    render();
  } catch (error) { statusEl.textContent = error.message; }
};

request({ type: "getVocab" }).then(({ vocab: v = [] }) => {
  vocab = v;
  render();
}).catch(() => { statusEl.textContent = "단어장을 불러오지 못했습니다. 팝업을 다시 열어 주세요."; });
