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

截至当前发布线：

- 代码版本为 `1.8.5`
- 稳定发布线为 `1.x`
- 仓库已进入公开稳定阶段，后续版本按标准 `SemVer` 管理
- 默认通过推送 `vX.Y.Z` / `vX.Y.Z-prerelease` 版本 tag 自动触发 GitHub Actions 工作流 [prepare-release.yml](../.github/workflows/prepare-release.yml) 中的 `Publish Release` 流程；必要时也可手动触发已有 tag 的发布流程补跑

这意味着当前发布策略应同时满足两件事：

- 保持 `1.x` 稳定阶段的兼容性边界
- 保持正式发布线的清晰、一致和可追踪

---

## 4. 版本号的单一来源

每次发布时，下列位置必须保持同一个版本语义：

- `package.json` 的 `version`
- `package-lock.json` 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`
- `src-tauri/Cargo.toml` 中 `[package].version`
- 本文件第 3 节中的当前代码版本说明
- Git tag
- GitHub Release 标题
- 更新通道中的 `latest.json`

上面这项文档同步不是新的版本来源，而是防止长期规则与仓库现实漂移：只要本文保留“代码版本为 `X.Y.Z`”这类当前状态字段，每次准备正式发布时都必须随版本文件一起更新。

统一规则：

- 代码版本号使用不带前缀的 `SemVer` 字符串，例如 `1.0.1`
- Git tag 使用带 `v` 前缀的形式，例如 `v1.0.1`
- GitHub Release 标题使用 `Patina vX.Y.Z`

示例：

- 代码版本：`1.0.1`
- Git tag：`v1.0.1`
- GitHub Release 标题：`Patina v1.0.1`

---

## 5. 版本格式规则

长期采用 `SemVer`：

`MAJOR.MINOR.PATCH`

## 5.1 稳定版本

公开稳定版本使用：

- `1.0.0`
- `1.0.1`
- `1.1.0`

## 5.2 预发布版本

仅当明确需要测试版或候选版时，才使用预发布后缀：

- `1.1.0-beta.1`
- `1.1.0-beta.2`
- `1.1.0-rc.1`

当前 `Patina` 默认不维护复杂的 `beta / rc` 预发布线。除非用户明确要求测试版、候选版或灰度验证，否则准备完成后直接按稳定版本发布。

不应为了“先放着以后再改成 Latest”而默认把稳定 tag 做成预发布。GitHub Release 界面允许修改 `Pre-release / Latest` 标记，但本项目的长期默认是：稳定版本成熟后再发布稳定版本；如果确实需要预发布，就使用带语义后缀的版本号，例如 `1.6.0-rc.1`，正式发布再使用 `1.6.0`。

## 5.3 不再推荐的格式

不再新增类似 `1.1.0-1` 这种语义不清晰的后缀。

原因：

- 它对 release 读者不够直观
- 无法一眼判断是稳定版、`beta` 还是 `rc`
- 不利于 changelog、release 与更新通道统一

---

## 6. 当前阶段的升级策略

## 6.1 当前 `1.x` 策略

项目当前处于 `1.x` 稳定阶段，默认严格按标准 `SemVer` 判断版本号：

- `PATCH`：向后兼容的修复
- `MINOR`：向后兼容的新功能
- `MAJOR`：不兼容变化

不兼容变化包括但不限于：

- 破坏已发布版本的数据兼容性
- 移除或改变用户已经依赖的核心行为
- 改变安装、更新或备份恢复路径中已经公开承诺的语义
- 需要用户手动迁移才能继续使用既有数据

版本号不应在看完发布范围前预设。

准备发布时，先确定最近一个已发布版本，再查看该版本之后的完整 commit 与 diff 范围：

- `git log vX.Y.Z..HEAD`
- `git diff --stat vX.Y.Z..HEAD`
- 必要时继续查看关键文件的具体 diff

看完范围后，再按最终进入发布的实际变化选择 `PATCH`、`MINOR` 或 `MAJOR`。
如果这一段时间里包含用户可感知的新入口、重要行为变化、关键 UX 改进或发布级结构收口，即使最后一轮改动只是小修，也不应只按最后一轮改动决定为 `PATCH`。
如果范围内只有向后兼容的小范围修复、回归修复、构建修复或非行为级 UI 微调，才使用 `PATCH`。

## 6.2 `1.0.0` 之前的历史策略

本节只用于理解 `0.x` 历史版本，不再作为当前发布判断依据。

在 `0.x` 阶段，曾建议按下面规则升级：

- `PATCH`：小范围 bug 修复、回归修复、构建修复、非行为级 UI 微调
- `MINOR`：用户可感知的新功能、重要行为变化、关键 `UX` 改进、发布级结构收口
- `MAJOR`：仅在真正定义稳定兼容边界后再考虑；`1.0.0` 之前通常不使用

---

## 7. 已发布版本的不可变规则

如果某个稳定版本已经完成正式发布，应将它视为“已发布版本”：

- 已存在对应 Git tag，例如 `v1.0.1`
- 已存在对应 GitHub Release
- 或已完成 `Publish Release` 工作流对外发布

推送代码到 `main`、合并发布准备提交、更新版本文件或整理 changelog，都不等于版本已经正式发布。正式发布的边界是 tag、GitHub Release 或发布工作流已经对外形成发布事实。

长期规则：

- 已发布的稳定版本不应为了补进后到的小修而被原地覆盖
- 不应通过重写 tag、强推 tag、删除后重发同版本稳定版来覆盖既有发布
- 如果 `1.0.1` 已发布，后续修复默认进入 `1.0.2`
- 只有目标版本尚未正式发布时，才继续沿用同一版本号准备发布

---

## 7.1 旧备份读取器的丢弃窗口

当正式备份写入器从结构化 JSON ZIP 切换为 SQLite 数据快照时：

- 新版本只写出当前 SQLite 快照，不再生成旧结构化备份。
- 旧结构化备份读取器从首个正式写出 SQLite 快照的版本发布日期起进入 90 天丢弃窗口，只用于用户迁移既有备份。
- 丢弃窗口表示兼容代码的最晚保留期，不是新的长期兼容承诺；窗口内不得继续扩展旧 payload 或旧 writer。
- 90 天按正式发布事实计算，不允许按客户端系统时间在运行时自动拒绝旧备份。
- 首发版本的 `CHANGELOG.md` 必须记录发布日期、旧读取器可删除日期，以及“恢复旧备份后立即创建新备份”的迁移步骤。
- 丢弃窗口结束后的第一个正式版本应优先删除旧读取器、旧 CRC32/JSON payload 分派和仅服务旧 reader 的 fixtures；删除前必须确认迁移提醒已发布，且 SQLite 快照的备份、覆盖恢复和合并恢复均经过正式版本验证。
- 如果退出条件尚未满足，可以延后删除，但必须记录具体阻断原因和新的复核版本；不能无说明地把窗口变成永久兼容层。
- 用户界面只使用“覆盖”和“合并”描述恢复结果，不暴露内部格式代号，也不把合并称作兼容。

在首个 SQLite 快照版本尚未正式发布前，不预填迁移截止日期；发布事实形成时再按实际发布日期计算，避免虚构维护窗口。

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

## [1.0.1] - 2026-05-22

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
- 准备正式版本时，必须先对比最近一个已发布 tag 或 release 提交之后的完整范围，例如 `git log vX.Y.Z..HEAD` 与 `git diff --stat vX.Y.Z..HEAD`；changelog 应总结这一整段时间的最终结果，而不是只总结最后一轮局部改动
- 优先写用户能感知到的结果，不先写实现手段、模块名或重构过程
- 如果条目修复了 GitHub issue，必须在对应 `Fixed` 条目中带上 issue 编号或链接，例如 `[#1](https://github.com/Ceceliaee/patina/issues/1)`，方便从发布说明追溯到问题上下文
- changelog 的追踪引用只关联具体 GitHub issue 或 pull request，不关联 GitHub Project、项目看板或 Project item；如果没有对应 issue 或 pull request，则不为凑引用而误链、补建或关联看板
- 一条尽量只表达一个结果，避免把多个层次不同的变化揉成一条长句
- `Added` 只写新增能力或新增入口，不把“补了支持逻辑”误写成新增功能
- `Changed` 只写用户可感知的行为调整、体验变化或默认值变化
- `Fixed` 只写相对上个已发布版本确实存在的问题修复，不把架构整理、测试补齐或“本轮顺手优化”写成修复
- `Removed` 只写相对上个已发布版本真实移除的能力、入口或行为；如果某项改动在发布前已回退，就不要写进 `Removed`
- `Internal` 只写对发布理解有帮助的架构、工程、验证或发布流程改进；控制在少量高价值条目，不要写成 commit 清单
- 每个正式版本默认优先保证 `Release:`、`App note:`、`Changed`、`Fixed` 可读，再决定是否真的需要写 `Added`、`Removed`、`Internal`
- 如果一条内容需要用户先理解仓库结构、模块名或历史执行计划才看得懂，默认应该继续改写

## 8.5 发布对比基线

正式版本的 changelog 必须基于“上一个已发布版本到本次发布”的完整对比来写。

默认流程：

1. 先确认最近一个已发布 tag，例如 `v1.4.2`。
2. 查看完整 commit 范围：`git log v1.4.2..HEAD`。
3. 查看完整文件范围：`git diff --stat v1.4.2..HEAD` 与必要的关键文件 diff。
4. 用这段范围的最终交付结果整理 `Added / Changed / Fixed / Removed / Internal`。
5. 再检查当前未提交的发布准备改动，例如版本号、文案和资源文件，确认是否也应计入本版本说明。

写作判断：

- 如果某个问题只在本轮开发过程中短暂出现，发布前已经被修正，且上一个已发布版本并不存在这个问题，不写进 `Fixed`。
- 如果某个能力在上一个已发布版本没有、本次发布后用户可以使用，应写进 `Added` 或 `Changed`，即使它不是最后一轮提交。
- 如果某项内部改动解释了本次发布的性能、稳定性或验证边界，可写进 `Internal`；否则不要把 commit 清单搬进 changelog。
- 如果 changelog 与 `git diff vX.Y.Z..HEAD` 读出来的发布范围不一致，应先改 changelog，再继续发布。

## 8.6 维护规则

开发进行中：

- 新变化先写进 `Unreleased`
- `Unreleased` 的 `Release:` 与 `App note:` 可以先写 `待定。`

准备发布时：

- 将 `Unreleased` 整理成正式版本节
- 基于上一个已发布版本之后的完整 commit 与 diff 范围整理内容，确认没有遗漏已经进入发布结果的用户变化、发布级修复或重要内部收口
- 补上版本号与日期
- 完成 `Release:` 与 `App note:`
- 新建空的 `Unreleased`

---

## 9. GitHub Release 规则

## 9.1 标题规则

统一使用：

- `Patina v1.0.1`
- `Patina v1.1.0-beta.1`

## 9.2 正文来源

GitHub Release 正文必须来自 `CHANGELOG.md` 对应版本节，但不是机械整段复制。

推荐结构：

1. 使用对应版本节的 `Release:` 作为开头摘要
2. 全量带出对应版本节 `Added / Changed / Fixed / Removed` 中的用户可感知变化
3. 必要时补充验证、安装包与已知注意事项

对应版本节的 `Added / Changed / Fixed / Removed` 四部分应先在 `CHANGELOG.md` 中保持精炼，合计最好控制在 1 到 7 条用户可感知变化。

默认不要：

- 整段复制完整 changelog
- 把 `Internal` 直接搬进 release 正文
- 用内部重构术语替代用户语言

## 9.3 应用内更新说明

应用内更新提示默认使用对应版本节的 `App note:`，而不是完整 release 正文。

## 9.4 附件命名

对外显示名称保持 `Patina`。

GitHub Release 中的 Windows 安装包附件统一使用无空格文件名，例如：

- `Patina_1.0.1_x64-setup.exe`

Patina Web Sync 浏览器扩展由独立公开仓库 [`patina-web-sync`](https://github.com/Ceceliaee/patina-web-sync) 发布，不再作为 Patina Release 的必备附件。

Patina Release 只发布主应用安装包、`latest.json` 与更新通道所需资产。浏览器扩展的安装来源、版本号、商店素材、三店提交、AMO 公开 listed XPI 与扩展 release asset 由 `patina-web-sync` 仓库负责。

浏览器扩展的用户配置说明由 Patina README 与 Patina 设置页承载。Patina 设置页应指向 `patina-web-sync` 的发布页或商店入口，并继续说明本机端口与 token 配置步骤。

### Patina Web Sync 跨仓签收契约

一个 Patina Web Sync 版本只有同时满足以下条件，才视为完成跨仓发布签收：

1. 发布候选源码已经固定，`package.json` 与两个 manifest 使用同一版本。
2. 同一版本已在 Chrome Web Store、Firefox Add-ons 和 Microsoft Edge Add-ons 全部审核通过并公开。
3. 维护者确认三店状态后，为对应发布候选提交创建并推送 `vX.Y.Z` tag。
4. Tag 自动工作流已经发布完整的 Patina Web Sync GitHub Release，tag、Release 标题与附件版本一致。
5. Firefox Release 附件来自 AMO 的同版本公开 listed XPI，并已校验 AMO SHA-256、manifest version 与稳定 Gecko id。
6. 若版本改变 Web Activity 协议，Patina 接收端兼容必须先落地，两仓的 `docs/web-activity-protocol.md` 必须保持一致。

完成签收不绑定两个项目的版本号，也不要求 Patina 与 Patina Web Sync 同日发布。Patina Release 不携带扩展附件；Patina 只消费稳定商店入口、扩展 Release 和双方已对齐的本机协议。普通扩展发布不得依赖尚未发布的 Patina 接收端行为。

## 9.5 更新源与镜像规则

GitHub Release 继续作为正式发布源、主下载入口和主更新清单来源。

应用内 updater 默认优先读取 GitHub Release asset 上的 `latest.json`。如果配置了 Cloudflare R2 备用镜像，R2 只承担更新兜底职责：

- R2 endpoint 排在 GitHub endpoint 之后
- R2 版 `latest.json` 中的安装包 URL 指向 R2 镜像对象
- R2 默认只保留当前版本安装包和根路径 `latest.json`
- R2 不同步浏览器扩展包；浏览器扩展由 `patina-web-sync` 独立发布
- GitHub Releases 继续保留完整历史版本
- R2 未配置、同步失败或被停用时，不改变 GitHub Release 的主发布事实

不要把 R2 当作完整历史发布仓库，也不要让 R2 同步反过来阻塞已经完成的 GitHub Release 主发布。

---

## 10. 发布前的最低验证门槛

发布前至少应完成以下验证：

- `npm run release:validate-version-files -- <version>` 或工作流中的等价校验
- `npm run release:validate-changelog -- <version>` 或工作流中的等价校验
- `npm run check`

如果是正式准备发布，还应完成：

- `npm run release:check`

`npm run check` 当前包含 SSR UI smoke 与真实浏览器/Vite UI smoke；后者会启动 headless Edge/Chrome，并在本地 stub Tauri API 下检查主界面、导航和 Settings 主题弹窗。

默认不在本地手工生成 `dist-release`、安装包或 `latest.json`。
`write-release-notes`、`npm run tauri build -- --bundles nsis` 与 `npm run release:prepare-assets`
默认属于 GitHub Actions 工作流 [`prepare-release.yml`](../.github/workflows/prepare-release.yml)
中的 `Publish Release` 流程，只有在明确需要排查发布流水线问题时才例外。
浏览器商店提交、AMO 公开 listed XPI 获取与扩展 GitHub Release 不属于 Patina 主应用发布流程；它们由 `patina-web-sync` 仓库负责。

如果改动触及 [`architecture.md`](./architecture.md) 中的高风险区、tracking 主链、读模型边界或运行时契约，不应跳过这些最低门槛。

---

## 11. 默认发布流程

默认发布流程应与当前 GitHub Actions 工作流保持一致：

1. 确认最近一个已发布版本，并查看该版本之后的完整 commit 与 diff 范围。
2. 基于完整发布范围判断目标版本号，避免只根据最后一轮局部改动预设 `PATCH` 或 `MINOR`。
3. 在本地同步版本文件、更新本文第 3 节当前代码版本并整理 changelog。
4. 在本地运行 `npm run release:validate-version-files -- <version>`、`npm run release:validate-changelog -- <version>` 和 `npm run release:check`，完成发布前验证。
5. 将准备发布所需提交推送到远端，提交信息推荐使用 `chore: prepare vX.Y.Z release`。
6. 只有在用户明确进入发布动作时，才推送对应的 `vX.Y.Z` 版本 tag，自动触发 GitHub Actions 的 `Publish Release` 工作流。
7. 工作流 checkout 到 tag 对应 commit，并校验版本文件、changelog 和长期版本文档与 tag 版本一致。
8. `publish` job 下载 release notes 与 Tauri bundle，在同一个 runner 中生成安装包和 GitHub 版 `latest.json`、保存 release assets artifact，并发布 GitHub Release。
9. GitHub Release 成功后，单一 `r2` job 检查镜像 secrets；配置完整时依次生成 R2 版 `latest.json`、上传当前版本安装包和 `latest.json`、清理旧 R2 镜像，未配置时安全跳过同步。R2 不上传浏览器扩展包。
10. R2 同步失败不撤销或覆盖已经成立的 GitHub Release 主发布事实；应用 updater 继续优先使用 GitHub endpoint。

如果只是把版本号、changelog、发布脚本或 release 说明准备好并推到 `main`，提交信息应避免让人误以为已经发布完成。推荐使用能表达准备状态的提交信息，例如 `chore: prepare vX.Y.Z release`。默认不再使用 GitHub Actions 自动生成 `release: vX.Y.Z` 版本提交。

`workflow_dispatch` 只用于补跑已有 tag 的发布流程，例如重新构建或补传 release assets。手动触发时输入不带 `v` 的版本号；如果对应 `vX.Y.Z` tag 不存在，工作流必须失败并提示先完成发布准备提交和 tag 推送。手动触发不应同步版本文件、创建 commit、创建 tag 或推送分支。

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
- 产品阶段或发布线再次变化，例如从当前 `1.x` 稳定期进入新的兼容阶段或维护模式

如果只是一次具体发布，默认不应频繁修改本文；但本文第 3 节中的当前代码版本说明是例外，正式发布准备时必须随版本文件同步更新。

---

## 13. 给 Codex 与后续协作者的默认约束

默认执行约束如下：

- 版本号、tag、Release 标题与更新通道必须一致
- 发布前不跳过最低验证门槛
- 不默认创建或推送发布 tag；只有用户明确要求发布、打 tag 或触发发布工作流时，才执行真正发布动作
- 准备发布但尚未发布时，提交信息应表达“准备”而不是“已发布”；默认使用 `chore: prepare vX.Y.Z release`
- GitHub Actions 不应生成 release commit、配置 commit author、同步版本文件、创建 tag 或推送 `HEAD` 到分支
- `workflow_dispatch` 不应绕过已有 tag 边界，只能补跑已有 tag 的发布流程
- 推送 `vX.Y.Z` tag 并确认 `Publish Release` 已触发后即可结束默认发布协作；不要默认等待 Actions 约 15 分钟的完整构建过程
- 默认不在本地手工构建安装包、生成 `dist-release` 或更新 updater 产物；正式出包以 GitHub Actions 为准
- changelog 应优先记录用户可理解的变化，不写成 commit 列表
- 架构级收口、关键边界调整与发布级修复，必须在发布说明里留下清楚但克制的痕迹
- 如果工作流、脚本或版本线发生变化，应先更新长期规则文档，再把临时经验留给未来猜
