const DEFAULT_LANGUAGE = "zh-CN";

const DEFAULTS = {
  enabled: true,
  port: "12345",
  token: "",
  language: DEFAULT_LANGUAGE,
  lastStatus: "disabled",
  lastMessage: "",
};

const POPUP_TEXT = {
  "zh-CN": {
    currentPageLabel: "当前网页",
    loading: "读取中",
    loadingTitle: "读取中...",
    noActivePage: "当前没有活动网页",
    httpOnly: "仅支持普通网站页面（http/https）",
    settings: "设置",
    openSettings: "打开设置",
    completeSetup: "完成配置",
    syncCurrentPage: "同步当前页",
    status: "状态",
    off: "未开启",
    pendingConfig: "待配置",
    pendingSync: "待同步",
    notSynced: "未同步",
    synced: "已同步",
    syncing: "同步中",
    noPage: "无网页",
  },
  en: {
    currentPageLabel: "Current page",
    loading: "Loading",
    loadingTitle: "Loading...",
    noActivePage: "No active webpage",
    httpOnly: "Only regular webpage is supported (http/https)",
    settings: "Settings",
    openSettings: "Open settings",
    completeSetup: "Finish setup",
    syncCurrentPage: "Sync current page",
    status: "Status",
    off: "Off",
    pendingConfig: "Needs setup",
    pendingSync: "Pending",
    notSynced: "Not synced",
    synced: "Synced",
    syncing: "Syncing",
    noPage: "No page",
  },
};

const statusBadge = document.querySelector("#status-badge");
const tabLabel = document.querySelector("#tab-label");
const tabTitle = document.querySelector("#tab-title");
const tabUrl = document.querySelector("#tab-url");
const optionsButton = document.querySelector("#options");
const sendTabButton = document.querySelector("#send-tab");

function normalizeLanguage(language) {
  return language === "en" ? "en" : DEFAULT_LANGUAGE;
}

function copy(language) {
  return POPUP_TEXT[normalizeLanguage(language)] || POPUP_TEXT[DEFAULT_LANGUAGE];
}

function hasConfig(settings) {
  return Boolean(String(settings.port || "").trim() && String(settings.token || "").trim());
}

function isTrackableUrl(url) {
  return String(url || "").startsWith("http://") || String(url || "").startsWith("https://");
}

function formatDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function messageBadge(status, text) {
  switch (status) {
    case "error":
      return { badge: text.notSynced, tone: "danger" };
    case "needs-config":
      return { badge: text.pendingConfig, tone: "danger" };
    case "disabled":
      return { badge: text.off, tone: "neutral" };
    default:
      return { badge: text.status, tone: "neutral" };
  }
}

function statusView(settings, text) {
  if (!settings.enabled) {
    return {
      badge: text.off,
      tone: "neutral",
      actionLabel: text.openSettings,
      canSync: false,
    };
  }
  if (!hasConfig(settings)) {
    return {
      badge: text.pendingConfig,
      tone: "danger",
      actionLabel: text.completeSetup,
      canSync: false,
    };
  }
  if (settings.lastMessage) {
    const messageStatus = messageBadge(settings.lastStatus, text);
    return {
      badge: messageStatus.badge,
      tone: messageStatus.tone,
      actionLabel: text.syncCurrentPage,
      canSync: true,
    };
  }

  switch (settings.lastStatus) {
    case "connected":
      return {
        badge: text.synced,
        tone: "success",
        actionLabel: text.syncCurrentPage,
        canSync: true,
      };
    case "connecting":
      return {
        badge: text.syncing,
        tone: "neutral",
        actionLabel: text.syncCurrentPage,
        canSync: true,
      };
    case "needs-config":
      return {
        badge: text.pendingConfig,
        tone: "danger",
        actionLabel: text.completeSetup,
        canSync: false,
      };
    case "configured":
      return {
        badge: text.pendingSync,
        tone: "neutral",
        actionLabel: text.syncCurrentPage,
        canSync: true,
      };
    case "error":
      return {
        badge: text.notSynced,
        tone: "danger",
        actionLabel: text.syncCurrentPage,
        canSync: true,
      };
    case "disconnected":
      return {
        badge: text.noPage,
        tone: "neutral",
        actionLabel: text.syncCurrentPage,
        canSync: true,
      };
    default:
      return {
        badge: text.pendingSync,
        tone: "neutral",
        actionLabel: text.syncCurrentPage,
        canSync: true,
      };
  }
}

async function render() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  const language = normalizeLanguage(settings.language);
  const text = copy(language);
  document.documentElement.lang = language;
  tabLabel.textContent = text.currentPageLabel;
  optionsButton.textContent = text.settings;

  if (settings.enabled !== true || settings.language !== language) {
    settings.enabled = true;
    settings.language = language;
    await chrome.storage.local.set({ enabled: true, language });
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const view = statusView(settings, text);
  const trackable = isTrackableUrl(activeTab?.url);
  const blockedByPage = Boolean(settings.enabled && hasConfig(settings) && !trackable);

  statusBadge.textContent = blockedByPage ? text.notSynced : view.badge;
  statusBadge.dataset.tone = blockedByPage ? "neutral" : view.tone;

  tabTitle.textContent = trackable ? formatDomain(activeTab.url) : (activeTab?.title || text.noActivePage);
  tabUrl.textContent = trackable ? (activeTab?.title || "") : text.httpOnly;

  sendTabButton.textContent = view.actionLabel;
  sendTabButton.disabled = Boolean(settings.enabled && hasConfig(settings) && !trackable);
  sendTabButton.dataset.mode = view.canSync ? "sync" : "options";
}

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

sendTabButton.addEventListener("click", async () => {
  if (sendTabButton.dataset.mode === "options") {
    chrome.runtime.openOptionsPage();
    return;
  }

  const settings = await chrome.storage.local.get(DEFAULTS);
  const text = copy(settings.language);
  statusBadge.textContent = text.syncing;
  statusBadge.dataset.tone = "neutral";
  chrome.runtime.sendMessage({ type: "patina-send-active-tab" }, () => {
    if (chrome.runtime.lastError) {
      statusBadge.textContent = text.notSynced;
      statusBadge.dataset.tone = "danger";
      return;
    }
    window.setTimeout(() => void render(), 500);
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
    void render();
  }
});

void render();
