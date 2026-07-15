const ZH_CN_BACKUP_COPY = {
  backup: {
    formatLabel: (kind: "sqlite_snapshot" | "legacy_structured") => (
      kind === "sqlite_snapshot" ? "备份类型：SQLite 数据快照" : "备份类型：旧版迁移备份"
    ),
    exportedAt: (value: string) => `导出时间：${value}`,
    appVersion: (version: string) => `应用版本：${version}`,
    restoreSafety: (message: string) => `恢复状态：${message}`,
    restoreMessage: (key: string | null, args: string[], fallback: string) => {
      if (key === "backup.restore.supported") return "当前版本可以安全恢复此备份。";
      if (key === "backup.restore.schemaTooNew") return "此备份来自更新的数据库结构，请先升级应用。";
      if (key === "backup.restore.versionTooNew") return `此备份格式较新（${args[0] ?? "?"}），请先升级应用。`;
      if (key === "backup.restore.versionTooOld") return "此旧版备份已超出迁移支持窗口。";
      return fallback;
    },
    itemCounts: (sessionCount: number, settingCount: number, iconCacheCount: number) => (
      `活动记录：${sessionCount}，设置：${settingCount}，图标缓存：${iconCacheCount}`
    ),
  },
};

const EN_US_BACKUP_COPY = {
  backup: {
    formatLabel: (kind: "sqlite_snapshot" | "legacy_structured") => (
      kind === "sqlite_snapshot" ? "Backup type: SQLite data snapshot" : "Backup type: legacy migration backup"
    ),
    exportedAt: (value: string) => `Exported at: ${value}`,
    appVersion: (version: string) => `App version: ${version}`,
    restoreSafety: (message: string) => `Restore status: ${message}`,
    restoreMessage: (_key: string | null, _args: string[], fallback: string) => fallback,
    itemCounts: (sessionCount: number, settingCount: number, iconCacheCount: number) => (
      `Activity records: ${sessionCount}, settings: ${settingCount}, cached icons: ${iconCacheCount}`
    ),
  },
};

export const backupCopy = {
  "zh-CN": ZH_CN_BACKUP_COPY,
  "en-US": EN_US_BACKUP_COPY,
} as const;
