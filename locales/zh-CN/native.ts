// zh-CN native locale resource. Pure data only.
export const MESSAGES = {
  "native.category.ai": "AI",
  "native.category.browser": "浏览器",
  "native.category.communication": "沟通",
  "native.category.design": "设计",
  "native.category.development": "开发",
  "native.category.game": "游戏",
  "native.category.music": "音乐",
  "native.category.office": "办公",
  "native.category.other": "其他",
  "native.category.system": "系统",
  "native.category.utility": "工具",
  "native.category.video": "视频",
  "native.export.duration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        {
          "$op": "plural",
          "arg": "hours",
          "cases": {
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "hours" }, " 小时"] }
          }
        },
        " ",
        {
          "$op": "plural",
          "arg": "minutes",
          "cases": {
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "minutes" }, " 分钟"] }
          }
        }
      ]
    }
  },
  "native.export.empty": "所选范围内没有活动记录。",
  "native.export.exportedAt": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "导出时间：",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "native.export.field.app_name": "应用名称",
  "native.export.field.browser_client_id": "浏览器客户端 ID",
  "native.export.field.browser_exe_name": "浏览器可执行文件",
  "native.export.field.browser_kind": "浏览器类型",
  "native.export.field.category": "分类",
  "native.export.field.category_color": "分类颜色",
  "native.export.field.category_id": "分类 ID",
  "native.export.field.continuity_group_start_time": "连续组开始时间",
  "native.export.field.created_at": "创建时间",
  "native.export.field.domain": "域名",
  "native.export.field.duration_minutes": "时长（分钟）",
  "native.export.field.duration_ms": "时长（毫秒）",
  "native.export.field.end_time": "结束时间",
  "native.export.field.exe_name": "可执行文件名",
  "native.export.field.favicon_url": "网站图标 URL",
  "native.export.field.local_date": "本地日期",
  "native.export.field.local_month": "本地月份",
  "native.export.field.local_week": "本地周",
  "native.export.field.normalized_domain": "标准化域名",
  "native.export.field.page_title": "页面标题",
  "native.export.field.record_type": "记录类型",
  "native.export.field.session_id": "会话 ID",
  "native.export.field.source_key": "来源键",
  "native.export.field.source_name": "来源名称",
  "native.export.field.start_hour": "开始小时",
  "native.export.field.start_time": "开始时间",
  "native.export.field.unknown": "未知字段",
  "native.export.field.updated_at": "更新时间",
  "native.export.field.url": "URL 地址",
  "native.export.field.web_segment_id": "网页片段 ID",
  "native.export.field.web_source": "网页来源",
  "native.export.field.weekday": "星期",
  "native.export.field.window_title": "窗口标题",
  "native.export.range": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "导出范围：",
        {
          "$op": "arg",
          "name": "start"
        },
        " 至 ",
        {
          "$op": "arg",
          "name": "end"
        },
        ""
      ]
    }
  },
  "native.export.rangeAll": "全部",
  "native.export.rangeCurrent": "当前",
  "native.export.records": {
    "$type": "message",
    "body": {
      "$op": "plural",
      "arg": "count",
      "cases": {
        "other": { "$op": "concat", "parts": ["记录数量：", { "$op": "arg", "name": "count" }] }
      }
    }
  },
  "native.export.title": "Patina 活动记录",
  "native.export.totalDuration": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "总时长：",
        {
          "$op": "arg",
          "name": "value"
        },
        ""
      ]
    }
  },
  "native.tools.activityReminderAppTitle": "应用提醒",
  "native.tools.activityReminderCategoryTitle": "分类提醒",
  "native.tools.activityReminderDefaultBody": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        { "$op": "arg", "name": "targetName" },
        " 今日已活动 ",
        {
          "$op": "plural",
          "arg": "usageMinutes",
          "cases": {
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "usageMinutes" }, " 分钟"] }
          }
        },
        "，已达到 ",
        {
          "$op": "plural",
          "arg": "limitMinutes",
          "cases": {
            "other": { "$op": "concat", "parts": [{ "$op": "arg", "name": "limitMinutes" }, " 分钟上限"] }
          }
        }
      ]
    }
  },
  "native.tools.activityReminderWebTitle": "网页提醒",
  "native.tools.breakEnded": "休息结束",
  "native.tools.countdownDefaultBody": "倒计时已完成",
  "native.tools.countdownTitle": "倒计时结束",
  "native.tools.focusEnded": "专注结束",
  "native.tools.nextFocus": "下一阶段：专注",
  "native.tools.nextLongBreak": "下一阶段：长休息",
  "native.tools.nextShortBreak": "下一阶段：短休息",
  "native.tools.reminderDefaultBody": "时间到了",
  "native.tools.reminderTitle": "提醒",
  "native.tray.disableTitle": "屏蔽标题",
  "native.tray.enableTitle": "记录标题",
  "native.tray.pause": "暂停追踪",
  "native.tray.quit": "退出应用",
  "native.tray.resume": "恢复追踪",
  "native.tray.showMain": "打开主界面"
} as const;
