# 版本与发布规范

## 1. 文档定位

本文定义本项目长期使用的版本管理、`CHANGELOG.md` 维护与发布规则。

它不是某一轮发布说明，也不是一次性操作清单，而是以后每次准备发布版本时都应遵循的长期规则。

如果某次临时发布习惯与本文冲突，以本文为准。

---

## 2. 与其他长期文档的关系

- [`architecture.md`](./architecture.md) 定义长期结构边界与最低验证门槛；本文定义哪些变化可以形成正式版本，以及发布前必须怎么验证。
- [`issue-fix-boundary-guardrails.md`](./issue-fix-boundary-guardrails.md) 约束日常修复的落点与边界；本文约束这些变化怎样稳定进入发布线。
- [`roadmap-and-prioritization.md`](./roadmap-and-prioritization.md) 约束当前阶段的优先级；本文约束何时把优先主题固化进正式版本。

---

## 3. 当前仓库现实

截至当前仓库状态：

- 代码版本为 `0.4.2`
- 稳定发布线处于 `0.4.x`
- 仓库仍处于 `0.x` 阶段，但已经超过原型期
- 默认通过推送 `vX.Y.Z` / `vX.Y.Z-prerelease` 版本 tag 自动触发 GitHub Actions 工作流 [prepare-release.yml](../.github/workflows/prepare-release.yml) 中的 `Publish Release` 流程；必要时也可手动触发该工作流

这意味着当前发布策略应同时满足两件事：

- 保持 `0.x` 阶段的迭代灵活性
- 保持正式发布线的清晰、一致和可追踪

---

## 4. 版本号的单一来源

每次发布时，下列位置必须保持同一个版本语义：

- `package.json` 的 `version`
- `package-lock.json` 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`
- `src-tauri/Cargo.toml` 中 `[package].version`
- Git tag
- GitHub Release 标题
- 更新通道中的 `latest.json`

统一规则：

- 代码版本号使用不带前缀的 `SemVer` 字符串，例如 `0.2.3`
- Git tag 使用带 `v` 前缀的形式，例如 `v0.2.3`
- GitHub Release 标题使用 `Time Tracker vX.Y.Z`

示例：

- 代码版本：`0.2.3`
- Git tag：`v0.2.3`
- GitHub Release 标题：`Time Tracker v0.2.3`

---

## 5. 版本格式规则

长期采用 `SemVer`：

`MAJOR.MINOR.PATCH`

## 5.1 稳定版本

公开稳定版本使用：

- `0.2.3`
- `0.2.4`
- `0.3.0`

## 5.2 预发布版本

仅当明确需要测试版或候选版时，才使用预发布后缀：

- `0.3.0-beta.1`
- `0.3.0-beta.2`
- `0.3.0-rc.1`

## 5.3 不再推荐的格式

不再新增类似 `0.1.0-1` 这种语义不清晰的后缀。

原因：

- 它对 release 读者不够直观
- 无法一眼判断是稳定版、`beta` 还是 `rc`
- 不利于 changelog、release 与更新通道统一

---

## 6. 当前阶段的升级策略

## 6.1 在 `1.0.0` 之前

项目当前仍处于 `0.x` 阶段。

在这个阶段，建议按下面规则升级：

- `PATCH`：小范围 bug 修复、回归修复、构建修复、非行为级 UI 微调
- `MINOR`：用户可感知的新功能、重要行为变化、关键 `UX` 改进、发布级结构收口
- `MAJOR`：仅在真正定义稳定兼容边界后再考虑；`1.0.0` 之前通常不使用

## 6.2 进入 `1.0.0` 之后

进入 `1.0.0` 后，严格按标准 `SemVer`：

- `PATCH`：向后兼容的修复
- `MINOR`：向后兼容的新功能
- `MAJOR`：不兼容变化

---

## 7. 已发布版本的不可变规则

如果某个稳定版本已经完成正式发布，应将它视为“已发布版本”：

- 已存在对应 Git tag，例如 `v0.2.3`
- 已存在对应 GitHub Release
- 或已完成 `Publish Release` 工作流对外发布

长期规则：

- 已发布的稳定版本不应为了补进后到的小修而被原地覆盖
- 不应通过重写 tag、强推 tag、删除后重发同版本稳定版来覆盖既有发布
- 如果 `0.2.3` 已发布，后续修复默认进入 `0.2.4`
- 只有目标版本尚未正式发布时，才继续沿用同一版本号准备发布

---

## 8. `CHANGELOG.md` 规则

`CHANGELOG.md` 是仓库内版本说明的长期单一来源。

## 8.1 文件位置

- 固定放在仓库根目录：[`CHANGELOG.md`](../CHANGELOG.md)

## 8.2 基本结构

长期使用以下结构：

```md
# Changelog

## [Unreleased]

Release: 待定。
App note: 待定。
### Added
### Changed
### Fixed
### Removed
### Internal

## [0.2.3] - 2026-04-15

