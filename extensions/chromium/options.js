const DEFAULT_PORT = "12345";
const PORT_PATTERN = /^\d{1,5}$/;
const DEFAULT_LANGUAGE = "zh-CN";

const DEFAULTS = {
  enabled: true,
  port: DEFAULT_PORT,
  token: "",
  language: DEFAULT_LANGUAGE,
  lastStatus: "disabled",
  lastMessage: "",
};

const OPTIONS_TEXT = {
  "zh-CN": {
    headerDescription: "把当前活动网页同步到本机 Patina，用于补全桌面时间记录。",
    serviceTitle: "网页同步",
    portLabel: "端口",
    syncButton: "同步当前页",
    saveButton: "保存",
    syncContentTitle: "同步内容",
    syncContentText: "同步当前活动网页的网址、标题和网站图标。",
    ariaLanguage: "Languages",
    showToken: "显示 Token",
    hideToken: "隐藏 Token",
    statusNotEnabled: "未开启",
    statusNotSynced: "未同步",
    statusSynced: "已同步",
    statusSyncing: "同步中",
    statusPendingConfig: "待配置",
    statusSaved: "已保存",
    statusSaving: "保存中",
    invalidToken: "Token 无效",
    missingToken: "请填写 Token",
    syncFailedPrefix: "未同步：",
  },
  en: {
    headerDescription: "Sync the active webpage to local Patina to complete desktop time records.",
    serviceTitle: "Web Sync",
    portLabel: "Port",
    syncButton: "Sync current page",
    saveButton: "Save",
    syncContentTitle: "Synced Data",
    syncContentText: "Syncs the active website, title, and site icon.",
    ariaLanguage: "Languages",
    showToken: "Show Token",
    hideToken: "Hide Token",
    statusNotEnabled: "Off",
    statusNotSynced: "Not synced",
    statusSynced: "Synced",
    statusSyncing: "Syncing",
    statusPendingConfig: "Needs setup",
    statusSaved: "Saved",
    statusSaving: "Saving",
    invalidToken: "Invalid Token",
    missingToken: "Enter Token",
    syncFailedPrefix: "Not synced: ",
  },
};

const form = document.querySelector("#options-form");
const portInput = document.querySelector("#port");
const tokenInput = document.querySelector("#token");
const statusText = document.querySelector("#status");
const testButton = document.querySelector("#test");
const toggleTokenButton = document.querySelector("#toggle-token");
const languageButton = document.querySelector("#language-button");
const languageMenu = document.querySelector("#language-menu");
const languageOptions = Array.from(document.querySelectorAll("[data-language-option]"));

let currentLanguage = DEFAULT_LANGUAGE;
let saveTimer = null;

function normalizeLanguage(language) {
  return language === "en" ? "en" : DEFAULT_LANGUAGE;
}

function copy() {
  return OPTIONS_TEXT[currentLanguage] || OPTIONS_TEXT[DEFAULT_LANGUAGE];
}

function applyLanguage() {
  const text = copy();
  document.documentElement.lang = currentLanguage;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (key && Object.prototype.hasOwnProperty.call(text, key)) {
      node.textContent = text[key];
    }
  });
  languageButton.setAttribute("aria-label", text.ariaLanguage);
  languageOptions.forEach((option) => {
    option.setAttribute("aria-checked", String(option.dataset.languageOption === currentLanguage));
  });
  setTokenVisibility(tokenInput.type === "text");
}

function setLanguageMenuOpen(open) {
  languageMenu.hidden = !open;
  languageButton.setAttribute("aria-expanded", String(open));
}

function normalizePort(rawPort, fallback = DEFAULT_PORT) {
  const value = String(rawPort || "").trim();
  if (!PORT_PATTERN.test(value)) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return fallback;
  return String(port);
}

function isValidPort(rawPort) {
  return normalizePort(rawPort, "") !== "";
}

function setStatus(message, tone = "neutral", state = "") {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
  statusText.dataset.state = state;
}

function localizeStatusMessage(message) {
  const value = String(message || "").trim();
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (
    value === "无效"
    || value === "无效。"
    || (normalized.includes("token") && value.includes("无效"))
    || normalized.includes("invalid web activity token")
    || normalized.includes("invalid token")
    || normalized.includes("unauthorized")
  ) {
    return copy().invalidToken;
  }
  if (
    value.includes("请填写 Token")
    || (normalized.includes("missing") && normalized.includes("token"))
  ) {
    return copy().missingToken;
  }
  return value;
}

function formatStatus(status, message, enabled) {
  const text = copy();
  if (!enabled) return { label: text.statusNotEnabled, tone: "neutral", code: "disabled" };
  if (status === "disconnected") {
    return { label: text.statusNotSynced, tone: "neutral", code: "disconnected" };
  }
  if (message) {
    return {
      label: localizeStatusMessage(message),
      tone: status === "error" || status === "needs-config" ? "danger" : "neutral",
      code: status,
    };
  }
  switch (status) {
    case "connected":
      return { label: text.statusSynced, tone: "success", code: "connected" };
    case "connecting":
      return { label: text.statusSyncing, tone: "neutral", code: "connecting" };
    case "needs-config":
      return { label: text.statusPendingConfig, tone: "danger", code: "needs-config" };
    case "configured":
      return { label: text.statusSaved, tone: "success", code: "configured" };
    case "error":
      return { label: text.statusNotSynced, tone: "danger", code: "error" };
    case "disconnected":
      return { label: text.statusNotSynced, tone: "neutral", code: "disconnected" };
    case "disabled":
    default:
      return { label: text.statusNotEnabled, tone: "neutral", code: "disabled" };
  }
}

