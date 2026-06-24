const ZH_CN_ABOUT_COPY = {
  about: {
    title: "关于",
    subtitle: "了解项目版本信息",
    description: "本地优先的个人桌面时间追踪工具",
    supportDialog: {
      description: "如果 Patina 对你有帮助，欢迎支持持续维护。",
      wechatTitle: "微信赞赏码",
      wechatHint: "使用微信扫一扫赞赏。",
      wechatAlt: "微信赞赏码",
      kofiTitle: "Ko-fi",
      kofiHint: "打开 Ko-fi 赞助页面。",
      openKofi: "打开 Ko-fi",
    },
  },
};

const EN_US_ABOUT_COPY = {
  about: {
    title: "About",
    subtitle: "View project version info",
    description: "A local-first personal desktop time tracker",
    supportDialog: {
      description: "If Patina helps you, supporting ongoing maintenance is welcome.",
      wechatTitle: "WeChat reward code",
      wechatHint: "Scan with WeChat to send a reward.",
      wechatAlt: "WeChat reward code",
      kofiTitle: "Ko-fi",
      kofiHint: "Open the Ko-fi support page.",
      openKofi: "Open Ko-fi",
    },
  },
};

export const aboutCopy = {
  "zh-CN": ZH_CN_ABOUT_COPY,
  "en-US": EN_US_ABOUT_COPY,
} as const;
