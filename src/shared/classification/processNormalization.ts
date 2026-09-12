const DERIVED_ALIAS_SUFFIXES = [
  "webhelper",
  "helper",
  "widget",
  "tray",
];

// Only owners with verified component naming conventions may use the generic
// helper/widget/tray suffix parser. Presence in a display-name catalog is not
// evidence that two executables share an application identity.
const DERIVED_COMPONENT_OWNER_EXES = new Set([
  "douyin.exe",
  "steam.exe",
]);

// Lifecycle executables are normally filtered before aggregation. These
// owners remain explicit so canonicalization never guesses an arbitrary
// product identity from installer/update naming alone.
const LIFECYCLE_ALIAS_OWNER_EXES = new Set([
  "alma.exe",
  "cursor.exe",
  "notion.exe",
  "obsidian.exe",
]);

// This equivalence is scoped to compact lifecycle metadata matching. It does
// not merge the main application executables in statistics.
const LIFECYCLE_METADATA_STEM_ALIASES: Readonly<Record<string, string>> = {
  weixin: "wechat",
};

const LIFECYCLE_ALIAS_MARKERS = [
  "uninstaller",
  "uninstall",
  "installer",
  "install",
  "updater",
  "update",
  "setup",
  "upgrade",
  "unins000",
  "unins",
  "remove",
  "maintenancetool",
  "maintenance",
];

const LIFECYCLE_ALIAS_MARKER_SET = new Set(LIFECYCLE_ALIAS_MARKERS);
const STANDALONE_UNINSTALLER_APP_IDENTITIES = new Set([
  "geek",
  "geekuninstaller",
  "revouninstaller",
  "revouninstallerpro",
  "iobituninstaller",
  "hibituninstaller",
  "bcuninstaller",
  "bulkcrapuninstaller",
  "uninstalr",
]);
const LIFECYCLE_ALIAS_NOISE_TOKENS = new Set([
  ...LIFECYCLE_ALIAS_MARKERS,
  "win",
  "windows",
  "x64",
  "x86",
  "amd64",
  "arm64",
  "ia32",
  "portable",
  "release",
  "latest",
  "beta",
  "alpha",
  "nightly",
  "stable",
  "desktop",
  "app",
]);

const LIFECYCLE_ALIAS_PATTERN = LIFECYCLE_ALIAS_MARKERS.join("|");
const LIFECYCLE_ALIAS_SUFFIX_PATTERN = new RegExp(
  `^(.+?)[_\\-. ](?:${LIFECYCLE_ALIAS_PATTERN})(?:[_\\-. ].*)?$`,
);
const LIFECYCLE_ALIAS_PREFIX_PATTERN = new RegExp(`^(?:${LIFECYCLE_ALIAS_PATTERN})[_\\-. ](.+)$`);
const LIFECYCLE_TRACKING_MARKERS = new Set([
  "setup",
  "install",
  "installer",
  "uninstall",
  "uninstaller",
  "unins",
  "unins000",
  "update",
  "updater",
  "upgrade",
  "remove",
  "maintenance",
  "maintenancetool",
]);
const LIFECYCLE_TITLE_MARKERS = new Set([
  ...LIFECYCLE_TRACKING_MARKERS,
  "installation",
  "installing",
  "uninstallation",
  "uninstalling",
  "updating",
]);
const LIFECYCLE_METADATA_BUILD_TOKENS = new Set([
  "win",
  "windows",
  "x64",
  "x86",
  "amd64",
  "arm64",
  "ia32",
  "portable",
  "release",
  "latest",
  "beta",
  "alpha",
  "nightly",
  "stable",
  "desktop",
  "app",
]);

const NON_TRACKABLE_EXE_NAMES = new Set([
  "",
  "msiexec.exe",
  "msiexec",
  "uninstall.exe",
  "uninstall",
  "unins000.exe",
  "unins000",
  "unins.exe",
  "unins",
  "un_a.exe",
  "un_a",
  "hrupdate.exe",
  "hrupdate",
]);

