import type { PersistedRemoteBackupConfig } from "../../../platform/persistence/remoteBackupSettingsStore.ts";

function joinUrlPath(basePath: string, remoteDir: string): string {
  const baseSegments = basePath.split("/").filter(Boolean);
  const remoteSegments = remoteDir.split("/").filter(Boolean);
  const segments = [...baseSegments, ...remoteSegments];
  return segments.length > 0 ? `/${segments.join("/")}` : "";
}

export function formatRemoteBackupTargetSummary(
  config: PersistedRemoteBackupConfig | null,
): string {
  if (!config) return "WebDAV";
  try {
    const url = new URL(config.url);
    return `${url.origin}${joinUrlPath(url.pathname, config.remoteDir)}`;
  } catch {
    const base = config.url.trim().replace(/\/+$/, "");
    const remoteDir = config.remoteDir.trim().replace(/^\/+/, "");
    return [base || "WebDAV", remoteDir].filter(Boolean).join("/");
  }
}
