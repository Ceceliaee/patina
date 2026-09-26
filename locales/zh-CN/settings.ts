// zh-CN settings locale resource. Pure data only.
export const MESSAGES = {
  "settings.timeRulesTitle": "时间规则",
  "settings.recordingOptionsTitle": "记录选项",
  "settings.themeGroupTitle": "主题",
  "settings.interfaceGroupTitle": "界面",
  "settings.windowBehaviorTitle": "窗口行为",
  "settings.runtimeBehaviorTitle": "运行行为",
  "settings.showTrayIconLabel": "显示托盘图标",
"settings.webDavUploadTitle": "上传远程备份",
"settings.webDavUploadDescription": "确认保存位置和文件名后上传。",
"settings.webDavUploadAction": "上传",
"settings.webDavFileName": "文件名",
"settings.webDavInvalidFileName": "请输入有效的 ZIP 文件名，不要包含路径或特殊字符。",
"settings.webDavNameConflict": "此目录已有同名文件，请修改文件名后重试。",
"settings.webDavTargetChanged": "备份配置已变化，请关闭窗口并重新确认目标。",
"settings.webDavDirectoryFailed": "无法准备远端目录，请检查服务器地址、目录权限和网络后重试。",
"settings.webDavUploadUncertain": "备份未能确认上传成功，请检查远端目录和网络。同名文件不会被覆盖，本地数据未受影响。",
  "settings.appearanceTitle": "外观",
  "settings.backgroundOptimizationHint": "后台闲置时释放主界面内存；再次打开可能略有延迟。",
  "settings.backgroundOptimizationLabel": "低耗后台",
  "settings.backupExportAction": "备份",
  "settings.backupExporting": "备份中...",
  "settings.backupExportTitle": "备份",
  "settings.backupRestoreAction": "恢复",
  "settings.backupRestoreActionHelp": "旧版备份格式：结构化数据备份\n当前备份格式：SQLite 数据快照\n旧版恢复兼容至：2026 年 10 月 18 日",
  "settings.backupRestoreActionTitle": "恢复",
  "settings.backupRestoreTitle": "备份与恢复",
  "settings.backupRestoring": "恢复中...",
  "settings.backupTargetLocalHint": "保存为本机 ZIP 文件。",
  "settings.backupTargetLocalTitle": "本地备份",
  "settings.backupTargetRemoteHint": "上传到已绑定的 WebDAV。",
  "settings.backupTargetRemoteTitle": "WebDAV 备份",
  "settings.backupTargetTitle": "选择备份位置",
  "settings.betaLabel": "Beta",
  "settings.cancel": "取消",
  "settings.cancelled": "已撤销本次编辑",
  "settings.cleanup": "数据管理",
  "settings.cleanupConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "将删除 ",
        {
          "$op": "arg",
          "name": "label"
        },
        " 及以前的全部应用与网页记录，包括外部导入记录。"
      ]
    }
  },
  "settings.cleanupConfirmTitle": "确认清理历史记录",
  "settings.cleanupHint": "删除所选时间及以前的应用与网页记录，包括外部导入记录。操作无法撤销。",
  "settings.cleanupNow": "清理",
  "settings.cleanupRangeLabel": "清理时间",
  "settings.cleanupRangeLabels": {
    "7": "7 天前",
    "15": "15 天前",
    "30": "30 天前",
    "60": "60 天前",
    "90": "90 天前",
    "180": "180 天前"
  },
  "settings.cleanupRunning": "正在清理...",
  "settings.cleanupTitle": "清理历史记录",
  "settings.closeToTrayLabel": "关闭到后台",
  "settings.colorSchemeDialogFallbackTitle": "主题",
  "settings.colorSchemeLabel": "配色方案",
  "settings.colorSchemeSaving": "保存中",
  "settings.confirmRangeFallback": "所选时间",
  "settings.dataExportAction": "导出",
  "settings.dataExportTitle": "导出与导入",
  "settings.dataImport.availableLabel": "可导入记录",
  "settings.dataImport.batchesDescription": "仅删除所选导入批次；Patina 原生数据不受影响。",
  "settings.dataImport.batchesTitle": "删除外部导入数据",
  "settings.dataImport.batchTitle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "第 ",
        {
          "$op": "arg",
          "name": "number"
        },
        " 次导入"
      ]
    }
  },
  "settings.dataImport.categorizedAppsLabel": "含分类应用",
  "settings.dataImport.categoryConflictNote": "同一应用出现多个分类时保持未分类，可稍后在分类页手动设置。",
  "settings.dataImport.conflictedAppsLabel": "分类冲突应用",
  "settings.dataImport.csvHint": "选择通用 CSV 文件导入。",
  "settings.dataImport.csvTitle": "导入 CSV",
  "settings.dataImport.deleteBatchAction": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "删除第 ",
        {
          "$op": "arg",
          "name": "number"
        },
        " 次导入"
      ]
    }
  },
  "settings.dataImport.deleteConfirmAction": "删除",
  "settings.dataImport.deleteConfirmDescription": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "将删除来自 ",
        {
          "$op": "arg",
          "name": "sourceName"
        },
        " 的全部外部记录。此操作无法撤销。"
      ]
    }
  },
  "settings.dataImport.deleteConfirmTitle": "删除这次导入？",
  "settings.dataImport.deleteSuccess": {
    "$type": "message",
    "body": { "$op": "plural", "arg": "count", "cases": { "other": { "$op": "concat", "parts": ["已删除 ", { "$op": "arg", "name": "count" }, " 条外部记录"] } } }
  },
  "settings.dataImport.destructureFormatsHint": "目前支持：\nCSV 文件（.csv）：Tai\nSQLite 文件（.db、.sqlite）：Tai、Taix",
  "settings.dataImport.destructureHint": "将外部文件转换为通用 CSV。",
  "settings.dataImport.destructureTitle": "解构工具",
  "settings.dataImport.destructureSuccess": {
    "$type": "message",
    "body": { "$op": "plural", "arg": "count", "cases": { "other": { "$op": "concat", "parts": ["已生成 ", { "$op": "arg", "name": "count" }, " 条记录：", { "$op": "arg", "name": "path" }] } } }
  },
  "settings.dataImport.detailSeparator": "：",
  "settings.dataImport.dialogTitle": "选择导入方式",
  "settings.dataImport.duplicateLabel": "重复记录",
  "settings.dataImport.errorLabel": "无效记录",
  "settings.dataImport.exactLabel": "精确记录",
  "settings.dataImport.fileLabel": "导入文件",
  "settings.dataImport.hourLabel": "小时汇总",
  "settings.dataImport.importSuccess": {
    "$type": "message",
    "body": { "$op": "plural", "arg": "count", "cases": { "other": { "$op": "concat", "parts": ["已导入 ", { "$op": "arg", "name": "count" }, " 条记录"] } } }
  },
  "settings.dataImport.lineError": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "第 ",
        {
          "$op": "arg",
          "name": "line"
        },
        " 行：",
        {
          "$op": "arg",
          "name": "message"
        },
        ""
      ]
    }
  },
  "settings.dataImport.previewTitle": "导入预览",
  "settings.dataImportAction": "导入",
  "settings.dataSafetyTitle": "存储",
  "settings.decreaseCleanupRange": "缩短清理范围",
  "settings.decreaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "label"
        },
        "减少 1 分钟"
      ]
    }
  },
  "settings.dynamicEffectsLabel": "灵动视效",
  "settings.globalTitleHint": "保存应用窗口标题和网页标题，用于历史活动明细。",
  "settings.globalTitleLabel": "全局标题",
  "settings.idle": "已保存",
  "settings.idleTimeoutHint": "当前应用有音频等持续信号时，继续计入这段时间。",
  "settings.idleTimeoutLabel": "持续计入时间",
  "settings.importRecordCount": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "count"
        },
        " 条导入记录"
      ]
    }
  },
  "settings.increaseCleanupRange": "延长清理范围",
  "settings.increaseMinute": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "label"
        },
        "增加 1 分钟"
      ]
    }
  },
  "settings.languageLabel": "语言",
  "settings.languageLoadFailed": "语言加载失败，继续使用当前语言。",
  "settings.languageOptions.enUS": "English",
  "settings.languageOptions.zhCN": "中文",
  "settings.launchAtLoginLabel": "开机自启动",
  "settings.loadFailed": "设置加载失败。",
  "settings.loading": "正在获取配置...",
  "settings.minimizeToWidgetLabel": "最小化到挂件",
  "settings.minuteValue": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "minutes"
        },
        " 分钟"
      ]
    }
  },
  "settings.remoteBackupTitle": "WebDAV 配置",
  "settings.remoteStatusBridgeMachineIdLabel": "本机标识",
  "settings.remoteStatusBridgeTitle": "远程推送",
  "settings.remoteStatusBridgeTokenLabel": "Token",
  "settings.remoteStatusBridgeUrlLabel": "接收地址",
  "settings.residentTitle": "常驻",
  "settings.restoreConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "恢复策略：",
        {
          "$op": "arg",
          "name": "strategy"
        },
        "\n目标文件：",
        {
          "$op": "arg",
          "name": "path"
        },
        "\n\n",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "settings.restoreConfirmTitle": "恢复备份",
  "settings.restoreSourceLocalHint": "选择本机 ZIP 文件。",
  "settings.restoreSourceLocalTitle": "本地恢复",
  "settings.restoreSourceRemoteHint": "选择 WebDAV 备份文件。",
  "settings.restoreSourceRemoteTitle": "WebDAV 恢复",
  "settings.restoreSourceTitle": "选择恢复来源",
  "settings.restoreStrategyHint": "选择恢复时如何处理当前数据。",
  "settings.restoreStrategyLabel": "恢复策略",
  "settings.restoreStrategyOptionHints.merge": "保留当前数据并去重",
  "settings.restoreStrategyOptionHints.replace": "恢复后仅保留备份数据",
  "settings.restoreStrategyOptions.merge": "合并",
  "settings.restoreStrategyOptions.replace": "覆盖",
  "settings.retry": "重试",
  "settings.save": "保存",
  "settings.saved": "配置已更新",
  "settings.saveFailed": "配置保存失败，请稍后重试。",
  "settings.scheduledBackupCleanupWarning": "最新备份有效，但上一份自动备份暂未清理；Patina 将稍后重试。",
  "settings.scheduledBackupLabels": {
    "directory": "保存到",
    "frequency": "频率",
    "nextExecution": "下次执行",
    "recentFailure": "最近失败",
    "recentSuccess": "最近成功",
    "time": "时间",
    "title": "定时备份"
  },
  "settings.saving": "正在保存...",
  "settings.servicesTitle": "服务",
  "settings.startMinimizedLabel": "静默启动",
  "settings.storage.changePathAction": "更改目录",
  "settings.storage.dataDirectoryLabel": "数据目录",
  "settings.storage.installDirectoryLabel": "安装目录",
  "settings.storage.openDirectoryAction": "打开目录",
  "settings.storage.restartAndApplyAction": "重启并应用",
  "settings.storage.restoreDefaultPathAction": "恢复默认目录",
  "settings.storage.storageCacheMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "当前缓存：",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\n目标缓存：",
        {
          "$op": "arg",
          "name": "targetWebviewRoot"
        },
        "\n\nPatina 将保存当前记录并重新启动，然后使用目标缓存目录。完成前，请不要删除或移动目标目录。"
      ]
    }
  },
  "settings.storage.storageCacheMigrationConfirmTitle": "更改缓存目录",
  "settings.storage.storageDataMigrationConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "当前目录：",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\n目标目录：",
        {
          "$op": "arg",
          "name": "targetDataRoot"
        },
        "\n\nPatina 将保存当前记录并重新启动，然后把数据迁移到目标目录。迁移完成前，请不要删除或移动当前目录和目标目录。"
      ]
    }
  },
  "settings.storage.storageDataMigrationConfirmTitle": "更改数据目录",
  "settings.storage.storageDirectoryTitle": "本机目录",
  "settings.storage.storageMigrationFailed": "无法准备重启，请检查目标目录。",
  "settings.storage.storageOpenDirectoryFailed": "无法打开该目录。",
  "settings.storage.storageRestoreDefaultCacheConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "当前缓存：",
        {
          "$op": "arg",
          "name": "currentWebviewRoot"
        },
        "\n默认缓存：",
        {
          "$op": "arg",
          "name": "defaultWebviewRoot"
        },
        "\n\nPatina 将保存当前记录并重新启动，然后恢复默认缓存目录。完成前，请不要删除或移动默认目录。"
      ]
    }
  },
  "settings.storage.storageRestoreDefaultDataConfirmDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "当前数据：",
        {
          "$op": "arg",
          "name": "currentDataRoot"
        },
        "\n默认数据：",
        {
          "$op": "arg",
          "name": "defaultDataRoot"
        },
        "\n\nPatina 将保存当前记录并重新启动，然后把数据迁移到默认目录。迁移完成前，请不要删除或移动当前目录和默认目录。"
      ]
    }
  },
  "settings.storage.storageSnapshotRefreshAction": "检查存储",
  "settings.storage.storageSnapshotRefreshFailed": "无法检查存储目录。",
  "settings.storage.webviewCacheClearConfirmDetail": "Patina 将保存当前记录并重新启动，在创建窗口前清理可重新生成的 WebView 缓存。",
  "settings.storage.webviewCacheClearConfirmTitle": "重启并清理缓存？",
  "settings.storage.webviewCacheClearFailed": "无法准备缓存清理，请重试。",
  "settings.storage.webviewCacheClearTitle": "清理缓存",
  "settings.storage.webviewCacheDirectoryLabel": "缓存目录",
  "settings.themeLibraryOptions.dark": "深色主题",
  "settings.themeLibraryOptions.light": "浅色主题",
  "settings.themeModeLabel": "主题模式",
  "settings.themeModeOptions.dark": "深色",
  "settings.themeModeOptions.light": "浅色",
  "settings.themeModeOptions.system": "跟随系统",
  "settings.timelineMergeGapHint": "无操作后停止计时；短暂切屏返回，时间线保持连续。",
  "settings.timelineMergeGapLabel": "活动保持时间",
  "settings.title": "设置",
  "settings.tracking": "追踪",
  "settings.trackingPanelTitle": "追踪",
  "settings.trackingPausedLabel": "暂停追踪",
  "settings.unsaved": "有未保存更改",
  "settings.webActivityAddressLabel": "端口",
  "settings.webActivityHelpAction": "使用说明",
  "settings.webActivityHelpCopiedAction": "已复制",
  "settings.webActivityHelpCopyPortAction": "复制端口",
  "settings.webActivityHelpCopyTokenAction": "复制 Token",
  "settings.webActivityHelpNote": "Patina Web Sync 启用并连接成功后：\n• 自动同步当前活动标签页的网站地址、标题和网站图标。\n• 不读取网页正文、表单内容、截图或剪贴板。\n• 不扫描或导入浏览器历史记录。\n• 无痕模式窗口不会写入网页记录。",
  "settings.webActivityHelpSteps": [
    {
      "title": "准备连接信息",
      "description": "扩展需要使用本页的端口和 Token 连接本机 Patina。",
      "details": [
        "复制端口和 Token，稍后粘贴到扩展设置中。"
      ]
    },
    {
      "title": "安装浏览器扩展",
      "description": "选择浏览器，从对应商店安装 Patina Web Sync。",
      "showStoreBadges": true,
      "details": [
        {
          "text": "商店不可用时，可从 Patina Web Sync 发布页手动安装。",
          "links": [
            {
              "label": "打开发布页",
              "href": "https://github.com/Ceceliaee/patina-web-sync/releases/latest"
            }
          ]
        }
      ]
    },
    {
      "title": "配置扩展",
      "description": "打开 Patina Web Sync 设置页，填入本页显示的连接信息。",
      "details": [
        "打开浏览器工具栏里的「扩展程序」菜单。",
        "找到 Patina Web Sync 并打开它。",
        "在弹出的扩展窗口中点击「设置」。",
        "粘贴本页显示的端口和 Token。",
        "也可以从扩展管理页进入：找到 Patina Web Sync，点击「详情」/「详细信息」，再点击「扩展程序选项」。"
      ]
    },
    {
      "title": "同步当前页",
      "description": "打开常规网页后，扩展会同步当前活动页。",
      "details": [
        "打开一个 http/https 网页。",
        "等待 Patina Web Sync 自动同步当前页。",
        "如需立即同步一次，可在扩展弹窗中点击「同步当前页」。"
      ]
    }
  ],
  "settings.webActivityHelpTitle": "网页同步使用说明",
  "settings.webActivityTitle": "网页同步",
  "settings.webActivityTokenLabel": "Token",
  "settings.webDavConfigTitle": "WebDAV 配置",
  "settings.webDavConfigure": "配置",
  "settings.webDavDeleteAction": "删除",
  "settings.webDavDeleteDetail": "这只会删除本机保存的 WebDAV 配置和密码，不会删除远端备份文件。",
  "settings.webDavDeleteTitle": "删除 WebDAV 配置",
  "settings.webDavEdit": "编辑",
  "settings.webDavPassword": "应用密码",
  "settings.webDavRemoteBackupsDescription": "选择一份远端备份；下载后会先校验是否可恢复，再确认恢复。",
  "settings.webDavRemoteBackupsEmpty": "远端暂无可用备份。",
  "settings.webDavRemoteBackupsTitle": "远程备份",
  "settings.webDavRestoreSelected": "恢复",
  "settings.webDavServerUrl": "服务器地址",
  "settings.webDavTestConnection": "测试连接",
  "settings.webDavTesting": "测试中...",
  "settings.webDavUsername": "用户名"
} as const;
