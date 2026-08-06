import { getLocaleText } from "../../src/shared/i18n/runtime.ts";
const COPY = { "zh-CN": getLocaleText("zh-CN") } as const;

export const EXPECTED_NAV_LABELS = ["今天", "历史", "数据", "分类", "工具", "设置", "关于"] as const;
export const DASHBOARD_MARKERS = ["专注分布", "应用排行"] as const;
export const TOOLS_TEXT = COPY["zh-CN"].tools;
export const DATE_TEXT = COPY["zh-CN"].date;
export const SETTINGS_MARKER = "主题模式";
export const APP_LOADING_VIEW = COPY["zh-CN"].app.loadingView;
export const HISTORY_LOADING_VIEW = COPY["zh-CN"].history.loading;
export const HISTORY_TITLE_DETAIL_COUNT = 10;
export const LONG_BACKGROUND_DELAY_MS = 3 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const FIRST_RENDER_TIMEOUT_MS = process.env.CI ? 45_000 : DEFAULT_TIMEOUT_MS;
