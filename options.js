const DEFAULT_MODELS = { openai: "gpt-4.1-mini", anthropic: "claude-haiku-4-5" };
const $ = (id) => document.getElementById(id);

function updateHint() {
  $("modelHint").textContent = `기본값: ${DEFAULT_MODELS[$("provider").value]}`;
}

async function request(message) {
  const res = await chrome.runtime.sendMessage(message);
  if (!res?.ok) throw new Error(res?.error || "설정을 처리하지 못했습니다.");
  return res;
}

request({ type: "getSettings" }).then(({ settings }) => {
  $("provider").value = settings.provider || "openai";
  $("apiKey").value = settings.apiKey || "";
  $("model").value = settings.model || "";
  for (const id of ["rememberKey", "allowCloudTranslation", "allowCloudExplanation"]) $(id).checked = settings[id] === true;
  updateHint();
  $("save").disabled = false;
}).catch(() => { $("status").textContent = "설정을 불러오지 못했습니다. 이 페이지를 다시 열어 주세요."; });

$("provider").addEventListener("change", () => {
  $("apiKey").value = "";
  $("status").textContent = "외부 AI를 사용하려면 선택한 제공자의 API 키를 입력하고 저장하세요.";
  updateHint();
});

$("save").onclick = async () => {
  $("save").disabled = true;
  try {
    await request({
      type: "saveSettings",
      settings: {
        provider: $("provider").value,
        apiKey: $("apiKey").value.trim(),
        model: $("model").value.trim(),
        rememberKey: $("rememberKey").checked,
        allowCloudTranslation: $("allowCloudTranslation").checked,
        allowCloudExplanation: $("allowCloudExplanation").checked,
      },
    });
    $("status").textContent = "저장했습니다 ✓";
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("save").disabled = false;
  }
};
