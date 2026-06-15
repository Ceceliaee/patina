const DEFAULTS = {
  enabled: false,
  lastStatus: "disabled",
  lastMessage: "",
  lastSeenAt: 0,
};

const statusText = document.querySelector("#status");
const optionsButton = document.querySelector("#options");
const sendTabButton = document.querySelector("#send-tab");

function statusLabel(settings) {
  if (!settings.enabled) return "网页记录已关闭";
  if (settings.lastMessage) return settings.lastMessage;
  switch (settings.lastStatus) {
    case "connected":
      return "当前页已同步到 Patina";
    case "connecting":
      return "正在同步当前页";
    case "needs-config":
      return "请填写端口和 Token";
    case "error":
      return "同步失败，请检查 Patina 设置";
    case "disconnected":
      return "暂无可同步网页";
    default:
      return "等待 Patina";
  }
}

async function render() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  statusText.textContent = statusLabel(settings);
}

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

sendTabButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "patina-send-active-tab" }, () => {
    statusText.textContent = "已请求同步当前页";
    window.setTimeout(() => void render(), 500);
  });
});

void render();