const READ_MODEL_BLOCKED_EXE_NAMES = new Set([
  "control.exe",
  "control",
  "consent.exe",
  "consent",
  "csrss.exe",
  "csrss",
  "dwm.exe",
  "dwm",
  "fontdrvhost.exe",
  "fontdrvhost",
  "gameinputsvc.exe",
  "gameinputsvc",
  "logonui.exe",
  "logonui",
  "lsass.exe",
  "lsass",
  "mmc.exe",
  "mmc",
  "regedit.exe",
  "regedit",
  "runtimebroker.exe",
  "runtimebroker",
  "services.exe",
  "services",
  "sihost.exe",
  "sihost",
  "smss.exe",
  "smss",
  "system",
  "svchost.exe",
  "svchost",
  "usoclient.exe",
  "usoclient",
  "wininit.exe",
  "wininit",
  "winlogon.exe",
  "winlogon",
  "wuauclt.exe",
  "wuauclt",
  "applicationframehost.exe",
  "applicationframehost",
  "lockapp.exe",
  "lockapp",
  "openwith.exe",
  "openwith",
  "pickerhost.exe",
  "pickerhost",
  "searchhost.exe",
  "searchhost",
  "shellhost.exe",
  "shellhost",
  "shellexperiencehost.exe",
  "shellexperiencehost",
  "startmenuexperiencehost.exe",
  "startmenuexperiencehost",
  "taskhostw.exe",
  "taskhostw",
  "taskmgr.exe",
  "taskmgr",
  "textinputhost.exe",
  "textinputhost",
]);

export function normalizeExecutable(exeName: string) {
  return exeName.trim().toLowerCase().replace(/^"+|"+$/g, "");
}

function stripExeSuffix(exeName: string) {
  return exeName.endsWith(".exe") ? exeName.slice(0, -4) : exeName;
}

function isTemporaryExecutable(exeName: string) {
  return normalizeExecutable(exeName).endsWith(".tmp");
}

function normalizeAppIdentityStem(stem: string) {
  return stem.replace(/[^a-z0-9]+/g, "");
}

function isStandaloneUninstallerAppStem(stem: string) {
  return STANDALONE_UNINSTALLER_APP_IDENTITIES.has(normalizeAppIdentityStem(stem));
}

function resolveCompactLifecycleParts(stem: string) {
  for (const marker of LIFECYCLE_TRACKING_MARKERS) {
    if (!stem.endsWith(marker) || stem === marker) {
      continue;
    }

    const baseStem = stem.slice(0, -marker.length);
    if (baseStem.length >= 2 && /[a-z]/.test(baseStem)) {
      return { baseStem, marker };
    }
  }

  return null;
}

function hasCompactLifecycleSuffix(stem: string) {
  return Boolean(resolveCompactLifecycleParts(stem));
}

function areKnownEquivalentAppStems(left: string, right: string) {
  const canonicalLeft = LIFECYCLE_METADATA_STEM_ALIASES[left] ?? left;
  const canonicalRight = LIFECYCLE_METADATA_STEM_ALIASES[right] ?? right;
  return canonicalLeft === canonicalRight;
}

function isLifecycleUtilityExecutable(
  exeName: string,
  appName: string | undefined,
  windowTitle: string | undefined,
) {
  const normalized = normalizeExecutable(exeName);
  const stem = stripExeSuffix(normalized);
  if (!stem) {
    return false;
  }

  if (isStandaloneUninstallerAppStem(stem)) {
    return false;
  }

  if (LIFECYCLE_TRACKING_MARKERS.has(stem)) {
    return true;
  }

  if (
    hasCompactLifecycleSuffix(stem)
    && hasMatchingCompactLifecycleMetadata(stem, [appName, windowTitle])
  ) {
    return true;
  }

  const tokens = stem.split(/[_\-. ]+/).filter(Boolean);
  if (tokens.length < 2) {
    return false;
  }

  return tokens.some((token) => LIFECYCLE_TRACKING_MARKERS.has(token));
}

