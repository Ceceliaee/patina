import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import { resolveCanonicalExecutable } from "../../../shared/classification/processNormalization.ts";
import type { AppOverride, MappingHints } from "../../../shared/classification/processMapper.ts";

const LEGACY_CATEGORY_BY_EXECUTABLE: Record<string, UserAssignableAppCategory> = {
  "chrome.exe": "browser",
  "msedge.exe": "browser",
  "firefox.exe": "browser",
  "opera.exe": "browser",
  "brave.exe": "browser",
  "vivaldi.exe": "browser",
  "arc.exe": "browser",
  "code.exe": "development",
  "codex.exe": "development",
  "vscodium.exe": "development",
  "cursor.exe": "development",
  "alma.exe": "ai",
  "antigravity.exe": "development",
  "idea64.exe": "development",
  "pycharm64.exe": "development",
  "webstorm64.exe": "development",
  "clion64.exe": "development",
  "goland64.exe": "development",
  "rider64.exe": "development",
  "devenv.exe": "development",
  "sublime_text.exe": "development",
  "notepad++.exe": "development",
  "vim.exe": "development",
  "nvim.exe": "development",
  "wechat.exe": "communication",
  "weixin.exe": "communication",
  "qq.exe": "communication",
  "qqnt.exe": "communication",
  "discord.exe": "communication",
  "slack.exe": "communication",
  "telegram.exe": "communication",
  "lark.exe": "communication",
  "dingtalk.exe": "communication",
  "teams.exe": "office",
  "zoom.exe": "office",
  "todesk.exe": "utility",
  "teamviewer.exe": "utility",
  "anydesk.exe": "utility",
  "wps.exe": "office",
  "wpsoffice.exe": "office",
  "et.exe": "office",
  "wpp.exe": "office",
  "winword.exe": "office",
  "excel.exe": "office",
  "powerpnt.exe": "office",
  "onenote.exe": "office",
  "obsidian.exe": "browser",
  "notion.exe": "office",
  "typora.exe": "browser",
  "zotero.exe": "browser",
  "spotify.exe": "music",
  "vlc.exe": "video",
  "steam.exe": "game",
  "epicgameslauncher.exe": "game",
  "leagueclient.exe": "game",
  "valorant.exe": "game",
  "csgo.exe": "game",
  "cs2.exe": "game",
  "bilibili.exe": "video",
  "douyin.exe": "video",
  "qqmusic.exe": "music",
  "neteasemusic.exe": "music",
  "hoyoplay.exe": "game",
  "powershell.exe": "development",
  "pwsh.exe": "development",
  "cmd.exe": "development",
  "windowsterminal.exe": "development",
  "wt.exe": "development",
  "conhost.exe": "development",
  "openconsole.exe": "development",
  "explorer.exe": "utility",
  "ui32.exe": "utility",
  "wallpaper32.exe": "utility",
  "wallpaper64.exe": "utility",
  "wallpaperengine.exe": "utility",
};

const LEGACY_CATEGORY_BY_KEYWORD: Array<{
  category: UserAssignableAppCategory;
  keywords: string[];
}> = [
  { category: "ai", keywords: ["alma", "chatgpt", "openai", "claude", "anthropic", "gemini", "copilot", "deepseek", "kimi", "qwen", "tongyi", "yuanbao", "ollama", "llm", "aistudio", "anythingllm"] },
  { category: "development", keywords: ["vscode", "vscodium", "cursor", "idea", "goland", "pycharm", "webstorm", "clion", "rider", "dev", "code"] },
  { category: "office", keywords: ["office", "word", "excel", "powerpoint", "wps", "onenote", "calendar", "outlook"] },
  { category: "browser", keywords: ["chrome", "edge", "firefox", "browser", "safari", "vivaldi", "opera", "brave", "arc"] },
  { category: "communication", keywords: ["wechat", "weixin", "qq", "telegram", "discord", "slack", "lark", "dingtalk"] },
  { category: "office", keywords: ["zoom", "teams", "meeting", "voov", "tencent meeting"] },
  { category: "video", keywords: ["douyin", "bilibili", "youtube", "netflix", "player", "video"] },
  { category: "music", keywords: ["spotify", "music", "netease", "qqmusic"] },
  { category: "game", keywords: ["steam", "epic", "hoyoplay", "mihoyo", "genshin", "star rail", "valorant", "league", "game"] },
  { category: "design", keywords: ["figma", "sketch", "photoshop", "illustrator", "after effects", "adobe xd", "canva"] },
  { category: "browser", keywords: ["obsidian", "zotero", "typora", "reader", "pdf", "kindle", "book"] },
  { category: "utility", keywords: ["trader", "bank", "finance", "stock", "binance", "okx", "huobi"] },
  { category: "utility", keywords: ["todesk", "teamviewer", "anydesk", "terminal", "flash", "snip", "screenshot", "tool", "utility"] },
];

interface LegacyObservedApp {
  exeName: string;
  appName?: string;
}

function normalizeDisplayName(value: string | undefined): string {
  return (value ?? "").trim().replace(/\.exe$/i, "");
}

export function resolveLegacyAutoClassification(
  exeName: string,
  hints: MappingHints = {},
): UserAssignableAppCategory | null {
  const canonicalExe = resolveCanonicalExecutable(exeName);
  const knownCategory = LEGACY_CATEGORY_BY_EXECUTABLE[canonicalExe];
  if (knownCategory) {
    return knownCategory;
  }

  const searchText = [canonicalExe, normalizeDisplayName(hints.appName)]
    .join(" ")
    .toLowerCase();
  for (const rule of LEGACY_CATEGORY_BY_KEYWORD) {
    if (rule.keywords.some((keyword) => searchText.includes(keyword))) {
      return rule.category;
    }
  }

  return null;
}

export function buildLegacyAutoClassificationOverrides(
  observed: readonly LegacyObservedApp[],
  existingOverrides: Readonly<Record<string, AppOverride>>,
  migratedAt: number,
): Record<string, AppOverride> {
  const migratedOverrides: Record<string, AppOverride> = {};

  for (const candidate of observed) {
    const canonicalExe = resolveCanonicalExecutable(candidate.exeName);
    if (!canonicalExe || migratedOverrides[canonicalExe]) {
      continue;
    }

    const current = existingOverrides[canonicalExe] ?? null;
    if (current?.category) {
      continue;
    }

    const category = resolveLegacyAutoClassification(canonicalExe, { appName: candidate.appName });
    if (!category) {
      continue;
    }

    migratedOverrides[canonicalExe] = {
      ...current,
      category,
      enabled: true,
      updatedAt: current?.updatedAt ?? migratedAt,
    };
  }

  return migratedOverrides;
}
