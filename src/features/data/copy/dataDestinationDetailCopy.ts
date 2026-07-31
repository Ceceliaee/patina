import { getUiLocale } from "../../../shared/copy/index.ts";

const ZH_CN_DATA_DESTINATION_DETAIL_COPY = {
  objectTypeApp: "应用",
  objectTypeWeb: "网页",
  timeline: "日内时间轴",
  details: (mode: "app" | "web") => mode === "app" ? "应用详情" : "网页详情",
  records: "活动记录",
  timelineZoom: "时间轴缩放",
  timelineWindowHours: "时间轴窗口时长",
  timelineHoursValue: (hours: number) => `${hours} 小时`,
  timelineDecreaseHours: "缩短时间轴窗口",
  timelineIncreaseHours: "扩大时间轴窗口",
  minimumDuration: "最短活动时长",
  focusedDate: "聚焦日期",
  previousDay: "上一日",
  nextDay: "下一日",
  recordedDuration: "当天时长",
  activeWindow: "活动跨度",
  noActivity: "当天没有该对象的活动记录",
  noActivityInWindow: "当前时间窗没有该对象的活动记录",
  noActivityAtMinimum: (minutes: number) => `没有达到 ${minutes} 分钟的活动记录`,
  untitled: "未记录标题",
  loading: "正在读取详情",
  dayError: "当天记录加载失败",
  retry: "重试",
  close: "关闭详情",
  current: "进行中",
  titleDetails: "标题详情",
  fragmentCount: (count: number) => `${count} 个片段`,
  toggleTitleDetails: (expanded: boolean, name: string) => (
    `${expanded ? "关闭" : "查看"} ${name} 的标题详情`
  ),
  open: (name: string) => `查看 ${name} 的详情`,
  timelineAria: (name: string, dateKey: string) => `${name} 在 ${dateKey} 的日内时间轴`,
  timelineInteractionAria: (name: string, dateKey: string, windowLabel: string) => (
    `${name} 在 ${dateKey} 的 ${windowLabel} 时间轴；滚轮缩放，拖动或使用左右方向键平移`
  ),
  activityAria: (
    start: string,
    end: string,
    name: string,
    duration: string,
    fragmentCount: number,
  ) => `${start} 至 ${end}，${name}，${duration}，${fragmentCount} 个片段`,
  recordAria: (start: string, end: string, title: string, duration: string) => (
    `${start} 至 ${end}，${title}，${duration}`
  ),
} as const;

const EN_US_DATA_DESTINATION_DETAIL_COPY = {
  objectTypeApp: "App",
  objectTypeWeb: "Website",
  timeline: "Daily timeline",
  details: (mode: "app" | "web") => mode === "app" ? "App details" : "Website details",
  records: "Activity records",
  timelineZoom: "Timeline zoom",
  timelineWindowHours: "Timeline window duration",
  timelineHoursValue: (hours: number) => `${hours} ${hours === 1 ? "hour" : "hours"}`,
  timelineDecreaseHours: "Shorten timeline window",
  timelineIncreaseHours: "Expand timeline window",
  minimumDuration: "Minimum activity duration",
  focusedDate: "Focused date",
  previousDay: "Previous day",
  nextDay: "Next day",
  recordedDuration: "Recorded today",
  activeWindow: "Activity span",
  noActivity: "No activity for this item on this day",
  noActivityInWindow: "No activity for this item in the current time window",
  noActivityAtMinimum: (minutes: number) => (
    `No activity lasting at least ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  ),
  untitled: "Title not recorded",
  loading: "Loading details",
  dayError: "Could not load this day's records",
  retry: "Retry",
  close: "Close details",
  current: "In progress",
  titleDetails: "Title details",
  fragmentCount: (count: number) => `${count} ${count === 1 ? "fragment" : "fragments"}`,
  toggleTitleDetails: (expanded: boolean, name: string) => (
    `${expanded ? "Hide" : "Show"} title details for ${name}`
  ),
  open: (name: string) => `View details for ${name}`,
  timelineAria: (name: string, dateKey: string) => `${name} daily timeline for ${dateKey}`,
  timelineInteractionAria: (name: string, dateKey: string, windowLabel: string) => (
    `${name} timeline for ${dateKey}, ${windowLabel}; use the mouse wheel to zoom, or drag and use the left and right arrow keys to pan`
  ),
  activityAria: (
    start: string,
    end: string,
    name: string,
    duration: string,
    fragmentCount: number,
  ) => (
    `${start} to ${end}, ${name}, ${duration}, ${fragmentCount} `
    + `${fragmentCount === 1 ? "fragment" : "fragments"}`
  ),
  recordAria: (start: string, end: string, title: string, duration: string) => (
    `${start} to ${end}, ${title}, ${duration}`
  ),
} as const;

export function getDataDestinationDetailCopy() {
  return getUiLocale() === "en-US"
    ? EN_US_DATA_DESTINATION_DETAIL_COPY
    : ZH_CN_DATA_DESTINATION_DETAIL_COPY;
}
