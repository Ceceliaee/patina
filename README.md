<div align="center">

<img src="src-tauri/icons/128x128.png" width="72" height="72" alt="Time Tracker icon">

# Time Tracker

Local-first time tracking for Windows desktop work.

English · [简体中文](README.zh-CN.md)

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-4f6f8f)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-4f7f8f)
![Local first](https://img.shields.io/badge/data-local--first-5f7f68)
[![Downloads](https://img.shields.io/github/downloads/Ceceliaee/time-tracking/total?label=downloads&color=b07a3a)](https://github.com/Ceceliaee/time-tracking/releases)
[![Latest downloads](https://img.shields.io/github/downloads/Ceceliaee/time-tracking/latest/total?label=latest&color=8f6f4f)](https://github.com/Ceceliaee/time-tracking/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-6f647a)](LICENSE)

</div>


<p align="center">
Time Tracker records foreground apps and organizes them into today's overview, a timeline, and long-term trends.<br>
It is not a team timesheet system, but a quiet and trustworthy personal desktop time record.
</p>

![Time Tracker dashboard](.github/assets/readme/dashboard.png)

## Download

Prebuilt versions are published on GitHub Releases:

- [Latest release page](https://github.com/Ceceliaee/time-tracking/releases/latest)

If you just want to use the app, open the latest release page and download the `.exe` installer.

## Why Time Tracker

- Automatic foreground app tracking without manually starting, pausing, or stopping timers.
- AFK, lock, sleep, and crash recovery boundaries designed to keep records trustworthy.
- Local SQLite storage by default, with no account, cloud sync, or server dependency.
- App-level controls for names, categories, colors, stats exclusions, and title capture.
- A restrained, low-interruption desktop interface for long-term daily use.

## Core Features

### Automatic Tracking

- Detects the active foreground window and application.
- Prevents idle time from silently counting as effective activity.
- Seals sessions across lock, sleep, long-away, and abnormal-exit boundaries.
- Uses media and audio signals to reduce missed time in low-interaction scenarios such as videos, meetings, courses, and livestreams.

### Review And Analysis

- Review today's effective activity, app ranking, category distribution, and live tracking status.
- Browse the daily timeline and inspect title details under the same app.
- Explore trends, heatmaps, and app-level curves across longer time ranges.

### Management And Control

- Rename apps and adjust categories or colors.
- Exclude apps from statistics or disable title capture for specific apps.
- Export local backups, restore backups, and clean up historical records.

## Interface Preview

|  |  |
| --- | --- |
| **Today**<br>![Today page](.github/assets/readme/dashboard.png)<br>Today's activity, app ranking, category split, hourly rhythm, and tracking status. | **History**<br>![History page](.github/assets/readme/history.png)<br>Daily timeline, merged activity segments, and title details. |
| **Data**<br>![Data page](.github/assets/readme/data.png)<br>7-day, 30-day, yearly trends, heatmaps, and app curves. | **Apps**<br>![Apps page](.github/assets/readme/mapping.png)<br>Manage app names, categories, colors, exclusions, and title capture. |
| **Settings**<br>![Settings page](.github/assets/readme/settings.png)<br>Adjust tracking, resident behavior, appearance, language, backup, restore, and cleanup. | **About**<br>![About page](.github/assets/readme/about.png)<br>View the version, check updates, download releases, and read release notes. |

## Reliability And Privacy

Time tracking has long-term value only when the records are trustworthy. Time Tracker focuses on these boundaries:

- **Native window tracking**: identifies the foreground window through Rust and the Windows API.
- **AFK-aware timing**: idle time does not continue counting as effective activity.
- **Lifecycle boundaries**: handles lock, sleep, resume, and abnormal-exit session sealing.
- **Noise filtering**: filters installers, updaters, temporary system windows, and similar processes that should not enter statistics.
- **Real-duration stats**: rankings, distributions, and totals use effective activity time, not just visual spans.
- **Title capture control**: window title capture can be disabled per app to reduce unnecessary sensitive information retention.
- **Local data control**: core data stays local, and backups or restores are initiated by the user.

## Current Scope

Time Tracker intentionally keeps its scope focused:

- **Windows 10/11 first**
- **Personal use first**
- **Local-first data storage and control**
- **Quiet, professional, long-term desktop experience**

Team collaboration, account systems, cloud sync, mobile apps, broad multi-platform parity, and heavy AI insights are not the current main direction.

## Build From Source

### Requirements

- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/) 18+

### Install Dependencies

```bash
git clone https://github.com/Ceceliaee/time-tracking.git
cd time-tracking
npm install
```

### Run In Development

```bash
npm run tauri dev
```

### Build Installer

```bash
npm run tauri build
```

Installers are generated under:

```text
src-tauri/target/release/bundle/
```

## Tech Stack

- Desktop shell: Tauri v2
- Backend: Rust
- Frontend: React + Vite + TypeScript
- Styling: Tailwind CSS
- Animation: Framer Motion
- Charts: Recharts
- Database: SQLite via `@tauri-apps/plugin-sql`
- Windows integration: `windows` crate

## Project Docs

If you want to contribute, adjust product direction, or review architecture boundaries, start with:

- [`CONTRIBUTING.md`](CONTRIBUTING.md#english) for the contribution and pull request workflow
- [`docs/product-principles-and-scope.md`](docs/product-principles-and-scope.md)
- [`docs/roadmap-and-prioritization.md`](docs/roadmap-and-prioritization.md)
- [`docs/engineering-quality.md`](docs/engineering-quality.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/quiet-pro-component-guidelines.md`](docs/quiet-pro-component-guidelines.md)
- [`docs/issue-fix-boundary-guardrails.md`](docs/issue-fix-boundary-guardrails.md)
- [`docs/versioning-and-release-policy.md`](docs/versioning-and-release-policy.md)

Historical execution plans and stage-specific documents are usually archived under `docs/archive/`; by default, they are not the current execution basis.

## Support

Time Tracker is a personal, local-first open-source project. If it has been useful in your daily work, you can support ongoing maintenance in whichever way is convenient:

[<img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" height="36" alt="Buy me a coffee">](https://ko-fi.com/ceceliaee)

<img src=".github/assets/support/wechat-reward.png" width="200" alt="WeChat reward code">

Sponsorship helps sustain maintenance, but it does not affect feature priority, issue handling, the roadmap, or the product direction.

## Feedback

- Releases: <https://github.com/Ceceliaee/time-tracking/releases>
- Issues: <https://github.com/Ceceliaee/time-tracking/issues/new/choose>

## License

[MIT](LICENSE)
