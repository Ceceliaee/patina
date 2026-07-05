const PROTOCOL_VERSION = 1;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const DEFAULT_PORT = "12345";
const PORT_PATTERN = /^\d{1,5}$/;
const FAVICON_DATA_URL_MAX_CHARS = 8192;
const FAVICON_DATA_URL_MAX_BYTES = 6144;
const FAVICON_CACHE_LIMIT = 128;
const STORAGE_DEFAULTS = {
  enabled: true,
  port: DEFAULT_PORT,
  token: "",
  clientId: "",
  lastStatus: "disabled",
  lastMessage: "",
  lastSeenAt: 0,
};

let pendingActiveTabTimer = null;
const faviconDataUrlCache = new Map();

function browserKind() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("opr/") || ua.includes("opera")) return "opera";
  if (ua.includes("vivaldi")) return "vivaldi";
  if (ua.includes("brave")) return "brave";
  return "chrome";
}

function setStatus(lastStatus, lastMessage = "") {
  return chrome.storage.local.set({
    lastStatus,
    lastMessage,
    lastSeenAt: Date.now(),
  });
}

async function getSettings() {
  const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
  let clientId = String(settings.clientId || "").trim();
  const storagePatch = {};
  if (!clientId) {
    clientId = crypto.randomUUID();
    storagePatch.clientId = clientId;
  }
  if (settings.enabled !== true) {
    storagePatch.enabled = true;
  }
  if (Object.keys(storagePatch).length > 0) {
    await chrome.storage.local.set(storagePatch);
  }
  const port = normalizePort(settings.port);
  return {
    ...STORAGE_DEFAULTS,
    ...settings,
    clientId,
    port,
    token: String(settings.token || "").trim(),
    enabled: true,
  };
}

function normalizePort(rawPort, fallback = DEFAULT_PORT) {
  const value = String(rawPort || "").trim();
  if (!PORT_PATTERN.test(value)) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return fallback;
  return String(port);
}

function endpointFromPort(port) {
  return `http://127.0.0.1:${port}`;
}

function webActivityUrl(endpoint) {
  const url = new URL(endpoint);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/web-activity";
  }
  return url.toString();
}

function isTrackableTab(tab) {
  const url = String(tab?.url || "");
  return url.startsWith("http://") || url.startsWith("https://");
}

async function getActiveTrackableTab(eventReason) {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = activeTabs[0];
  if (isTrackableTab(activeTab)) return activeTab;
  if (eventReason !== "manual") return null;

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  return tabs
    .filter(isTrackableTab)
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0] || null;
}

function rememberFaviconDataUrl(favIconUrl, dataUrl) {
  faviconDataUrlCache.set(favIconUrl, dataUrl);
  if (faviconDataUrlCache.size <= FAVICON_CACHE_LIMIT) return;
  const firstKey = faviconDataUrlCache.keys().next().value;
  if (firstKey) faviconDataUrlCache.delete(firstKey);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function chromeCachedFaviconUrl(pageUrl) {
  const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
  faviconUrl.searchParams.set("pageUrl", pageUrl);
  faviconUrl.searchParams.set("size", "32");
  return faviconUrl.toString();
}

async function resolveFaviconSource(tab) {
  const raw = String(tab?.favIconUrl || "").trim();
  if (raw.startsWith("data:")) {
    return raw.length <= FAVICON_DATA_URL_MAX_CHARS ? raw : undefined;
  }

  const pageUrl = String(tab?.url || "").trim();
  if (!pageUrl.startsWith("http://") && !pageUrl.startsWith("https://")) return raw || undefined;

  const cacheKey = `${pageUrl}::${raw}`;
  const cached = faviconDataUrlCache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(chromeCachedFaviconUrl(pageUrl), {
      cache: "force-cache",
    });
    if (!response.ok) return raw || undefined;
    const blob = await response.blob();
    if (blob.size <= 0 || blob.size > FAVICON_DATA_URL_MAX_BYTES) return raw || undefined;
    const dataUrl = await blobToDataUrl(blob);
    if (dataUrl.length > FAVICON_DATA_URL_MAX_CHARS) return raw || undefined;
    rememberFaviconDataUrl(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return raw || undefined;
  }
}

async function sendActiveTab(eventReason = "refresh") {
  const settings = await getSettings();
  if (!settings.enabled) {
    await setStatus("disabled");
    return;
  }
  if (!settings.port || !settings.token) {
    await setStatus("needs-config", "请填写端口和 Token。");
    return;
  }

  const tab = await getActiveTrackableTab(eventReason);
  if (!tab) {
    await setStatus("disconnected", "当前没有可同步的网页。");
    return;
  }

  await setStatus("connecting");
  const favIconUrl = await resolveFaviconSource(tab);
  const payload = {
    protocolVersion: PROTOCOL_VERSION,
    browserClientId: settings.clientId,
    browserKind: browserKind(),
    extensionVersion: EXTENSION_VERSION,
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    favIconUrl,
    incognito: tab.incognito,
    capturedAtMs: Date.now(),
    eventReason,
  };

  try {
    const response = await fetch(webActivityUrl(endpointFromPort(settings.port)), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (data?.enabled === false) {
      await setStatus("disabled", "Patina 网页同步未开启。");
      return;
    }
    if (!response.ok || data?.ok === false) {
      await setStatus("error", data?.message || "");
      return;
    }
    await setStatus("connected");
  } catch {
    await setStatus("error");
  }
}

function queueActiveTab(eventReason) {
  if (pendingActiveTabTimer) clearTimeout(pendingActiveTabTimer);
  pendingActiveTabTimer = setTimeout(() => {
    pendingActiveTabTimer = null;
    void sendActiveTab(eventReason);
  }, 200);
}

chrome.runtime.onInstalled.addListener(() => {
  void getSettings().then(() => queueActiveTab("installed"));
  chrome.alarms.create("patina-active-tab-sync", { periodInMinutes: 0.5 });
});

chrome.runtime.onStartup.addListener(() => {
  queueActiveTab("startup");
  chrome.alarms.create("patina-active-tab-sync", { periodInMinutes: 0.5 });
});

chrome.tabs.onActivated.addListener(() => queueActiveTab("tab-activated"));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) queueActiveTab("window-focused");
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete" || changeInfo.favIconUrl) {
    queueActiveTab("tab-updated");
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "patina-active-tab-sync") return;
  queueActiveTab("periodic");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.enabled?.newValue === true) {
    queueActiveTab("settings-enabled");
  }
  if (changes.enabled?.newValue === false) {
    void setStatus("disabled");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "patina-connect-now" || message?.type === "patina-send-active-tab") {
    void sendActiveTab("manual").then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

queueActiveTab("startup");
