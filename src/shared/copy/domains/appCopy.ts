const ZH_CN_APP_COPY = {
  app: {
    loadingView: "正在加载界面...",
    mappingUpdated: "分类规则已更新。",
    historyDeleted: "应用记录已删除。",
    unsavedConfirmTitle: "保存更改",
    unsavedConfirmBody: "当前页面有未保存更改，保存后再切换页面。",
    unsavedConfirmSave: "保存",
  },
};

const EN_US_APP_COPY = {
  app: {
    loadingView: "Loading view...",
    mappingUpdated: "Classification rules updated.",
    historyDeleted: "App records deleted.",
    unsavedConfirmTitle: "Save changes",
    unsavedConfirmBody: "This page has unsaved changes. Save before switching pages.",
    unsavedConfirmSave: "Save",
  },
};

export const appCopy = {
  "zh-CN": ZH_CN_APP_COPY,
  "en-US": EN_US_APP_COPY,
} as const;