function isVersionLikeToken(token: string) {
  return /^\d+$/.test(token) || /^v?\d+(?:\.\d+){1,5}$/.test(token);
}

function hasLifecycleMetadataSignal(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized.includes("\u5b89\u88c5")
    || normalized.includes("\u5378\u8f7d")
    || normalized.includes("\u66f4\u65b0")
    || normalized.includes("\u7ef4\u62a4\u5de5\u5177")
  ) {
    return true;
  }

  const englishTokens = normalized
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return englishTokens.some((token) => LIFECYCLE_TITLE_MARKERS.has(token));
}

function normalizeLifecycleMetadataIdentity(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isContextualBlockedProcess(
  exeName: string,
  appName: string | undefined,
  windowTitle: string | undefined,
) {
  const normalized = normalizeExecutable(exeName);
  if (normalized !== "launcher.exe" && normalized !== "launcher") {
    return false;
  }

  return [appName, windowTitle].some((value) => (
    normalizeLifecycleMetadataIdentity(value ?? "") === "wallpaperenginelauncher"
  ));
}

function hasMatchingCompactLifecycleMetadata(stem: string, values: Array<string | undefined>) {
  const parts = resolveCompactLifecycleParts(stem);
  if (!parts) {
    return false;
  }

  return values.some((value) => {
    const metadataStem = normalizeLifecycleMetadataIdentity(value ?? "");
    if (metadataStem === stem) {
      return true;
    }

    const metadataParts = resolveCompactLifecycleParts(metadataStem);
    return Boolean(
      metadataParts
      && metadataParts.marker === parts.marker
      && areKnownEquivalentAppStems(metadataParts.baseStem, parts.baseStem),
    );
  });
}

function isLifecycleMetadataCandidateExecutable(exeName: string) {
  const normalized = normalizeExecutable(exeName);
  const stem = stripExeSuffix(normalized);
  if (!stem) {
    return false;
  }

  const tokens = stem.split(/[_\-. ]+/).filter(Boolean);
  if (tokens.length < 2) {
    return false;
  }

  const hasVersion = tokens.some(isVersionLikeToken);
  if (!hasVersion) {
    return false;
  }

  return tokens.some((token) => LIFECYCLE_METADATA_BUILD_TOKENS.has(token));
}

function isLifecycleMetadataRecord(
  exeName: string,
  appName: string | undefined,
  windowTitle: string | undefined,
) {
  if (!isLifecycleMetadataCandidateExecutable(exeName)) {
    return false;
  }

  return hasLifecycleMetadataSignal(appName ?? "") || hasLifecycleMetadataSignal(windowTitle ?? "");
}

function sanitizeAliasBaseStem(rawStem: string) {
  const trimmed = rawStem.replace(/^[_\-. ]+|[_\-. ]+$/g, "");
  if (!trimmed) {
    return null;
  }

  const tokens = trimmed.split(/[_\-. ]+/).filter(Boolean);
  const baseTokens = tokens.filter((token) => (
    !LIFECYCLE_ALIAS_NOISE_TOKENS.has(token)
    && !isVersionLikeToken(token)
  ));

  if (baseTokens.length === 0) {
    return null;
  }

  const candidate = baseTokens.join("-");
  if (candidate.length < 2 || !/[a-z]/.test(candidate)) {
    return null;
  }

  return candidate;
}

function resolveDerivedAliasExecutable(normalizedExe: string) {
  const stem = stripExeSuffix(normalizedExe);
  if (!stem) return null;

  for (const suffix of DERIVED_ALIAS_SUFFIXES) {
    if (!stem.endsWith(suffix) || stem === suffix) {
      continue;
    }

    const baseStem = stem.slice(0, -suffix.length).replace(/[_\-.]+$/g, "");
    if (!baseStem) {
      continue;
    }

    const candidateExe = `${baseStem}.exe`;
    if (DERIVED_COMPONENT_OWNER_EXES.has(candidateExe)) {
      return candidateExe;
    }
  }

  return null;
}

function resolveExplicitLifecycleOwner(baseStem: string | null) {
  if (!baseStem) {
    return null;
  }

  const candidateExe = `${baseStem}.exe`;
  return LIFECYCLE_ALIAS_OWNER_EXES.has(candidateExe) ? candidateExe : null;
}

function resolveLifecycleAliasExecutable(normalizedExe: string) {
  const stem = stripExeSuffix(normalizedExe);
  if (!stem || !/[_\-. ]/.test(stem)) return null;

  const suffixMatch = stem.match(LIFECYCLE_ALIAS_SUFFIX_PATTERN);
  if (suffixMatch?.[1]) {
    const baseStem = sanitizeAliasBaseStem(suffixMatch[1]);
    const ownerExe = resolveExplicitLifecycleOwner(baseStem);
    if (ownerExe) {
      return ownerExe;
    }
  }

  const prefixMatch = stem.match(LIFECYCLE_ALIAS_PREFIX_PATTERN);
  if (prefixMatch?.[1]) {
    const baseStem = sanitizeAliasBaseStem(prefixMatch[1]);
    const ownerExe = resolveExplicitLifecycleOwner(baseStem);
    if (ownerExe) {
      return ownerExe;
    }
  }

  const tokens = stem.split(/[_\-. ]+/).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }

  const hasVersion = tokens.some(isVersionLikeToken);
  const hasLifecycleMarker = tokens.some((token) => LIFECYCLE_ALIAS_MARKER_SET.has(token));
  const hasBuildContext = tokens.some((token) => LIFECYCLE_ALIAS_NOISE_TOKENS.has(token));

  if (hasVersion && (hasLifecycleMarker || hasBuildContext)) {
    const baseStem = sanitizeAliasBaseStem(tokens[0]);
    const ownerExe = resolveExplicitLifecycleOwner(baseStem);
    if (ownerExe) {
      return ownerExe;
    }
  }

  return null;
}

