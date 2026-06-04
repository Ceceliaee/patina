<div align="center">

<img src="src-tauri/icons/128x128.png" width="72" height="72" alt="Time Tracker icon">

# Time Tracker

面向 Windows 桌面工作的本地优先时间追踪工具。

[English](README.md) · 简体中文

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-4f6f8f)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-4f7f8f)
![Local first](https://img.shields.io/badge/data-local--first-5f7f68)
[![Downloads](https://img.shields.io/github/downloads/Ceceliaee/time-tracking/total?label=downloads&color=b07a3a)](https://github.com/Ceceliaee/time-tracking/releases)
[![Latest downloads](https://img.shields.io/github/downloads/Ceceliaee/time-tracking/latest/total?label=latest&color=8f6f4f)](https://github.com/Ceceliaee/time-tracking/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-6f647a)](LICENSE)

</div>


<p align="center">
Time Tracker 自动记录前台应用，并整理成今日概览、历史时间线和长期趋势。<br>
它不是团队工时系统，而是安静可信的个人桌面时间记录工具。
</p>

![Time Tracker 今日概览](.github/assets/readme.zh-CN/dashboard.png)

## 下载

预构建版本发布在 GitHub Releases：

- [最新版发布页面](https://github.com/Ceceliaee/time-tracking/releases/latest)

如果只是想使用应用，进入最新版页面后下载 `.exe` 安装包即可。

## 为什么使用 Time Tracker

- 自动记录前台应用，不需要手动开始、暂停或停止计时器。
- 处理无操作、锁屏、睡眠、崩溃恢复等边界，尽量让记录可信。
- 数据默认存储在本地 SQLite 数据库中，不依赖账号、云同步或服务器。
- 可以管理应用名称、分类、颜色、统计排除和窗口标题记录。
- 界面保持克制、清晰、低打扰，适合日常长期打开。

## 核心能力

### 自动追踪

- 识别当前前台窗口与应用。
- 空闲时间不会悄悄计入有效活动。
- 锁屏、睡眠和长时间离开后会封口会话，避免时间串记。
- 对视频、会议、课程、直播等低交互场景，结合媒体和音频信号减少漏记。

### 回看与分析

- 在今日概览中查看有效活动、应用排行、分类分布和当前追踪状态。
- 按日期查看历史时间线，展开同一应用下的窗口标题明细。
- 通过趋势、热力图和应用曲线观察长期时间分布。

### 管理与控制

- 重命名应用、调整分类和颜色。
- 将应用排除出统计，或关闭指定应用的窗口标题记录。
- 导出本地备份，恢复备份，清理历史记录。

## 界面预览

|  |  |
| --- | --- |
| **今天**<br>![今天页面](.github/assets/readme.zh-CN/dashboard.png)<br>今日活动、应用排行、分类分布、小时节奏和追踪状态。 | **历史**<br>![历史页面](.github/assets/readme.zh-CN/history.png)<br>按日期回看时间线，查看合并活动片段和标题明细。 |
| **数据**<br>![数据页面](.github/assets/readme.zh-CN/data.png)<br>查看 7 天、30 天、年度趋势、热力图和应用曲线。 | **应用**<br>![应用页面](.github/assets/readme.zh-CN/mapping.png)<br>管理应用名称、分类、颜色、统计排除和标题记录。 |
| **设置**<br>![设置页面](.github/assets/readme.zh-CN/settings.png)<br>调整追踪、驻留、外观、语言、备份、恢复和清理。 | **关于**<br>![关于页面](.github/assets/readme.zh-CN/about.png)<br>查看版本、检查更新、下载新版本和查看发布说明。 |

## 可靠性与隐私

时间追踪只有在结果可信时才有长期价值。Time Tracker 当前重点保护这些边界：

- **原生窗口追踪**：通过 Rust 和 Windows API 识别前台窗口。
- **AFK 感知计时**：无操作时间不会继续被算作有效活动。
- **生命周期边界**：处理锁屏、睡眠、恢复和异常退出后的会话封口。
- **噪音过滤**：过滤安装器、更新器、系统临时窗口等不适合进入统计的进程。
- **真实时长统计**：排行、分布和总时长基于有效活动时间，而不是单纯的视觉跨度。
- **标题记录控制**：窗口标题记录可以按应用关闭，减少不必要的敏感信息保留。
- **本地数据控制**：核心数据保存在本地，备份和恢复由用户主动管理。

## 当前范围

Time Tracker 有意保持范围克制：

- **Windows 10/11 优先**
- **个人使用优先**
- **本地优先的数据存储与控制**
- **安静、专业、可长期使用的桌面体验**

团队协作、账号体系、云同步、移动端、多平台同步铺开和重型 AI 洞察暂不作为当前主线。

## 从源码运行

### 环境要求

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) 18+

### 安装依赖

```bash
git clone https://github.com/Ceceliaee/time-tracking.git
cd time-tracking
npm install
```

### 开发运行

```bash
npm run tauri dev
```

### 构建安装包

```bash
npm run tauri build
```

安装包会生成在：

```text
src-tauri/target/release/bundle/
```

## 技术栈

- 桌面壳：Tauri v2
- 后端：Rust
- 前端：React + Vite + TypeScript
- 样式：Tailwind CSS
- 动效：Framer Motion
- 图表：Recharts
- 数据库：SQLite，通过 `@tauri-apps/plugin-sql`
- Windows 集成：`windows` crate

## 项目文档

如果你要参与贡献、调整产品方向或审查架构边界，建议先阅读：

- [`CONTRIBUTING.md`](CONTRIBUTING.md#zh-cn)：贡献与 Pull Request 协作流程
- [`docs/product-principles-and-scope.md`](docs/product-principles-and-scope.md)
- [`docs/roadmap-and-prioritization.md`](docs/roadmap-and-prioritization.md)
- [`docs/engineering-quality.md`](docs/engineering-quality.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/quiet-pro-component-guidelines.md`](docs/quiet-pro-component-guidelines.md)
- [`docs/issue-fix-boundary-guardrails.md`](docs/issue-fix-boundary-guardrails.md)
- [`docs/versioning-and-release-policy.md`](docs/versioning-and-release-policy.md)

历史执行计划和阶段性文档通常会归档到 `docs/archive/`，默认不作为当前执行依据。

<a id="support"></a>

## 支持项目

Time Tracker 是一个个人维护的、本地优先开源项目。如果它对你的日常工作有帮助，也欢迎选择方便的方式支持后续维护：

[<img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" height="36" alt="Buy me a coffee">](https://ko-fi.com/ceceliaee)

<img src=".github/assets/support/wechat-reward.png" width="200" alt="微信赞赏码">

赞助会帮助项目持续维护，但不会影响功能优先级、问题处理方式、路线图或产品方向。

## 反馈

- Releases: <https://github.com/Ceceliaee/time-tracking/releases>
- Issues: <https://github.com/Ceceliaee/time-tracking/issues/new/choose>

## 许可证

[MIT](LICENSE)