Release: 一句话概括这个版本最值得用户知道的变化。
App note: 一句话概括应用内更新提示要显示的变化。
### Added
### Changed
### Fixed
### Removed
### Internal
```

## 8.3 `Release:` 与 `App note:`

每个正式版本节顶部必须包含两个摘要字段：

- `Release:`：给 GitHub Release 使用的简短摘要
- `App note:`：给应用内更新提示使用的一句话说明

写法要求：

- 面向最终用户，而不是面向开发者
- 简短、清晰、避免内部术语
- 优先说明用户能感知到的变化

## 8.4 分类规则

推荐分类：

- `Added`
- `Changed`
- `Fixed`
- `Removed`
- `Internal`

其中：

- 前四类面向用户与发布读者
- `Internal` 只记录确实影响发布判断的内部变化，不要堆纯噪音

默认写作口径：
- 只写“相对上一个已发布版本”的真实变化，不写本轮开发中出现过、但最终没有进入发布结果的中间尝试或回退
- 优先写用户能感知到的结果，不先写实现手段、模块名或重构过程
- 一条尽量只表达一个结果，避免把多个层次不同的变化揉成一条长句
- `Added` 只写新增能力或新增入口，不把“补了支持逻辑”误写成新增功能
- `Changed` 只写用户可感知的行为调整、体验变化或默认值变化
- `Fixed` 只写相对上个已发布版本确实存在的问题修复，不把架构整理、测试补齐或“本轮顺手优化”写成修复
- `Removed` 只写相对上个已发布版本真实移除的能力、入口或行为；如果某项改动在发布前已回退，就不要写进 `Removed`
- `Internal` 只写对发布理解有帮助的架构、工程、验证或发布流程改进；控制在少量高价值条目，不要写成 commit 清单
- 每个正式版本默认优先保证 `Release:`、`App note:`、`Changed`、`Fixed` 可读，再决定是否真的需要写 `Added`、`Removed`、`Internal`
- 如果一条内容需要用户先理解仓库结构、模块名或历史执行计划才看得懂，默认应该继续改写
## 8.5 维护规则

开发进行中：

- 新变化先写进 `Unreleased`
- `Unreleased` 的 `Release:` 与 `App note:` 可以先写 `待定。`

准备发布时：

- 将 `Unreleased` 整理成正式版本节
- 补上版本号与日期
- 完成 `Release:` 与 `App note:`
- 新建空的 `Unreleased`

---

## 9. GitHub Release 规则

## 9.1 标题规则

统一使用：

- `Time Tracker v0.2.3`
- `Time Tracker v0.3.0-beta.1`

## 9.2 正文来源

GitHub Release 正文必须来自 `CHANGELOG.md` 对应版本节，但不是机械整段复制。

推荐结构：

1. 使用对应版本节的 `Release:` 作为开头摘要
2. 从 `Added / Changed / Fixed / Removed` 中挑选 3 到 6 条用户可感知变化
3. 必要时补充验证、安装包与已知注意事项

默认不要：

- 整段复制完整 changelog
- 把 `Internal` 直接搬进 release 正文
- 用内部重构术语替代用户语言

## 9.3 应用内更新说明

应用内更新提示默认使用对应版本节的 `App note:`，而不是完整 release 正文。

## 9.4 附件命名

对外显示名称保持 `Time Tracker`。

GitHub Release 中的 Windows 安装包附件统一使用无空格文件名，例如：

- `TimeTracker_0.2.3_x64-setup.exe`

---

## 10. 发布前的最低验证门槛

发布前至少应完成以下验证：

- `npm run release:validate-changelog -- <version>` 或工作流中的等价校验
- `npm run check`

如果是正式准备发布，还应完成：

- `npm run release:check`

默认不在本地手工生成 `dist-release`、安装包或 `latest.json`。
`write-release-notes`、`npm run tauri build -- --bundles nsis` 与 `npm run release:prepare-assets`
默认属于 GitHub Actions 工作流 [`prepare-release.yml`](../.github/workflows/prepare-release.yml)
中的 `Publish Release` 流程，只有在明确需要排查发布流水线问题时才例外。

如果改动触及 [`architecture.md`](./architecture.md) 中的高风险区、tracking 主链、读模型边界或运行时契约，不应跳过这些最低门槛。

---

## 11. 默认发布流程

默认发布流程应与当前 GitHub Actions 工作流保持一致：

1. 确认目标版本号。
2. 在本地同步版本文件并整理 changelog。
3. 在本地运行 `npm run release:check`，完成发布前验证。
4. 将准备发布所需提交推送到远端；发布提交信息统一使用 `release: vX.Y.Z`。
5. 推送对应的 `vX.Y.Z` 版本 tag，自动触发 GitHub Actions 的 `Publish Release` 工作流；必要时也可手动触发并输入同一版本号。
6. 由工作流生成 release notes、构建安装包与 `latest.json`。
7. 由工作流发布 GitHub Release。
8. 由工作流更新 updater 通道。

默认发布执行到 `vX.Y.Z` tag 已推送、`Publish Release` 工作流已触发即可。除非用户明确要求或正在排查发布流水线失败，不需要等待 GitHub Actions 完整构建、签名、上传和发布结束。

默认不在本地创建 `dist-release` 或 `updater-publish` 目录；它们属于工作流内部的临时产物目录。

如果以后工作流调整，本文应同步更新到新的长期稳定流程，而不是继续写过期步骤名。

---

## 12. 什么时候更新本文

只有在以下情况发生时，才应更新本文：

- 版本策略变化
- 发布工作流变化
- changelog 结构变化
- 更新通道或安装包策略变化
- 项目从 `0.x` 进入 `1.x`

如果只是一次具体发布，不应频繁修改本文。

---

## 13. 给 Codex 与后续协作者的默认约束

默认执行约束如下：

- 版本号、tag、Release 标题与更新通道必须一致
- 发布前不跳过最低验证门槛
- release commit 信息统一使用 `release: vX.Y.Z`
- 推送 `vX.Y.Z` tag 并确认 `Publish Release` 已触发后即可结束默认发布协作；不要默认等待 Actions 约 15 分钟的完整构建过程
- 默认不在本地手工构建安装包、生成 `dist-release` 或更新 updater 产物；正式出包以 GitHub Actions 为准
- changelog 应优先记录用户可理解的变化，不写成 commit 列表
- 架构级收口、关键边界调整与发布级修复，必须在发布说明里留下清楚但克制的痕迹
- 如果工作流、脚本或版本线发生变化，应先更新长期规则文档，再把临时经验留给未来猜