export function resolveCanonicalExecutable(exeName: string) {
  const normalized = normalizeExecutable(exeName);
  const derivedAlias = resolveDerivedAliasExecutable(normalized);
  if (derivedAlias) {
    return derivedAlias;
  }

  const lifecycleAlias = resolveLifecycleAliasExecutable(normalized);
  if (lifecycleAlias) {
    return lifecycleAlias;
  }

  return normalized;
}

export function shouldTrackProcess(
  exeName: string,
  options: { appName?: string; windowTitle?: string } = {},
) {
  if (isTemporaryExecutable(exeName)) {
    return false;
  }

  if (isLifecycleUtilityExecutable(exeName, options.appName, options.windowTitle)) {
    return false;
  }

  if (isLifecycleMetadataRecord(exeName, options.appName, options.windowTitle)) {
    return false;
  }

  if (isContextualBlockedProcess(exeName, options.appName, options.windowTitle)) {
    return false;
  }

  const canonicalExe = resolveCanonicalExecutable(exeName);
  if (!canonicalExe) return false;
  if (NON_TRACKABLE_EXE_NAMES.has(canonicalExe)) return false;
  if (READ_MODEL_BLOCKED_EXE_NAMES.has(canonicalExe)) return false;

  if (canonicalExe.endsWith(".exe")) {
    const withoutExe = canonicalExe.slice(0, -4);
    if (NON_TRACKABLE_EXE_NAMES.has(withoutExe)) {
      return false;
    }
    if (READ_MODEL_BLOCKED_EXE_NAMES.has(withoutExe)) {
      return false;
    }
  }

  return true;
}
