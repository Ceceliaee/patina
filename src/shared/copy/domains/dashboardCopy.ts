const ZH_CN_DASHBOARD_COPY = {
  dashboard: {
    title: "今天",
    subtitle: "查看今日活动概览",
    tracking: (activeAppName: string) => `正在追踪：${activeAppName}`,
    trackingPaused: "追踪已暂停",
    idle: "空闲",
    afk: "无操作",
    active: "当前活跃",
    paused: "已暂停",
    focusShare: "专注分布",
    total: "总计",
    comparedWithYesterday: (deltaLabel: string, direction: "increase" | "decrease" | "same") => {
      if (direction === "same") return "与昨天持平";
      return `比昨天${direction === "increase" ? "增加" : "减少"} ${deltaLabel}`;
    },
    hourlyActivity: "今日活动",
    showHourlyActivityByCategory: "按分类显示",
    showTotalHourlyActivity: "显示总活动",
    topApps: "应用排行",
    topAppsBadge: (count: number) => `前 ${count} 项`,
    emptyState: "今天暂无记录",
    sharePrefix: "占比",
  },
  hourlyActivityChart: {
    activeMinutes: "活跃",
    remainingCategories: "其他",
  },
};

const EN_US_DASHBOARD_COPY = {
  dashboard: {
    title: "Today",
    subtitle: "View today's activity",
    tracking: (activeAppName: string) => `Tracking: ${activeAppName}`,
    trackingPaused: "Tracking paused",
    idle: "Idle",
    afk: "Idle",
    active: "Active now",
    paused: "Paused",
    focusShare: "Focus share",
    total: "Total",
    comparedWithYesterday: (deltaLabel: string, direction: "increase" | "decrease" | "same") => {
      if (direction === "same") return "Same as yesterday";
      return `${direction === "increase" ? "Up" : "Down"} ${deltaLabel} from yesterday`;
    },
    hourlyActivity: "Today's Activity",
    showHourlyActivityByCategory: "Show by category",
    showTotalHourlyActivity: "Show total activity",
    topApps: "Top Apps",
    topAppsBadge: (count: number) => `Top ${count}`,
    emptyState: "No records today",
    sharePrefix: "Share",
  },
  hourlyActivityChart: {
    activeMinutes: "Active",
    remainingCategories: "Other",
  },
};

export const dashboardCopy = {
  "zh-CN": ZH_CN_DASHBOARD_COPY,
  "en-US": EN_US_DASHBOARD_COPY,
} as const;
