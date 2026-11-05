// zh-CN mapping locale resource. Pure data only.
export const MESSAGES = {

  "mapping.webIndependent": "独立显示",
  "mapping.mergeWebDomain": {"$type": "message", "body": {"$op": "concat", "parts": ["合并到 ", {"$op": "arg", "name": "domain"}]}},
  "mapping.deletionMembers": "删除范围",
  "mapping.deletionLinks": "将移除的关联或独立显示规则",
  "mapping.deletionReminders": "将删除的提醒",
  "mapping.deletionSharedReminders": "其他应用共用，将保留的提醒",
  "mapping.deletionPendingChanges": "请先保存或取消分类更改",
  "mapping.objectDeleted": "已删除所选对象",

  "mapping.webLinks": "自动分组",
  "mapping.addLinkedWebDomain": "添加网页",
  "mapping.backToLinkedWebDomains": "返回关联网页",
  "mapping.mainWebDomain": "主网页",

  "mapping.linkedApps": "关联应用",
  "mapping.addLinkedApp": "添加应用",
  "mapping.mainApp": "主程序",
  "mapping.unlinkApp": "解除关联",
  "mapping.backToLinkedApps": "返回关联应用",
  "mapping.individualControls": "标题、追踪和删除仅作用于所选程序",
  "mapping.saveFailed": "保存失败，请重试。",
  "mapping.deleteFailed": "删除未完成，请重新核对范围后重试。",

  "mapping.titleCaptureOnHint": "标题记录已开启，点击关闭",
  "mapping.titleCaptureOffHint": "标题记录已关闭，点击开启",
  "mapping.trackingOnHint": "匿名统计",
  "mapping.trackingOffHint": "恢复追踪",

  "mapping.appSearchPlaceholder": "搜索应用",
  "mapping.cancel": "取消",
  "mapping.categoryFilter": "筛选分类",
  "mapping.categoryControl": "管理分类",
  "mapping.categoryDialogTitle": "管理分类",
  "mapping.categorySelectLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "label"
        },
        " 的分类"
      ]
    }
  },
  "mapping.color": "颜色",
  "mapping.createCategoryAction": "新建分类",
  "mapping.createCategoryPlaceholder": "例如：学习",
  "mapping.createCategoryTitle": "新建分类",
  "mapping.deleteAppRecords": "删除应用",
  "mapping.deleteObjectDetail": {"$type":"message","body":{"$op":"concat","parts":["将永久删除「",{"$op":"arg","name":"label"},"」的历史、专属配置和图标。"]}},
  "mapping.deleteCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "删除分类：",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.deleteCategoryDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "将删除 ",
        {
          "$op": "arg",
          "name": "label"
        },
        " 分类。"
      ]
    }
  },
  "mapping.deleteCategoryTitle": "删除分类",
  "mapping.deleteWebRecords": "删除网站",
  "mapping.disableTitleCapture": "停止记录标题",
  "mapping.disableTracking": "停止追踪并隐藏已有历史",
  "mapping.disableWebTracking": "停止追踪并隐藏已有历史",
  "mapping.editAppName": "修改应用名称",
  "mapping.editWebDomainName": "修改网页名称",
  "mapping.emptyState": "当前筛选暂无应用",
  "mapping.enableTitleCapture": "恢复记录标题",
  "mapping.enableTracking": "恢复追踪并重现已有历史",
  "mapping.enableWebTracking": "恢复追踪并重现已有历史",
  "mapping.excludeStats": "匿名统计",
  "mapping.filters.all": "全部",
  "mapping.filters.classified": "已分类",
  "mapping.filters.other": "未分类",
  "mapping.globalTitleDisabled": "全局标题已关闭",
  "mapping.idle": "已保存",
  "mapping.loadFailed": "分类数据加载失败。",
  "mapping.loading": "加载中...",
  "mapping.noStats": "匿名统计",
  "mapping.objectModeApp": "应用",
  "mapping.objectModeWeb": "网页",
  "mapping.quickCategoryMenuLabel": "可选分类",
  "mapping.quickChangeCategory": "更改分类",
  "mapping.quickMenuLabel": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "label"
        },
        " 快捷操作"
      ]
    }
  },
  "mapping.quickRename": "更改名称",
  "mapping.quickRenamePlaceholder": "名称",
  "mapping.quickRenameTitle": "更改名称",
  "mapping.quickSave": "保存",
  "mapping.quickSaveFailed": "保存失败，原有设置未更改。",
  "mapping.quickSaving": "正在保存…",
  "mapping.quickSetCategory": "设置分类",
  "mapping.quickUnclassified": "未分类",
  "mapping.renameCategory": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "重命名分类：",
        {
          "$op": "arg",
          "name": "label"
        },
        ""
      ]
    }
  },
  "mapping.renameCategoryDuplicateDetail": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "已存在 ",
        {
          "$op": "arg",
          "name": "label"
        },
        " 分类。继续后会把当前分类并入该分类。"
      ]
    }
  },
  "mapping.renameCategoryDuplicateTitle": "合并同名分类",
  "mapping.renameCategoryPlaceholder": "新的分类名称",
  "mapping.renameCategoryTitle": "重命名分类",
  "mapping.restoreDefaultColor": "恢复默认颜色",
  "mapping.restoreStats": "恢复追踪",
  "mapping.retry": "重试",
  "mapping.save": "保存",
  "mapping.saving": "正在保存...",
  "mapping.searchNoResults": "没有找到匹配的应用",
  "mapping.statsEnabled": "计入统计",
  "mapping.title": "分类",
  "mapping.titleNotRecorded": "屏蔽标题",
  "mapping.titleRecorded": "记录标题",
  "mapping.unsaved": "有未保存更改",
  "mapping.webEmptyState": "当前筛选暂无网页",
  "mapping.webSearchPlaceholder": "搜索网页"
} as const;
