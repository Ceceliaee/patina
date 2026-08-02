const ZH_CN_ABOUT_COPY = {
  about: {
    title: "关于",
    subtitle: "了解项目版本信息",
    description: "本地优先的个人桌面时间追踪工具",
    versionUnknown: "版本未知",
    feedbackDialog: {
      title: "问题反馈",
      description: "日常交流请扫码加入 QQ 频道；问题反馈请前往 GitHub Issues。",
      githubTitle: "GitHub Issues",
      githubAction: "GitHub Issues",
      githubOpening: "正在打开…",
      qqTitle: "QQ 频道",
      qqQrAlt: "Patina QQ 频道二维码",
    },
    supportDialog: {
      description: "如果 Patina 对你有帮助，欢迎支持持续维护。",
      wechatTitle: "微信赞赏码",
      wechatAlt: "微信赞赏码",
      kofiTitle: "Ko-fi",
      openKofi: "打开 Ko-fi",
    },
  },
};

const EN_US_ABOUT_COPY = {
  about: {
    title: "About",
    subtitle: "View project version info",
    description: "A local-first personal desktop time tracker",
    versionUnknown: "Version unknown",
    feedbackDialog: {
      title: "Feedback",
      description: "Join the QQ channel for conversation; use GitHub Issues to report a problem.",
      githubTitle: "GitHub Issues",
      githubAction: "GitHub Issues",
      githubOpening: "Opening…",
      qqTitle: "QQ Channel",
      qqQrAlt: "QR code for the Patina QQ Channel",
    },
    supportDialog: {
      description: "If Patina helps you, supporting ongoing maintenance is welcome.",
      wechatTitle: "WeChat reward code",
      wechatAlt: "WeChat reward code",
      kofiTitle: "Ko-fi",
      openKofi: "Open Ko-fi",
    },
  },
};

export const aboutCopy = {
  "zh-CN": ZH_CN_ABOUT_COPY,
  "en-US": EN_US_ABOUT_COPY,
} as const;
