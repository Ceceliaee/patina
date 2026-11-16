import { getLocaleText } from "../../src/shared/i18n/runtime.ts";
const COPY = { "zh-CN": getLocaleText("zh-CN") } as const;

export const EXPECTED_NAV_LABELS = ["历史", "数据", "分类", "工具", "设置", "关于"] as const;
export const HISTORY_MARKERS = ["当日摘要", "当日活动"] as const;
export const TOOLS_TEXT = COPY["zh-CN"].tools;
export const DATE_TEXT = COPY["zh-CN"].date;
export const SETTINGS_MARKER = COPY["zh-CN"].settings.languageLabel;
export const APP_LOADING_VIEW = COPY["zh-CN"].app.loadingView;
export const HISTORY_LOADING_VIEW = COPY["zh-CN"].common.loading;
export const HISTORY_TITLE_DETAIL_COUNT = 10;
export const LONG_BACKGROUND_DELAY_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const FIRST_RENDER_TIMEOUT_MS = process.env.CI ? 45_000 : DEFAULT_TIMEOUT_MS;