function configStatus(port, token) {
  const text = copy();
  if (!isValidPort(port)) return { label: text.statusPendingConfig, tone: "danger", code: "needs-config" };
  if (!token.trim()) return { label: text.statusPendingConfig, tone: "danger", code: "needs-config" };
  return { label: text.statusSaved, tone: "success", code: "configured" };
}

function savedSettingsStatus(settings, port) {
  const config = configStatus(port, String(settings.token || ""));
  if (config.code !== "configured") return config;
  if (settings.lastStatus === "error" && settings.lastMessage) {
    return formatStatus(settings.lastStatus, settings.lastMessage, true);
  }
  return config;
}

function syncFormState({ updateStatus = true } = {}) {
  const validPort = isValidPort(portInput.value);
  const hasToken = tokenInput.value.trim().length > 0;
  const status = configStatus(portInput.value, tokenInput.value);
  testButton.disabled = !validPort || !hasToken;
  if (
    updateStatus
    && statusText.dataset.state !== "saving"
    && statusText.dataset.state !== "syncing"
  ) {
    setStatus(status.label, status.tone, status.code);
  }
}

async function load({ resetStatus = true } = {}) {
  const settings = await chrome.storage.local.get(DEFAULTS);
  currentLanguage = normalizeLanguage(settings.language);
  applyLanguage();

  const port = normalizePort(settings.port);
  portInput.value = port;
  tokenInput.value = settings.token || "";
  if (resetStatus) {
    const status = savedSettingsStatus({ ...settings, enabled: true }, port);
    setStatus(status.label, status.tone, status.code);
  }
  syncFormState({ updateStatus: false });
  if (port !== settings.port || settings.enabled !== true || settings.language !== currentLanguage) {
    await chrome.storage.local.set({ enabled: true, port, language: currentLanguage });
  }
}

async function refreshSyncStatus() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  currentLanguage = normalizeLanguage(settings.language);
  applyLanguage();
  const status = formatStatus(settings.lastStatus, settings.lastMessage, true);
  setStatus(status.label, status.tone, status.code);
  syncFormState({ updateStatus: false });
}

async function save() {
  const port = normalizePort(portInput.value, "");
  if (!port) {
    const status = configStatus(portInput.value, tokenInput.value);
    setStatus(status.label, status.tone, status.code);
    syncFormState();
    return false;
  }
  const current = await chrome.storage.local.get(DEFAULTS);
  const token = tokenInput.value.trim();
  const currentPort = normalizePort(current.port, "");
  const currentToken = String(current.token || "").trim();
  const connectionChanged = current.enabled !== true
    || port !== currentPort
    || token !== currentToken;
  const nextSettings = { ...current, enabled: true, port, token, language: currentLanguage };
  const nextStatus = connectionChanged
    ? configStatus(port, token)
    : savedSettingsStatus(nextSettings, port);
  await chrome.storage.local.set({
    enabled: true,
    port,
    token,
    language: currentLanguage,
    ...(!token
      ? { lastStatus: "needs-config", lastMessage: "" }
      : connectionChanged
        ? { lastStatus: "configured", lastMessage: "" }
        : {}),
  });
  setStatus(nextStatus.label, nextStatus.tone, nextStatus.code);
  syncFormState({ updateStatus: false });
  return true;
}

function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  syncFormState();
  setStatus(copy().statusSaving, "neutral", "saving");
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void save();
  }, 250);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});

portInput.addEventListener("input", queueSave);
tokenInput.addEventListener("input", queueSave);

function setTokenVisibility(visible) {
  tokenInput.type = visible ? "text" : "password";
  const label = visible ? copy().hideToken : copy().showToken;
  toggleTokenButton.dataset.visible = String(visible);
  toggleTokenButton.setAttribute("aria-label", label);
  toggleTokenButton.setAttribute("aria-pressed", String(visible));
}

toggleTokenButton.addEventListener("click", () => {
  const shouldShow = tokenInput.type === "password";
  setTokenVisibility(shouldShow);
});

languageButton.addEventListener("click", () => {
  setLanguageMenuOpen(languageMenu.hidden);
});

languageMenu.addEventListener("click", async (event) => {
  const option = event.target.closest("[data-language-option]");
  if (!option) return;
  const nextLanguage = normalizeLanguage(option.dataset.languageOption);
  currentLanguage = nextLanguage;
  applyLanguage();
  setLanguageMenuOpen(false);
  await chrome.storage.local.set({ language: nextLanguage });
  await load({ resetStatus: true });
});

document.addEventListener("click", (event) => {
  if (languageMenu.hidden) return;
  if (event.target.closest(".language-control")) return;
  setLanguageMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setLanguageMenuOpen(false);
});

testButton.addEventListener("click", async () => {
  const saved = await save();
  if (!saved) return;
  if (!tokenInput.value.trim()) {
    setStatus(copy().missingToken, "danger", "needs-config");
    return;
  }

  setStatus(copy().statusSyncing, "neutral", "syncing");
  chrome.runtime.sendMessage({ type: "patina-connect-now" }, () => {
    if (chrome.runtime.lastError) {
      setStatus(`${copy().syncFailedPrefix}${chrome.runtime.lastError.message}`, "danger", "error");
      return;
    }
    window.setTimeout(() => void refreshSyncStatus(), 600);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (
    changes.enabled
    || changes.port
    || changes.token
    || changes.language
    || changes.lastStatus
    || changes.lastMessage
  ) {
    void load({ resetStatus: true });
  }
});

void load();
