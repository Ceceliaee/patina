# 版本与发布

本文帮助维护者选择版本、维护 changelog、准备和验收发布；同时提供已发布资产、升级兼容和更新通道的长期约束。临时发布习惯不能覆盖这些约束。

| 当前任务 | 阅读位置 |
| --- | --- |
| 只更新 changelog | [正文规则](#changelogmd-规则)、[完整对比基线](#发布对比基线)、[摘要与 i18n 边界](#release-与-app-note) |
| 准备一个正式版本 | [发布流程](#默认发布流程)，按步骤查[SemVer](#版本升级策略)、[验收](#发布前的最低验证门槛)与[授权](#授权与事项引用) |
| 处理失败发布 | [不可变规则](#已发布版本的不可变规则)和[补跑限制](#默认发布流程) |
| 修改备份或存储升级路径 | [旧备份窗口](#旧备份读取器的丢弃窗口)、[存储升级](#存储位置配置的升级边界) |
| 查附件、证明、镜像或伴生扩展 | [资产](#附件命名)、[跨仓签收](#patina-web-sync-跨仓签收契约)、[镜像](#更新源与镜像规则) |

## 默认发布流程

1. 找到最近已发布版本，审查其后完整 commit 与 diff，再按实际范围选择 SemVer；不能只看最后一轮局部改动。
2. 在本地同步所有版本文件并整理 changelog。长期政策文档不保存当前版本值。
3. 运行版本一致性、changelog 和 `cargo xtask check`；正式资产由 workflow 生成，本地默认不创建 `dist-release`、安装包或 updater 产物。
4. 获得当前任务的远程 push 授权后推送准备提交。等该提交在 `main` 的 `Verify` 全绿，再依单独的 tag 或发布授权为该提交创建并推送 `vX.Y.Z`。
5. [`prepare-release.yml`](../.github/workflows/prepare-release.yml) 从 tag 对应 commit 校验版本与 changelog，拒绝已有 Release，生成并独立验证安装包、校验和与 updater manifest，完成 attestation 后以禁止覆盖的方式创建 GitHub Release。
6. GitHub Release 成立后再同步 R2 镜像；镜像失败不能撤销、覆盖或改变 GitHub Release 主事实，updater 继续优先使用 GitHub endpoint。
7. 发布模式的 `workflow_dispatch` 只补跑已有 tag 且尚无 Release 的流程。补跑使用原 tag 的工作流和源码，仍需满足该工作流的发布门槛。Release 已存在时必须按不可变规则准备新版本。

补跑时使用目标 tag 对应的 workflow 版本，例如 `gh workflow run prepare-release.yml --ref v<version> -f version=<version>`。历史 tag 沿用该版本发布时的工作流和工具链。

默认协作在 tag 推送并确认发布 workflow 已触发后即可结束；只有用户要求或正在排查失败时才持续监看。浏览器扩展商店与扩展 Release 由 `patina-web-sync` 仓库负责，不进入 Patina 主应用发布流程。

## 稳定发布线

- 稳定发布线为 `1.x`
- 仓库已进入公开稳定阶段，后续版本按标准 `SemVer` 管理
- 默认通过推送 `vX.Y.Z` / `vX.Y.Z-prerelease` 版本 tag 自动触发 GitHub Actions 工作流 [prepare-release.yml](../.github/workflows/prepare-release.yml) 中的 `Publish Release` 流程；必要时也可手动触发已有 tag 的发布流程补跑

---

## 版本号的单一来源

每次发布时，下列位置必须保持同一个版本语义：

- 根 `Cargo.toml` 的 `workspace.package.version`，由桌面程序和需要绑定产品版本的工作区包继承
- 根 `Cargo.lock` 中所有继承产品版本的本地包条目
- Git tag
- GitHub Release 标题
- 桌面更新清单 `latest.json`

长期政策不保存当前版本副本。发布 validator 负责比较版本文件、tag、Release 与 updater manifest，避免靠人工同步 prose。

统一规则：

- 代码版本号使用不带前缀的 `SemVer` 字符串，例如 `1.0.1`
- Git tag 使用带 `v` 前缀的形式，例如 `v1.0.1`
- GitHub Release 标题使用 `Patina vX.Y.Z`

示例：

- 代码版本：`1.0.1`
- Git tag：`v1.0.1`
- GitHub Release 标题：`Patina v1.0.1`

---

## 版本格式规则

长期采用 `SemVer`：

`MAJOR.MINOR.PATCH`

### 稳定版本

公开稳定版本使用：

- `1.0.0`
- `1.0.1`
- `1.1.0`

### 预发布版本

仅当明确需要测试版或候选版时，才使用预发布后缀：

- `1.1.0-beta.1`
- `1.1.0-beta.2`
- `1.1.0-rc.1`

当前 `Patina` 默认不维护复杂的 `beta / rc` 预发布线。除非用户明确要求测试版、候选版或灰度验证，否则准备完成后直接按稳定版本发布。

不应为了“先放着以后再改成 Latest”而默认把稳定 tag 做成预发布。GitHub Release 界面允许修改 `Pre-release / Latest` 标记，但本项目的长期默认是：稳定版本成熟后再发布稳定版本；如果确实需要预发布，就使用带语义后缀的版本号，例如 `1.6.0-rc.1`，正式发布再使用 `1.6.0`。

### 不再推荐的格式

不再新增类似 `1.1.0-1` 这种语义不清晰的后缀。

原因：

- 它对 release 读者不够直观
- 无法一眼判断是稳定版、`beta` 还是 `rc`
- 不利于 changelog、release 与更新通道统一

---

## 版本升级策略

### `1.x` 兼容承诺

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

准备发布时，先按[发布对比基线](#发布对比基线)检查最近已发布版本之后的完整 commit、diff 和待提交发布准备内容。

看完范围后，再按最终进入发布的实际变化选择 `PATCH`、`MINOR` 或 `MAJOR`。
如果这一段时间里包含用户可感知的新入口、重要行为变化、关键 UX 改进或发布级结构收口，即使最后一轮改动只是小修，也不应只按最后一轮改动决定为 `PATCH`。
如果范围内只有向后兼容的小范围修复、回归修复、构建修复或非行为级 UI 微调，才使用 `PATCH`。

## 已发布版本的不可变规则

发布 tag 一旦存在，就冻结该版本的源码引用；即使 GitHub Release 尚未创建，也不得重指、强推或删除后重建该 tag 来替换源码。对应 GitHub Release 已公开时，才形成正式发布事实；`Publish Release` 工作流以成功创建该公开 Release 为发布完成边界。

推送代码到 `main`、合并发布准备提交、更新版本文件或整理 changelog，都不等于版本已经正式发布。

长期规则：

- 已发布的稳定版本不得为了补进后到的小修而被原地覆盖，也不得删除 Release 后重发同版本稳定版
- 如果 `1.0.1` 已发布，后续修复默认进入 `1.0.2`
- 只有目标版本尚无 tag 和 GitHub Release 时，才可继续沿用同一版本号更改发布内容
- tag 已存在而 Release 不存在的失败发布，只能按[发布流程](#默认发布流程) 从原 tag 补跑；源码变化必须使用新版本和新 tag。已有 Release 时不得补跑覆盖

---

### 旧备份读取器的丢弃窗口

当正式备份写入器从结构化 JSON ZIP 切换为 SQLite 数据快照时：

- 新版本只写出当前 SQLite 快照，不再生成旧结构化备份。
- 旧结构化备份读取器从首个正式写出 SQLite 快照的版本发布日期起进入 90 天丢弃窗口，只用于用户迁移既有备份。
- 丢弃窗口表示兼容代码的最晚保留期，不是新的长期兼容承诺；窗口内不得继续扩展旧 payload 或旧 writer。
- 90 天按正式发布事实计算，不允许按客户端系统时间在运行时自动拒绝旧备份。
- 首发版本的 `CHANGELOG.md` 必须记录发布日期、旧读取器可删除日期，以及“恢复旧备份后立即创建新备份”的迁移步骤。
- 丢弃窗口结束后的第一个正式版本应优先删除旧读取器、旧 CRC32/JSON payload 分派和仅服务旧 reader 的 fixtures；删除前必须确认迁移提醒已发布，且 SQLite 快照的备份、覆盖恢复和合并恢复均经过正式版本验证。
- 如果退出条件尚未满足，可以延后删除，但必须记录具体阻断原因和新的复核版本；不能无说明地把窗口变成永久兼容层。
- 用户界面只使用“覆盖”和“合并”描述恢复结果，不暴露内部格式代号，也不把合并称作兼容。

首次 SQLite 快照正式发布为 [v1.8.5](https://github.com/Ceceliaee/patina/releases/tag/v1.8.5)，发布日期为 2026-07-20，90 天窗口截至 2026-10-18。当前源码已移除旧读取器；实际交付版本以 `CHANGELOG.md` 和公开 Release 为准。

持有旧结构化备份的用户应保留原文件，并通过仍含读取器的 [v1.9.10](https://github.com/Ceceliaee/patina/releases/tag/v1.9.10) 转换：

1. 在独立 Windows 用户或虚拟机中运行该版本，确认是空白数据目录；不要让旧程序打开当前生产数据库。
2. 恢复旧备份的副本，核对记录、设置和旧格式原本支持的数据。
3. 立即创建新的 SQLite 数据快照备份，保留旧文件和新文件。
4. 回到当前版本预览新快照，核对统计后选择覆盖或合并。预览失败时停止操作并保留两份文件；覆盖前先备份当前数据。

此路径转换的是备份副本，不是安装降级或数据库原地降级。源文件损坏或包含旧版本无法表达的数据时，转换不能补回缺失事实。

---

### 存储位置配置的升级边界

首次交付注册表存储配置时，发布说明必须告知旧定位文件自动转存、数据本身不搬动及配置异常的恢复方式。旧 JSON 格式只由首次导入入口读取，新运行时不双写、不回退。

维护者在每次拟删除该导入器的发布中核对仍支持的直接升级来源。只要未迁移版本仍可直接更新到候选版本，就保留窄导入入口；删除前必须明确并验证替代升级路径、完成用户提醒和失败恢复验证。不能套用旧备份的 90 天窗口，也不能用客户端日期自动拒绝导入。卸载或安装旧版不构成本机路径配置的自动回滚方案。

WebDAV 凭据引用的升级与恢复遵循[本地数据边界](architecture.md#本地数据读取通道)。首次交付该协议的发布说明须说明旧配置在首次保存时转换、备份恢复后的密码配置要求，以及旧程序无法读取新凭据引用的降级限制。只要无引用的旧配置仍属于支持中的直接升级来源，就保留窄凭据读取入口；删除前验证替代升级路径。不能把安装旧版当成跨资源保存协议的回滚操作。

安装验收须覆盖旧正式版自定义目录升级、后续更新保留路径、普通用户权限以及发行架构。源代码或测试 profile 的验证不能代替正式安装/updater 证据；缺少这些证据时不得宣称该发布的升级验收完成。

## `CHANGELOG.md` 规则

`CHANGELOG.md` 是仓库内版本说明的长期单一来源。

### 文件位置

- 固定放在仓库根目录：[`CHANGELOG.md`](../CHANGELOG.md)

### 基本结构

长期使用以下结构：

```md
# Changelog

## [Unreleased]

Release: 待定。
App note: 待定。
App note en: TBD.
### Added
### Changed
### Fixed
### Removed
### Internal

## [1.0.1] - 2026-05-22

Release: 一句话概括这个版本最值得用户知道的变化。
App note: 一句话概括这个版本最值得用户知道的变化。
### Added
### Changed
### Fixed
### Removed
### Internal
```

### `Release:` 与 `App note:`

每个正式版本节顶部必须包含以下摘要字段：

- `Release:`：给 GitHub Release 使用的简短摘要
- `App note:`：给简体中文更新弹窗使用的同一句摘要
- `App note en:`：该摘要的英文版本，供英文界面及其他非中文界面回退使用

这些字段是随版本发布的正文数据：内容由 `CHANGELOG.md` 持有，解析与发布产物生成由 [`xtask/src/release`](../xtask/src/release) 持有，不进入 `locales/` 消息资源。仅修改正文按[工程质量的默认门槛与风险路由](./quality.md#验证范围) 运行文档与 changelog 检查，不触发 i18n 生成。承载正文的界面标题、按钮和无障碍文案仍遵守[本地化契约](./localization.md)；修改正文解析、语言选择或展示行为时，仍须按实际代码与本地化风险验证。

写法要求：

- 面向最终用户，而不是面向开发者
- 语言简洁、清楚，说明必要的变化，避免内部术语；三个摘要字段均不设固定字数或字符数上限
- 优先说明用户能感知到的变化
- 新编写或修订的版本摘要中，`Release:` 与 `App note:` 默认使用完全相同的中文正文；精简时同步修改，已发布版本不追溯改写。
- 中英文字段必须表达同一组发布事实；updater 按界面语言选择，俄语和西班牙语等没有独立字段的界面回退到英文

### 分类规则

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
- 准备正式版本时按[发布对比基线](#发布对比基线)核对完整范围；摘要覆盖整段最终结果，不只总结最后一轮局部改动
- 优先写用户能感知到的结果，不先写实现手段、模块名或重构过程
- 如果条目修复了 GitHub issue，必须在对应 `Fixed` 条目中带上 issue 编号或链接，例如 `[#1](https://github.com/Ceceliaee/patina/issues/1)`，方便从发布说明追溯到问题上下文
- changelog 的追踪引用只指向与条目直接相关的 GitHub issue 或 pull request。没有对应记录时省略引用。
- 当引用适用于整条 changelog 条目时，沿用 `1.9.3` 的格式：正文结束后另写 `Refs ...`，不加括号，例如 `- 修复……。Refs [#1](https://github.com/Ceceliaee/patina/issues/1)`
- 只有当条目继续描述另一个独立结果、而引用必须明确限定在前一段结果时，才在对应句末使用括号形式 `(Refs ...)`；遇到这种情况应优先拆成两条，避免引用范围含混
- 上述引用格式适用于 `Unreleased` 和后续版本；不得仅为统一格式改写已经发布的历史版本
- 一条尽量只表达一个结果，避免把多个层次不同的变化揉成一条长句
- `Added` 只写新增能力或新增入口，不把“补了支持逻辑”误写成新增功能
- `Changed` 只写用户可感知的行为调整、体验变化或默认值变化
- `Fixed` 只写相对上个已发布版本确实存在的问题修复，不把架构整理、测试补齐或“本轮顺手优化”写成修复
- `Removed` 只写相对上个已发布版本真实移除的能力、入口或行为；如果某项改动在发布前已回退，就不要写进 `Removed`
- `Internal` 只写对发布理解有帮助的架构、工程、验证或发布流程改进；控制在少量高价值条目，不要写成 commit 清单
- 每个正式版本默认优先保证 `Release:`、`App note:`、`Changed`、`Fixed` 可读，再决定是否真的需要写 `Added`、`Removed`、`Internal`
- 如果一条内容需要用户先理解仓库结构、模块名或历史执行计划才看得懂，默认应该继续改写

### 发布对比基线

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

### 维护规则

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

## GitHub Release 规则

### 标题规则

统一使用：

- `Patina v1.0.1`
- `Patina v1.1.0-beta.1`

### 正文来源

GitHub Release 正文必须来自 `CHANGELOG.md` 对应版本节，但不是机械整段复制。

推荐结构：

1. 使用对应版本节的 `Release:` 作为开头摘要
2. 全量带出对应版本节 `Added / Changed / Fixed / Removed` 中的用户可感知变化
3. 必要时补充验证、安装包与已知注意事项

对应版本节的 `Added / Changed / Fixed / Removed` 四部分合计至少 1 条。patch 版本最多 7 条，minor 版本最多 14 条。major 版本沿用 7 条上限，预发布版本按目标正式版本计数。摘要与 `Internal` 不计入条数。

默认不要：

- 整段复制完整 changelog
- 把 `Internal` 直接搬进 release 正文
- 用内部重构术语替代用户语言

### 应用内更新说明

应用内更新提示默认使用对应版本节的 `App note:` 或 `App note en:`，而不是完整 release 正文；简体中文使用中文字段，其他界面语言优先使用英文，旧版本缺少英文时再回退到中文。

### 附件命名

对外显示名称保持 `Patina`。

GitHub Release 中的 Windows 安装包附件统一使用无空格文件名，例如：

- `Patina_<version>_x64-setup.exe`
- `Patina_<version>_arm64-setup.exe`

应用内更新直接验证并安装签名 NSIS `.exe`，不使用旧 ZIP 安装包格式；更新器仅启用该发行路径需要的功能。备份 ZIP 由独立的备份格式契约处理，与更新安装格式无关。

每次正式发布还必须携带根级 `SHA256SUMS.txt`：

- 校验文件按 x64、ARM64 顺序恰好记录两个最终公开安装包，不记录构建中间路径或更新清单。
- 记录格式固定为 64 位小写 SHA-256、两个空格和无路径前缀的安装包文件名，并以单个 LF 换行结束。
- SHA-256 必须在公开文件完成复制与重命名后，分别从 `dist-release/` 中两个最终公开安装包重新读取计算。
- 发布工作流必须同时比较签名输入安装包与最终公开安装包的摘要；字节不一致时不得发布。
- `SHA256SUMS.txt` 只证明文件字节一致性，不单独证明发布者身份或软件绝对安全。

最终公开安装包还必须生成 GitHub Artifact Attestation：

- 两个安装包分别生成 attestation；每个 subject 必须是 `dist-release/` 下对应最终公开安装包的明确路径，不能是原始 bundle 路径或目录 glob。
- attestation 必须在独立发布资产校验通过后、GitHub Release 对外发布前生成；生成失败必须阻断 Release。
- attestation 用于把安装包摘要与 Patina 仓库、源码引用和发布工作流关联，不替代 Minisign 更新签名或 Windows Authenticode。当前发布流程不使用 Windows Authenticode。

Patina Web Sync 浏览器扩展由独立公开仓库 [`patina-web-sync`](https://github.com/Ceceliaee/patina-web-sync) 发布，不再作为 Patina Release 的必备附件。

Patina Release 发布 x64 与 ARM64 两个主应用安装包、`SHA256SUMS.txt` 和更新清单 `latest.json`。浏览器扩展的安装来源、版本号、商店素材、三店提交、AMO 公开 listed XPI 与扩展 release asset 由 `patina-web-sync` 仓库负责。

浏览器扩展的用户配置说明由 Patina README 与 Patina 设置页承载。Patina 设置页应指向 `patina-web-sync` 的发布页或商店入口，并继续说明本机端口与 token 配置步骤。

双架构使用同一版本和源码引用，分别构建 `x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc`。一份 `latest.json` 同时包含 `windows-x86_64` 与 `windows-aarch64`，任一路构建、验证或证明失败均阻断公开发布。应用自动更新按已安装应用架构选包；ARM 设备上的 x64 应用继续取得 x64 更新，不自动迁移架构。

发布说明通过 Windows 下载表提供两个安装包的直链与架构标签，不重复展示校验步骤；`SHA256SUMS.txt` 和 GitHub Artifact Attestation 仍由发布资产与工作流承载。ARM64 以原生 CI、自动化测试和资产验证为发布门槛，不以实体设备人工验收作为发布前置，也不将自动化覆盖之外的真实桌面行为描述为已验证。

#### Patina Web Sync 跨仓签收契约

一个 Patina Web Sync 版本只有同时满足以下条件，才视为完成跨仓发布签收：

1. 发布候选源码已经固定，`package.json` 与两个 manifest 使用同一版本。
2. 同一版本已在 Chrome Web Store、Firefox Add-ons 和 Microsoft Edge Add-ons 全部审核通过并公开。
3. 维护者确认三店状态后，为对应发布候选提交创建并推送 `vX.Y.Z` tag。
4. Tag 自动工作流已经发布完整的 Patina Web Sync GitHub Release，tag、Release 标题与附件版本一致。
5. Firefox Release 附件来自 AMO 的同版本公开 listed XPI，并已校验 AMO SHA-256、manifest version 与稳定 Gecko id。
6. Chromium ZIP 与 Firefox XPI 已由 `SHA256SUMS` 和 GitHub Artifact Attestation 绑定；同 tag 重跑只可复用字节相同的既有资产或补齐缺失资产，同名哈希冲突必须失败，发布后必须回读远端资产验证。
7. 若版本改变 Web Activity 协议，Patina 接收端兼容必须先落地，两仓的 `docs/web-sync-protocol.md` 必须保持一致。

完成签收不绑定两个项目的版本号，也不要求 Patina 与 Patina Web Sync 同日发布。Patina Release 不携带扩展附件；Patina 只消费稳定商店入口、扩展 Release 和双方已对齐的本机协议。普通扩展发布不得依赖尚未发布的 Patina 接收端行为。

### 更新源与镜像规则

GitHub Release 继续作为正式发布源、主下载入口和主更新清单来源。

原生更新器与 Tauri v1.10.0 都先读取 GitHub Release 的 `latest.json`。原生更新器识别 v1.10.0 旧格式清单时，仅在已安装同版或更高版本时报告已是最新。提供安装必须使用含应用标识、架构、包大小和签名的原生清单。如果配置了 Cloudflare R2 备用镜像，R2 只承担更新兜底职责：

- R2 endpoint 排在 GitHub endpoint 之后
- R2 版 `latest.json` 中的安装包 URL 指向 `desktop/releases/v<version>/` 下的镜像对象
- R2 只接收稳定版；同步串行执行，拒绝用较低版本覆盖当前清单，也拒绝替换同版本的不同资产。
- 两个安装包上传并回读成功后，将镜像清单写入根路径的 `latest.json`。清单回读成功后，才清理 `desktop/releases/` 下旧版本的安装包。历史 `releases/` 对象继续保留。
- R2 不同步浏览器扩展包；浏览器扩展由 `patina-web-sync` 独立发布
- GitHub Releases 继续保留完整历史版本
- R2 未配置、同步失败或被停用时，不改变 GitHub Release 的主发布事实

不要把 R2 当作完整历史发布仓库，也不要让 R2 同步反过来阻塞已经完成的 GitHub Release 主发布。

---

### Windows 安装与更新

Windows 应用 ID 为 `Ceceliaee.Patina`。开始菜单和已安装的应用均显示为 Patina。[`prepare-release.yml`](../.github/workflows/prepare-release.yml) 发布 NSIS 安装包和原生更新清单 `latest.json`，沿用 `vX.Y.Z` 标签和 `Patina vX.Y.Z` 发布标题。

Tauri v1.10.0 通过 `latest.json` 取得同一架构的签名安装包。首个升级版本须高于 1.10.0，并使用旧客户端信任的签名密钥。安装器按旧版的 `/UPDATE` 参数读取 Windows 安装登记，在原位置替换程序。旧数据库和备份目录继续使用自定义位置或旧默认位置 `%APPDATA%/Patina/`。资料位置冲突、数据库不可用或旧版仍有待完成的数据搬移时，安装停止并保留旧程序。新安装的默认位置见[桌面资料目录](architecture.md#运行身份与持久化隔离)。

手动迁移也可在 v1.10.0 创建本地 ZIP 备份，退出旧版，安装新版，再通过「备份与恢复」预览并恢复。首次正式发布前，使用面向用户的签名候选包从已发布客户端验收检查、下载、安装和重启。

[`crates/updater/config.json`](../crates/updater/config.json) 拥有更新源及公钥：先检查 GitHub Releases，访问或解析失败再尝试 R2。两个通道发布同版本、同字节的资产。清单包含 `schema: 1`、`application`、SemVer `version`、可选 `notes`，以及按 `windows-x86_64`、`windows-aarch64` 索引的 `platforms`；每个包提供 HTTPS `url`、字节数 `size` 和 Base64 编码的完整 Minisign `signature`。

安装包签名使用预哈希 Minisign，签名的 trusted comment 必须严格等于 `patina-desktop <version> <platform>`。客户端同时验证包字节和该签名注释，防止把旧版本、其他架构或 Tauri 安装包改名后作为当前桌面版的更新。版本不高于当前版本时不提供安装；稳定版不接受预发布版。更新签名与 Windows Authenticode 是不同契约。

构建需要仓库指定的 Rust 工具链、目标 Windows 架构及插件使用的 Wasm 目标，并需要 NSIS 和 Minisign。使用与应用公钥匹配的私钥，在仓库根目录为各架构选择独立的空输出目录。

```powershell
cargo xtask release package --target x64 --output target/bundles/x64 --makensis $makensis --minisign $minisign --signing-key $signingKey --base-url $assetBaseUrl
cargo xtask release package --target arm64 --output target/bundles/arm64 --makensis $makensis --minisign $minisign --signing-key $signingKey --base-url $assetBaseUrl
```

[`cargo xtask release package`](../xtask/src/release/package.rs) 从工作区构建指定架构的 `patina.exe`，检查 PE 架构后生成 NSIS 安装包。宿主、界面和探测进程均从这一个文件启动。升级已有三程序安装时，安装器先备份旧程序，成功后清理旧界面和探测文件。文件被占用或替换中断时，安装器恢复上一组程序，之后可重试。工具用应用公钥复验签名后写入更新清单。安装验收可使用 `--unsigned`，输出包含安装包和 `patina.exe`。安装器的 Windows 发布者和文件公司名称为 `Ceceliaee`。

工作流在各架构的 Windows runner 上调用同一个打包工具，合并清单后独立验证，再为两个最终安装包生成证明。签名步骤使用 `PATINA_SIGNING_PRIVATE_KEY` 和 `PATINA_SIGNING_PRIVATE_KEY_PASSWORD`。前者保存 Base64 编码的 Minisign 私钥文件，后者经进程标准输入交给签名器。工具回收临时私钥文件。

## 发布前的最低验证门槛

正式发布前至少应完成以下验证：

- `cargo xtask release validate-version-files <version>`
- `cargo xtask release validate-changelog <version>`
- `cargo xtask check`

通用质量门槛见[工程质量](./quality.md#验证范围)。正式发布前，目标提交必须在本仓库 `main` 的 push 事件上通过 `Verify`。发布工作流按 tag 的完整提交 SHA 查验最近一次对应运行及其全部作业；记录缺失、运行未结束、作业未全绿或查询失败时停止。通过后，版本、changelog 和安装包均取自该提交。

`Verify` 的双架构 `Native desktop checks` 运行 workspace 单元、契约和无头控件交互测试，以及 Clippy、格式与依赖审计；独立的 `Native Windows acceptance` 显式启用原生测试，运行隔离桌面中的更新交互和安装、升级、卸载验收。发布门禁要求同一候选的两组任务均成功，无头通过不能替代 Windows 原生验收。版本准备使用 `cargo xtask release sync-version <version>` 同步工作区与锁文件中的产品版本。

GitHub Actions 生成正式发布资产后、发布 GitHub Release 前，还必须执行：

- `cargo xtask release verify <version> <bundle-dir> <output-dir> <repository> v<version>`

独立校验命令重新读取磁盘产物。`<bundle-dir>` 下的 `x64/` 和 `arm64/` 各含三个文件，即 `patina.exe`、签名安装包和该架构的 `latest.json`。校验器核对桌面程序的 PE 架构、输入与最终安装包的 SHA-256、完整 `SHA256SUMS.txt`、清单版本、平台、字节数和下载 URL，并使用应用公钥验证安装包签名及版本、架构注释。发布后从 GitHub 下载四个公开附件，逐一比对本地产物摘要。回读失败时停止镜像同步，保留已发布资产。

默认不在本地手工生成 `dist-release`、安装包或更新清单。
`cargo xtask release` 的 `write-release-notes`、`package` 和 `prepare` 子命令
默认属于 GitHub Actions 工作流 [`prepare-release.yml`](../.github/workflows/prepare-release.yml)
中的 `Publish Release` 流程，只有在明确需要排查发布流水线问题时才例外。
浏览器商店提交、AMO 公开 listed XPI 获取与扩展 GitHub Release 不属于 Patina 主应用发布流程；它们由 `patina-web-sync` 仓库负责。

如果改动触及 [`architecture.md`](./architecture.md) 中的高风险区、tracking 主链、读模型边界或运行时契约，不应跳过这些最低门槛。

---

### 授权与事项引用

远程 push、commit scope、Issue 引用和自动关闭关键词统一由根 [`AGENTS.md`](../AGENTS.md) 与 [`CONTRIBUTING.md`](../CONTRIBUTING.md) 拥有。发布流程只增加两项边界：普通分支 push 授权不包含创建或推送 tag，普通仓库 push 也不包含发布 GitHub Release；这两项必须在当前任务中获得各自明确授权。
