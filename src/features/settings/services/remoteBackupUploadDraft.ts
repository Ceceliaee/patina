import type { WebDavBackupConfig } from "../../../platform/backup/remoteBackupRuntimeGateway.ts";

export function defaultRemoteBackupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `Patina-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

export function isValidRemoteBackupFileName(fileName: string): boolean {
  const stem = fileName.endsWith(".zip") ? fileName.slice(0, -4) : "";
  return Boolean(stem.trim()) && fileName.trim() === fileName
    && new TextEncoder().encode(fileName).length <= 240
    && !/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/u.test(fileName)
    && !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(stem);
}

export function sameRemoteBackupTarget(left: WebDavBackupConfig, right: WebDavBackupConfig): boolean {
  return left.url === right.url && left.username === right.username && left.remoteDir === right.remoteDir;
}
