// zh-CN accessibility locale resource. Pure data only.
export const MESSAGES = {
  "accessibility.color.blueChannel": "蓝色通道",
  "accessibility.color.color": "颜色",
  "accessibility.color.colorFormat": "颜色格式",
  "accessibility.color.colorPicker": "颜色选择器",
  "accessibility.color.eyedropper": "取色器",
  "accessibility.color.eyedropperUnsupported": "当前环境不支持取色器",
  "accessibility.color.greenChannel": "绿色通道",
  "accessibility.color.hexValue": "十六进制颜色值",
  "accessibility.color.hueChannel": "色相",
  "accessibility.color.hueSlider": "色相滑杆",
  "accessibility.color.lightnessChannel": "明度",
  "accessibility.color.redChannel": "红色通道",
  "accessibility.color.saturationChannel": "饱和度",
  "accessibility.data.appTrendRange": "选择应用趋势范围",
  "accessibility.data.categoryTrendRange": "选择应用分类趋势范围",
  "accessibility.data.earlierRange": "切到更早范围",
  "accessibility.data.heatmapCell": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "arg",
          "name": "dateKey"
        },
        "，",
        {
          "$op": "arg",
          "name": "summary"
        },
        ""
      ]
    }
  },
  "accessibility.data.heatmapRange": "选择热力图范围",
  "accessibility.data.longerAppTrendRange": "扩大应用趋势范围",
  "accessibility.data.longerTrendRange": "扩大趋势范围",
  "accessibility.data.newerRange": "切到较新范围",
  "accessibility.data.nextPickerMode": "下一个范围模式",
  "accessibility.data.nextPickerMonth": "下个月",
  "accessibility.data.openTrendRangePicker": "打开趋势范围选择",
  "accessibility.data.previousPickerMode": "上一个范围模式",
  "accessibility.data.previousPickerMonth": "上个月",
  "accessibility.data.resetTrendRange": "恢复近 7 天",
  "accessibility.data.shorterAppTrendRange": "缩短应用趋势范围",
  "accessibility.data.shorterTrendRange": "缩短趋势范围",
  "accessibility.data.trendRange": "选择趋势范围",
  "accessibility.data.trendSummary": "趋势摘要",
  "accessibility.data.webTrendRange": "选择网页趋势范围",
  "accessibility.date.nextMonth": "下个月",
  "accessibility.date.previousMonth": "上个月",
  "accessibility.history.decreaseMinDuration": "减少显示分钟 1 分钟",
  "accessibility.history.increaseMinDuration": "增加显示分钟 1 分钟",
  "accessibility.history.nextDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "切到后一天：",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.nextMonth": "下个月",
  "accessibility.history.previousDay": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "切到前一天：",
        {
          "$op": "arg",
          "name": "dateLabel"
        },
        ""
      ]
    }
  },
  "accessibility.history.previousMonth": "上个月",
  "accessibility.history.toggleActivityDetails": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "if",
          "when": {
            "$op": "arg",
            "name": "expanded"
          },
          "then": "收起",
          "else": "展开"
        },
        " ",
        {
          "$op": "arg",
          "name": "appName"
        },
        " 的标题详情"
      ]
    }
  },
  "accessibility.sidebar.navigationLabels": "导航名称",
  "accessibility.settings.colorScheme": "配色方案",
  "accessibility.settings.copyWebActivityPort": "复制网页同步端口",
  "accessibility.settings.copyWebActivityToken": "复制网页同步 Token",
  "accessibility.settings.generateServiceToken": "随机生成 Token",
  "accessibility.settings.hideRemoteMachineId": "隐藏本机标识",
  "accessibility.settings.hideServiceToken": "隐藏 Token",
  "accessibility.settings.openWebActivityHelp": "打开网页同步使用说明",
  "accessibility.settings.showRemoteMachineId": "显示本机标识",
  "accessibility.settings.showServiceToken": "显示 Token",
  "accessibility.settings.toggleBackgroundOptimization": "切换低耗后台",
  "accessibility.settings.toggleCloseToTray": "切换关闭到托盘",
  "accessibility.settings.toggleGlobalTitle": "切换全局标题",
  "accessibility.settings.toggleLaunchAtLogin": "切换开机自启动",
  "accessibility.settings.toggleMinimizeToWidget": "切换最小化到挂件",
  "accessibility.settings.toggleRemoteStatusBridge": "切换远程推送",
  "accessibility.settings.toggleStartMinimized": "切换静默启动",
  "accessibility.settings.toggleTrackingPaused": "切换暂停追踪",
  "accessibility.settings.toggleWebActivity": "切换网页同步",
  "accessibility.titleBar.close": "关闭窗口",
  "accessibility.titleBar.maximize": "最大化窗口",
  "accessibility.titleBar.minimize": "最小化窗口",
  "accessibility.titleBar.restore": "还原窗口",
  "accessibility.tools.addTimerLap": "添加分段",
  "accessibility.tools.cancelReminder": "取消提醒",
  "accessibility.tools.createReminder": "创建提醒",
  "accessibility.tools.decreaseDuration": {
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
  "accessibility.tools.increaseDuration": {
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
  "accessibility.tools.openStatusChip": "打开工具状态",
  "accessibility.tools.pausePomodoro": "暂停番茄钟",
  "accessibility.tools.pauseTimer": "暂停计时",
  "accessibility.tools.resetPomodoro": "重置番茄钟",
  "accessibility.tools.resetTimer": "重置计时",
  "accessibility.tools.restorePomodoroDefaults": "恢复番茄钟默认时长",
  "accessibility.tools.resumePomodoro": "继续番茄钟",
  "accessibility.tools.resumeTimer": "继续计时",
  "accessibility.tools.skipPomodoroPhase": "跳过番茄钟阶段",
  "accessibility.tools.startPomodoro": "开始番茄钟",
  "accessibility.tools.startTimer": "开始计时",
  "accessibility.widget.collapse": "收起挂件",
  "accessibility.widget.currentApp": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "当前应用：",
        {
          "$op": "arg",
          "name": "appName"
        },
        ""
      ]
    }
  },
  "accessibility.widget.expand": "展开挂件",
  "accessibility.widget.openMainWindow": "打开主窗口",
  "accessibility.widget.pin": "固定展开挂件",
  "accessibility.widget.toggle": {
    "$type": "message",
    "body": {
      "$op": "concat",
      "parts": [
        "",
        {
          "$op": "if",
          "when": {
            "$op": "arg",
            "name": "expanded"
          },
          "then": "收起挂件",
          "else": "展开挂件"
        },
        "，",
        {
          "$op": "arg",
          "name": "statusTitle"
        },
        ""
      ]
    }
  }
} as const;
