const DEFAULT_PORT = "17321";
const PORT_PATTERN = /^\d{1,5}$/;

const DEFAULTS = {
  enabled: false,
  port: DEFAULT_PORT,
  token: "",
  lastStatus: "disabled",
  lastMessage: "",
};

const form = document.querySelector("#options-form");
const enabledInput = document.querySelector("#enabled");
const portInput = document.querySelector("#port");
const tokenInput = document.querySelector("#token");
const statusText = document.querySelector("#status");
const testButton = document.querySelector("#test");
let saveTimer = null;

function normalizePort(rawPort, fallback = DEFAULT_PORT) {
  const value = String(rawPort || "").trim();
  if (!PORT_PATTERN.test(value)) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return fallback;
  return String(port);
}

function formatStatus(status, message) {
  if (message) return message;
  switch (status) {
    case "connected":
      return "已同步";
    case "connecting":
      return "同步中";
    case "needs-config":
      return "等待配置";
    case "error":
      return "同步失败";
    case "disconnected":
      return "暂无可同步网页";
    case "disabled":
    default:
      return "已关闭";
  }
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const port = normalizePort(settings.port);
  enabledInput.checked = Boolean(settings.enabled);
  portInput.value = port;
  tokenInput.value = settings.token || "";
  statusText.textContent = formatStatus(settings.lastStatus, settings.lastMessage);
  if (port !== settings.port) {
    await chrome.storage.local.set({ port });
  }
}

async function save() {
  const port = normalizePort(portInput.value, "");
  if (!port) {
    statusText.textContent = "端口无效";
    return false;
  }
  await chrome.storage.local.set({
    enabled: enabledInput.checked,
    port,
    token: tokenInput.value.trim(),
  });
  statusText.textContent = "已保存";
  return true;
}

function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  statusText.textContent = "保存中";
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void save();
  }, 250);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});

enabledInput.addEventListener("change", () => {
  void save();
});

portInput.addEventListener("input", queueSave);
tokenInput.addEventListener("input", queueSave);

testButton.addEventListener("click", async () => {
  const saved = await save();
  if (!saved) return;
  statusText.textContent = "同步中";
  chrome.runtime.sendMessage({ type: "patina-connect-now" }, () => {
    if (chrome.runtime.lastError) {
      statusText.textContent = `同步失败：${chrome.runtime.lastError.message}`;
      return;
    }
    window.setTimeout(() => void load(), 600);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.lastStatus || changes.lastMessage) {
    void load();
  }
});

void load();
