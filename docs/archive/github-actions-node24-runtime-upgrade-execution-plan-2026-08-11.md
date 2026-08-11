# GitHub Actions Node 24 运行时升级执行方案（2026-08-11）

## 0. 文档状态

- [x] 文档类型：一次性执行方案（How-to / maintainer runbook）。
- [x] 目标读者：Patina 维护者与获得仓库修改授权的协作者。
- [x] 用户目标：消除 GitHub Actions 中由已固定旧 Action 引发的 Node.js 20 弃用警告，同时保持工作流供应链固定、验证强度和发布行为不变。
- [x] 当前状态：已完成并归档。
- [x] 当前执行位置：`docs/archive/`。
- [x] 实施完成后，将本文状态改为“已完成并归档”。
- [x] 实施完成后，将本文移动到 `docs/archive/`。
- [x] 归档后，`docs/working/` 不保留活动副本。

本文是一份已经完成的 CI 运行时维护记录，不是长期版本清单。长期工程质量与发布约束仍分别以 `docs/engineering-quality.md` 和 `docs/versioning-and-release-policy.md` 为准。

### 0.1 完成摘要

- 基线：`main@6305a40b386367396cef2ddb06803b3ec4d85120`；执行前工作区只有本文一个未跟踪文档。
- 工作流：替换 21/21 处旧 Node 20 Action 引用；三个 workflow 除受审查 Action 引用外保持相同。
- 供应链：40/40 个 `uses:` 固定到完整 SHA；浮动 tag、摘要降级、warning 抑制和兼容双轨均为 0。
- 测试：新增 `testWorkflowsUseReviewedNode24ActionRevisions`，覆盖当前全部 6 类、40 处 Action 引用，未知 Action 必须先完成 Node 运行时审查。
- 验证：`npm run test:release`、`npm test`、`npm run test:replay`、`npm run build`、`npm run check`、`npm run check:full` 全部通过；最终 `check:full` 对应对抗式修复后的文件状态。
- Rust：`624 passed / 1 ignored`；fmt、check、clippy 和依赖审计通过。
- 对抗式审查：发现初版防回流测试没有覆盖另外两类已审查 Node 24 Action，已扩展为完整 allowlist 并重新跑全门禁。
- 授权边界：本次没有创建 commit、push、tag、Release 或 Project/Issue 变更；远端 Verify 与 annotation 观察留待下一次获得明确推送授权时执行。

归档勾选口径：

- 已完成的事实核查可以预先标记为 `[x]`。
- 实际实施与验证项标记 `[x]` 表示已有本轮证据。
- 非目标、停止条件与回滚项标记 `[x]` 表示已逐项审查且未触发。
- commit 与远端条件项标记 `[x]` 表示授权边界已审查并按规则未执行，不表示已经提交或推送。

---

## 1. 目标结果

本专项要形成以下完成态：

- [x] `.github/workflows/pr-intake.yml` 不再引用内部声明 `node20` 的 `actions/checkout` 或 `actions/setup-node` 修订。
- [x] `.github/workflows/verify.yml` 不再引用内部声明 `node20` 的 `actions/checkout`、`actions/setup-node` 或 `actions/upload-artifact` 修订。
- [x] `.github/workflows/prepare-release.yml` 不再引用内部声明 `node20` 的 `actions/upload-artifact` 或 `actions/download-artifact` 修订。
- [x] 所有 GitHub Action 继续固定到完整 40 位 commit SHA，不使用浮动 tag。
- [x] `.node-version` 继续保持 `24.18.0`，产品构建工具链不因本专项改变。
- [x] Action 的输入、输出目录、artifact 名称、保留期限、权限和 job 依赖不变。
- [x] 下载 artifact 时保留新版默认的摘要不一致即失败行为，不将其降级为 warning 或 ignore。
- [x] 本地发布策略测试、最低前端验证和完整质量门禁全部通过。
- [x] 本次未获得远端推送授权，因此不伪造 Verify 结论；下一次授权 push 必须继续验收远端 annotation。
- [x] 不创建测试 tag、不重跑 `v1.9.3`、不创建测试 Release。

一句话目标：

> 让 CI 自身完整运行在 GitHub 当前支持的 Node 24 Action 运行时上，同时不改变 Patina 被构建、测试和发布的任何产品语义。

---

## 2. 问题定义

Patina 自身已经通过 `.node-version` 使用 Node.js `24.18.0`。当前警告并不是项目脚本使用 Node 20，而是部分 GitHub Action 的 `action.yml` 仍声明：

```yaml
runs:
  using: node20
```

GitHub runner 目前会把这些 Action 强制放到 Node 24 上执行，因此 `v1.9.3` 发布没有失败。但警告说明仓库仍固定着已经落后于平台运行时生命周期的 Action 修订。

如果继续忽略，会产生四类风险：

1. GitHub 未来取消兼容执行后，原本只是 warning 的问题可能升级为 CI 阻断。
2. warning 长期存在会掩盖真正需要处理的新 annotation，降低信噪比。
3. 主分支验证与发布工作流使用不同代际的同一官方 Action，维护口径分裂。
4. 当前测试只保证 Action 使用完整 SHA，没有完整证明这些 SHA 对应受支持的 Node 运行时。

本专项解决的是 CI 基础设施生命周期问题，不是产品 Node 版本问题。

---

## 3. 第一性原理

### 3.1 必须区分三种 Node 版本

一次 GitHub Actions 任务中可能同时存在三种不同概念：

| 概念 | Owner | 当前 Patina 状态 | 本专项是否修改 |
| --- | --- | --- | --- |
| 项目脚本使用的 Node | `.node-version` + `actions/setup-node` 输入 | `24.18.0` | 否 |
| JavaScript Action 自身的运行时 | Action 仓库中的 `action.yml` | 部分旧修订为 `node20` | 是 |
| GitHub runner 实际强制使用的运行时 | GitHub Actions 平台 | 对旧 Action 强制 Node 24 | 不可由仓库直接修改 |

因此，错误做法包括：

- 不得修改 `.node-version` 来“配合”旧 Action。
- 不得把警告误判为 Patina 应用仍依赖 Node 20。
- 不得用隐藏 annotation 或忽略 warning 代替升级。

正确修复点只能是工作流中的 Action 修订。

### 3.2 Artifact 传递是发布安全边界

`upload-artifact` 与 `download-artifact` 不只是方便工具，它们连接了相互隔离的 job：

```text
release notes / Tauri build
            │ upload
            ▼
      GitHub artifact storage
            │ download
            ▼
asset verification / attestation / Release / R2
```

因此升级必须同时保持：

- artifact 名称一致；
- 上传路径一致；
- 下载目标目录一致；
- 压缩与解压语义一致；
- 摘要校验不能放宽；
- 发布资产验证和 attestation 顺序不变。

只看到“工作流能启动”不能证明升级正确。必须证明产物传递契约没有变化。

### 3.3 供应链稳定性要求完整 SHA

浮动引用例如 `actions/upload-artifact@v7` 会让同一仓库提交在未来执行不同代码。Patina 当前要求每个 Action 使用完整 commit SHA，并用注释保留已审查 major：

```yaml
uses: actions/upload-artifact@<40 位 commit SHA> # v7
```

所以升级必须满足：

- commit SHA 来自官方仓库的正式 tag；
- SHA 与 tag 的对应关系经过独立查询；
- 工作流保存完整 SHA；
- 注释只记录已审查 major，以符合现有发布策略测试。

### 3.4 新版本的更严格失败应被保留

`actions/download-artifact` v8 默认在下载摘要不匹配时失败。这不是需要兼容掉的行为，而是应保留的安全增强。

不得添加：

```yaml
digest-mismatch: warn
```

或：

```yaml
digest-mismatch: ignore
```

如果摘要不一致，正确结果就是阻断工作流并调查产物完整性。

### 3.5 本地验证与远端验证回答不同问题

本地验证可以证明：

- YAML 文本契约符合仓库规则；
- Action 引用已按预期替换；
- 发布工作流结构、权限和产物路径未被修改；
- 前端、测试、构建与发布策略代码没有回归。

只有 GitHub Actions 远端运行才能证明：

- GitHub runner 接受新的 Action 修订；
- artifact 能真实上传；
- annotation 中不再出现 Node 20 弃用警告。

本专项必须同时保留两层证据，不能用其中一层代替另一层。

---

## 4. 已确认基线

### 4.1 工具链与发布事实

- [x] `.node-version` 当前为 `24.18.0`。
- [x] `v1.9.3` 主分支 Verify 已全绿。
- [x] `v1.9.3` Publish Release 已完成 GitHub Release、安装包 attestation 和 R2 同步。
- [x] 已确认警告来自 Action 自身的 Node 运行时声明，而不是 Patina 脚本工具链。
- [x] 本专项不得修改或重跑已经成立的 `v1.9.3` 发布事实。

### 4.2 已审查的目标 Action

以下目标在 2026-08-11 通过官方 GitHub 仓库核对：

| Action | 当前引用 | 当前内部运行时 | 目标正式版本 | 目标 commit SHA | 目标内部运行时 |
| --- | --- | --- | --- | --- | --- |
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262 # v4` | Node 20 | v6 | `d23441a48e516b6c34aea4fa41551a30e30af803` | Node 24 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020 # v4` | Node 20 | v6 | `249970729cb0ef3589644e2896645e5dc5ba9c38` | Node 24 |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02 # v4` | Node 20 | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | Node 24 |
| `actions/download-artifact` | `d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4` | Node 20 | v8.0.1 | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | Node 24 |

官方审查入口：

- [x] `actions/upload-artifact` v7.0.1：<https://github.com/actions/upload-artifact/releases/tag/v7.0.1>
- [x] `actions/download-artifact` v8.0.1：<https://github.com/actions/download-artifact/releases/tag/v8.0.1>
- [x] 已读取两个目标版本的 `action.yml`，确认 `runs.using` 为 `node24`。
- [x] 已读取 `download-artifact` v8 发布说明，确认摘要不匹配默认升级为 error。

### 4.3 当前引用分布

需要替换的旧 Node 20 Action 共 21 处：

| 文件 | `checkout` | `setup-node` | `upload-artifact` | `download-artifact` | 合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `.github/workflows/pr-intake.yml` | 1 | 1 | 0 | 0 | 2 |
| `.github/workflows/verify.yml` | 9 | 3 | 1 | 0 | 13 |
| `.github/workflows/prepare-release.yml` | 0 | 0 | 3 | 3 | 6 |
| 合计 | 10 | 4 | 4 | 3 | 21 |

补充事实：

- [x] `prepare-release.yml` 已经使用目标 `checkout` v6 和 `setup-node` v6，可直接把相同已审查 SHA 复用到另外两个工作流。
- [x] `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4` 已声明 Node 24，不需要因 major 为 v4 而盲目替换。
- [x] `softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3` 已声明 Node 24，不在本专项范围。
- [x] 是否需要升级不能只看 major，必须看固定 SHA 对应的 `action.yml` 运行时。

### 4.4 当前测试约束

`tests/releasePolicy.test.ts` 当前已经：

- [x] 要求三个工作流中的每个 Action 都固定到 40 位 commit SHA。
- [x] 要求每个 `actions/setup-node` 都从 `.node-version` 读取项目 Node 版本。
- [x] 明确断言发布工作流使用 `upload-artifact # v4`。
- [x] 明确断言发布工作流使用 `download-artifact # v4`。

现有测试仍有缺口：

- [x] 尚未阻止 `checkout` 或 `setup-node` 的旧 Node 20 SHA 回流。
- [x] 尚未把已审查 Node 24 SHA 作为本地、无网络的工作流契约。
- [x] 只检查“完整 SHA”不能证明该 SHA 对应受支持运行时。

---

## 5. 范围与非目标

### 5.1 本次范围

- [x] 更新 `.github/workflows/pr-intake.yml` 中的旧 `checkout` 和 `setup-node` 引用。
- [x] 更新 `.github/workflows/verify.yml` 中的旧 `checkout`、`setup-node` 和 `upload-artifact` 引用。
- [x] 更新 `.github/workflows/prepare-release.yml` 中的旧 `upload-artifact` 和 `download-artifact` 引用。
- [x] 更新 `tests/releasePolicy.test.ts` 中与 Action major 和受审查 SHA 相关的契约测试。
- [x] 本地验证所有工作流文本契约和项目质量门禁。
- [x] 在获得当前任务远端授权后，推送并观察主分支 Verify。
- [x] 完成对抗式审查并归档本文。

### 5.2 非目标

- [x] 不修改 `.node-version`。
- [x] 不升级 npm、Rust、Tauri 或产品依赖。
- [x] 不修改应用源代码、用户界面或运行时行为。
- [x] 不修改 release job 拓扑、权限、concurrency、tag 规则或 Release 不可变规则。
- [x] 不修改 artifact 名称、路径、保留天数或最终 Release 附件名称。
- [x] 不启用 `upload-artifact` v7 的 `archive: false` 直接上传模式。
- [x] 不放宽 `download-artifact` v8 的摘要校验。
- [x] 不创建兼容 wrapper、转发 Action 或带版本号的自定义函数。
- [x] 不为验证本专项创建 branch、Pull Request、tag 或测试 Release，除非用户另行明确授权相应动作。
- [x] 不重写、删除或移动 `v1.9.3` tag 和 Release。
- [x] 不借机升级其他已经使用 Node 24 的 Action。

---

## 6. 必须保持的不变量

执行前后逐项比较，以下内容必须完全保持：

### 6.1 验证工作流

- [x] `Verify` 的触发条件不变。
- [x] push、workflow run 和手工选择 PR 的 checkout ref 行为不变。
- [x] frontend、Rust、Tauri runtime 三个 job 的条件和 runner 不变。
- [x] `core-risk-coverage` artifact 名称、路径及 `if-no-files-found: error` 不变。
- [x] frontend 仍运行 `npm run check`。
- [x] Rust 仍运行 `npm run check:rust` 和依赖审计。
- [x] Tauri runtime smoke 的 timeout 与执行命令不变。

### 6.2 PR intake 工作流

- [x] 仍 checkout 受信任 base revision。
- [x] 仍只 fetch PR head，不直接在特权上下文 checkout 外部代码。
- [x] `fetch-depth: 0` 不变。
- [x] intake gate 的环境变量和命令不变。

### 6.3 发布工作流

- [x] `release-notes`、`tauri-bundle`、`release-assets` 三个 artifact 名称不变。
- [x] Tauri bundle 仍同时上传唯一 `.exe` 与 `.exe.sig`。
- [x] release notes 仍下载到 `dist-release`。
- [x] Tauri bundle 仍下载到 `src-tauri/target/release/bundle/nsis`。
- [x] `Prepare release assets` 仍发生在下载之后。
- [x] `Verify release assets` 仍发生在 attestation 和 GitHub Release 之前。
- [x] R2 job 仍下载 `release-assets`，不直接重新生成 GitHub 发布资产。
- [x] 发布权限保持最小化，不新增 `write` 权限。

---

## 7. 完成定义与硬门槛

只有同时满足以下条件，才允许把本文标记完成：

### 7.1 修改正确性

- [x] 21 处旧 Node 20 Action 引用全部替换。
- [x] 三个工作流中不存在四个已知旧 SHA。
- [x] `checkout` 全部使用目标 v6 SHA。
- [x] `setup-node` 全部使用目标 v6 SHA。
- [x] `upload-artifact` 全部使用目标 v7.0.1 SHA，并注释 `# v7`。
- [x] `download-artifact` 全部使用目标 v8.0.1 SHA，并注释 `# v8`。
- [x] 其他 Action 引用未改变。

### 7.2 防回流保护

- [x] 发布策略测试明确验证已审查 Node 24 Action 修订。
- [x] 测试在无网络环境下即可发现旧 SHA 或意外 Action major 回流。
- [x] 所有 Action 仍满足完整 SHA 固定规则。
- [x] 所有 `setup-node` 仍从 `.node-version` 读取版本。

### 7.3 本地验证

- [x] `npm run test:release` 通过。
- [x] `npm test` 通过。
- [x] `npm run test:replay` 通过。
- [x] `npm run build` 通过。
- [x] `npm run check` 通过。
- [x] `npm run check:full` 通过。
- [x] 工作区没有新增生成文件、临时文件或无关改动。

### 7.4 远端验证（本次不适用）

- [x] 已确认当前任务没有远端推送授权。
- [x] 未创建 commit，未执行 `git push`，因此没有触发新的 Verify run。
- [x] 本地 `check:full` 通过不能冒充远端 frontend、Rust 或 Tauri runtime job 结论。
- [x] 40/40 个 Action 引用已由本地契约证明为受审查 Node 24 修订；远端 annotation 留待下一次授权 push 观察。
- [x] 本次没有远端重跑，不存在用重跑掩盖远端首轮失败。

### 7.5 归档

- [x] 完成对抗式审查。
- [x] 填写最终执行记录。
- [x] 将本文移动至 `docs/archive/`。
- [x] `docs/working/` 中不保留副本。

---

## 8. 阶段 A：冻结执行基线

### A1. 确认仓库状态

- [x] 运行 `git status --short --branch`。
- [x] 记录当前分支与 HEAD：`git rev-parse HEAD`。
- [x] 如果存在用户未提交改动，记录文件并确保本专项不覆盖它们。
- [x] 确认没有正在进行的 merge、rebase 或 cherry-pick。
- [x] 不执行 `git reset --hard`、`git checkout --` 或其他破坏性清理。

### A2. 记录工具链

- [x] 运行 `node --version`，确认与 `.node-version` 一致。
- [x] 运行 `npm --version`。
- [x] 运行 `git --version`。
- [x] 记录执行日期和 Windows runner 相关环境差异。

### A3. 再次生成 Action 清单

运行：

```powershell
rg -n "^\s*uses:" .github/workflows
```

- [x] 保存三个工作流的 Action 引用清单。
- [x] 再次确认四个旧 SHA 的出现次数分别为 `10 / 4 / 4 / 3`。
- [x] 如果出现次数与本文不同，先查明新增改动，不机械批量替换。
- [x] 确认所有引用仍带完整 SHA 和 major 注释。

### A4. 基线验收

- [x] 当前范围与第 5 节一致。
- [x] 没有需要先处理的工作区冲突。
- [x] 目标 Action SHA 与官方 tag 对应关系仍可验证。
- [x] 本阶段不修改任何文件。

---

## 9. 阶段 B：先建立失败可见的策略测试

### B1. 更新发布工作流的 major 契约

在 `tests/releasePolicy.test.ts` 的 `testReleaseWorkflowSplitsQualityGatesBeforePublish()` 中：

- [x] 将 `upload-artifact ... # v4` 断言更新为 `# v7`。
- [x] 将 `download-artifact ... # v4` 断言更新为 `# v8`。
- [x] 保留完整 40 位 SHA 格式要求。
- [x] 不把断言放宽成“任意 major 都可以”。

### B2. 增加已审查 Node 24 Action 修订契约

新增一个语义明确的测试，例如：

```text
testWorkflowsUseReviewedNode24ActionRevisions
```

测试应：

- [x] 定义四个目标 Action 的唯一受审查引用字符串。
- [x] 对 `pr-intake.yml`、`verify.yml`、`prepare-release.yml` 全部扫描。
- [x] 对每个 `actions/checkout@...` 断言都等于目标 v6 SHA。
- [x] 对每个 `actions/setup-node@...` 断言都等于目标 v6 SHA。
- [x] 对每个 `actions/upload-artifact@...` 断言都等于目标 v7.0.1 SHA。
- [x] 对每个 `actions/download-artifact@...` 断言都等于目标 v8.0.1 SHA。
- [x] 保留已有“所有第三方 Action 固定完整 SHA”通用测试。
- [x] 不在测试运行时访问网络；官方来源核查发生在维护阶段，测试只检查已审查本地契约。

建议同时断言引用数量，防止漏改或意外删除：

| Action | 预期总出现次数 |
| --- | ---: |
| `actions/checkout` | 19 |
| `actions/setup-node` | 12 |
| `actions/upload-artifact` | 4 |
| `actions/download-artifact` | 3 |

如果工作流未来合理增减 job，应在同一审查中更新数量和理由，不能静默放宽。

### B3. 运行预期失败测试

在修改工作流前运行：

```powershell
npm run test:release
```

- [x] 测试按预期失败。
- [x] 失败原因明确指向旧 Action SHA / major，而不是语法错误或无关测试。
- [x] 保存失败摘要，证明新增测试真实捕获当前问题。
- [x] 如果测试意外通过，先修正测试，不继续修改工作流。

---

## 10. 阶段 C：更新工作流 Action 引用

### C1. 更新 PR intake

编辑 `.github/workflows/pr-intake.yml`：

- [x] 将 1 处 `actions/checkout` 替换为：

```yaml
uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
```

- [x] 将 1 处 `actions/setup-node` 替换为：

```yaml
uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
```

- [x] 不改变 base revision、fetch-depth、PR head fetch 或 gate 命令。

### C2. 更新 Verify

编辑 `.github/workflows/verify.yml`：

- [x] 将 9 处 `actions/checkout` 全部替换为目标 v6 SHA。
- [x] 将 3 处 `actions/setup-node` 全部替换为目标 v6 SHA。
- [x] 将 1 处 `actions/upload-artifact` 替换为：

```yaml
uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
```

- [x] 保持 `core-risk-coverage` 的 name、path 和错误策略不变。
- [x] 不启用 `archive: false`。

### C3. 更新发布工作流

编辑 `.github/workflows/prepare-release.yml`：

- [x] 将 3 处 `actions/upload-artifact` 全部替换为目标 v7.0.1 SHA，注释为 `# v7`。
- [x] 将 3 处 `actions/download-artifact` 全部替换为：

```yaml
uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8
```

- [x] 不修改已有 `checkout` v6 和 `setup-node` v6。
- [x] 不修改 upload 的 `name`、`path`、`if-no-files-found`、`retention-days`。
- [x] 不修改 download 的 `name` 或 `path`。
- [x] 不设置 `digest-mismatch`，保留 v8 默认 `error`。
- [x] 不设置 `skip-decompress`，保持现有自动解压语义。
- [x] 不设置 `archive: false`；`tauri-bundle` 包含 `.exe` 与 `.exe.sig` 两个文件，不符合单文件直接上传条件。

### C4. 保持文件格式

- [x] 三个 workflow YAML 继续使用 LF。
- [x] 不删除 `.gitattributes` 中 `.github/workflows/*.yml text eol=lf` 规则。
- [x] 不通过 PowerShell 重定向或 `Set-Content` 重写 YAML。
- [x] 使用正常代码补丁修改，避免重新格式化整个文件。

---

## 11. 阶段 D：静态契约核验

### D1. 确认旧 SHA 全部退出

分别搜索四个旧 SHA：

```powershell
rg -n "11d5960a326750d5838078e36cf38b85af677262|49933ea5288caeca8642d1e84afbd3f7d6820020|ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093" .github tests
```

- [x] 工作流中搜索结果为 0。
- [x] 如果测试需要把旧 SHA 作为禁止列表，命中只能出现在明确的负向测试 fixture 中。
- [x] 负向 fixture 不得被误当成仍在使用的 Action 引用。

### D2. 确认目标引用数量

- [x] `checkout` 目标 SHA 共 19 处。
- [x] `setup-node` 目标 SHA 共 12 处。
- [x] `upload-artifact` 目标 SHA 共 4 处。
- [x] `download-artifact` 目标 SHA 共 3 处。
- [x] `actions/attest` 与 `softprops/action-gh-release` SHA 未改变。

### D3. 确认工作流差异最小

运行：

```powershell
git diff -- .github/workflows/pr-intake.yml .github/workflows/verify.yml .github/workflows/prepare-release.yml tests/releasePolicy.test.ts
```

- [x] workflow diff 只包含 Action SHA 和 major 注释替换。
- [x] test diff 只包含对应契约更新与防回流测试。
- [x] 没有 job、step、权限、条件、命令、路径或空白格式的意外变化。

---

## 12. 阶段 E：本地验证

按“最快失败、逐步扩大”的顺序执行。任何一步失败都先定位，不自动重跑掩盖问题。

### E1. 聚焦发布策略测试

```powershell
npm run test:release
```

- [x] 通过。
- [x] 新增防回流测试真实执行。
- [x] v7 / v8 major 契约通过。
- [x] 完整 SHA 固定测试通过。
- [x] `.node-version` 单一来源测试通过。

### E2. 仓库最低前端验证

```powershell
npm test
npm run test:replay
npm run build
```

- [x] `npm test` 通过。
- [x] `npm run test:replay` 通过。
- [x] `npm run build` 通过。

### E3. 完整前端质量门禁

```powershell
npm run check
```

- [x] i18n、types、lint、architecture、IPC、hotspot、测试治理、coverage、mutation、browser smoke、build 和 bundle 全部通过。
- [x] 没有把既有 warning 当作成功证据。
- [x] 如果真实浏览器测试失败，记录首轮日志并判断是否与本专项有关。

### E4. 完整仓库质量门禁

```powershell
npm run check:full
```

- [x] frontend 全量通过。
- [x] Rust fmt、check、test、clippy 全部通过。
- [x] npm 与 Rust 依赖审计通过。
- [x] 不修改阈值、allowlist 或 ignored 测试来换取绿色。

### E5. 本地验证收口

- [x] `git status --short` 只显示本专项文件。
- [x] 没有 `dist-release/`、`updater-publish/`、临时浏览器目录或构建产物进入工作区。
- [x] 没有为本专项生成安装包。
- [x] 记录各命令通过时间与真实失败轮次。

---

## 13. 阶段 F：对抗式审查

### F1. 假设“警告只是被藏起来”

- [x] 搜索 workflow 是否新增 annotation 过滤、环境变量或日志抑制。
- [x] 确认没有删除 artifact step 来消除警告。
- [x] 确认没有把 `if: always()` 改掉。
- [x] 确认新 Action 的官方 `action.yml` 确实声明 `node24`。

### F2. 假设“上传成功但下载语义改变”

- [x] 确认未启用 `archive: false`。
- [x] 确认未启用 `skip-decompress`。
- [x] 确认 artifact name 完全匹配生产者和消费者。
- [x] 确认下载目标目录与后续脚本读取目录一致。
- [x] 确认 `.exe` 与 `.exe.sig` 仍作为同一 `tauri-bundle` 传递。

### F3. 假设“新版严格校验被兼容代码绕过”

- [x] 搜索 `digest-mismatch`，结果应为 0。
- [x] 搜索 `continue-on-error`，确认没有新增到 artifact 或发布校验步骤。
- [x] 确认 release asset gate 与 attestation 仍是硬阻断。
- [x] 确认没有新增 v4 fallback step 或条件式双轨上传。

### F4. 假设“供应链固定被弱化”

- [x] 所有 `uses:` 仍为 40 位 SHA。
- [x] 不存在 `@main`、`@master`、`@v6`、`@v7`、`@v8` 浮动引用。
- [x] major 注释与目标正式版本一致。
- [x] 新测试能在任一目标 SHA 被换回旧值时失败。

### F5. 假设“无关发布行为被顺手修改”

- [x] 比较 `prepare-release.yml` job 列表与 needs 图，无变化。
- [x] 比较 permissions，无变化。
- [x] 比较 concurrency，无变化。
- [x] 比较 GitHub Release、attestation、R2 step 顺序，无变化。
- [x] 比较三个公开资产名称，无变化。

### F6. 对抗式结论

- [x] 没有警告抑制。
- [x] 没有兼容双轨。
- [x] 没有摘要校验降级。
- [x] 没有供应链浮动引用。
- [x] 没有无关行为变化。
- [x] 允许进入提交或远端验证阶段。

---

## 14. 阶段 G：提交边界

本节只定义提交方式，不自动授权提交或推送。

### G1. 推荐代码提交

建议将三个工作流与对应策略测试放入一个原子提交，因为它们共同构成同一可验证契约：

```text
ci: upgrade Actions to Node 24 runtime
```

文件范围：

- `.github/workflows/pr-intake.yml`
- `.github/workflows/verify.yml`
- `.github/workflows/prepare-release.yml`
- `tests/releasePolicy.test.ts`

提交前：

- [x] 只暂存上述四个代码/配置文件。
- [x] 运行 `git diff --cached --stat`。
- [x] 运行 `git diff --cached --numstat`。
- [x] 检查 staged diff 不含执行方案文档或无关改动。
- [x] 提交规模低于仓库 1,000 行 / 25 文件门槛。

### G2. 文档归档提交

执行与远端验证完成后，本文单独归档：

```text
docs: archive Actions runtime upgrade plan
```

- [x] 填写真实执行记录。
- [x] 将全部已完成项勾选。
- [x] 未触发项按“已审查且未触发”口径记录。
- [x] 将文件从 `docs/working/` 移动到 `docs/archive/`。
- [x] 提交前检查 staged stat 与 numstat。

### G3. 授权边界

- [x] 没有明确“提交到本地”或同等授权时，不自行创建 commit。
- [x] 没有当前任务明确远端授权时，不执行 `git push`。
- [x] 普通 push 授权不包含 tag、Release、Issue 或 Project 变更。
- [x] 本专项不需要 tag 或 Release 授权。

---

## 15. 阶段 H：远端验证（本次未授权执行）

当前任务没有表达仓库或远端目的地，因此本节按授权边界收口，不执行远端写入。

### H1. 本次处置

- [x] 已检查 `git status --short --branch`，本地范围符合预期。
- [x] 未创建本地提交，`git log` 仍停留在基线 `6305a40`。
- [x] 本地完整门禁通过。
- [x] 未执行 `git push`。
- [x] 未创建额外分支、Pull Request、tag 或 Release。

### H2. 下一次授权 push 的验收项

- [x] 已保留验收要求：定位对应 Verify run 并记录 run ID、commit SHA 和 URL。
- [x] 已保留验收要求：等待 frontend、Rust、Tauri runtime 全部结束。
- [x] 已保留验收要求：读取首轮真实失败，不直接重跑。
- [x] 已保留验收要求：检查 run summary annotations，不以“流水线绿”代替 warning 审查。
- [x] 已保留验收要求：如仍有 Node 20 warning，记录具体 Action 与 SHA 后另行处理。

### H5. 发布工作流的验证边界

- [x] 不为执行本专项创建测试 tag。
- [x] 不重跑已发布的 `v1.9.3`。
- [x] `prepare-release.yml` 先由本地策略测试、静态契约和 GitHub 对 YAML 的接收完成验证。
- [x] 下一次真实版本发布时，额外确认 release notes、Tauri bundle 和 release assets 的上传/下载全部成功。
- [x] 下一次真实发布若出现摘要不匹配，按安全失败处理，不放宽 v8 默认策略。

### H6. PR intake 的验证边界

- [x] 不为了运行 `pr-intake.yml` 人为创建 PR。
- [x] 本次通过相同已审查 checkout/setup SHA、策略测试和本地完整门禁建立基础证据。
- [x] 下一次真实外部 PR 到达时，确认 intake gate 正常执行且安全边界不变。

---

## 16. 停止条件与处置

触发任一条件时停止继续扩张：

- [x] 官方 tag 无法解析到本文记录的 commit SHA。
- [x] 目标 Action 的 `action.yml` 不再声明 Node 24。
- [x] `upload-artifact` v7 要求修改现有多文件 artifact 语义才能运行。
- [x] `download-artifact` v8 需要关闭摘要校验才能通过。
- [x] 工作流升级要求新增 write 权限。
- [x] release asset gate、attestation 或 R2 消费路径因升级而需要业务性重构。
- [x] 本地质量门禁暴露与 Action 升级无关的产品回归。
- [x] 远端 Verify 首轮失败且无法证明是本专项引起。
- [x] 工作区出现与本专项重叠的用户修改。

停止后：

1. [x] 保留首轮失败日志和 diff。
2. [x] 判断是 Action 升级问题、既有 CI 问题还是外部平台问题。
3. [x] 不通过 `continue-on-error`、warning 降级或兼容双轨绕过。
4. [x] 如需恢复旧 Action，只通过明确的新修改或可审查 revert，不重写远端历史。
5. [x] 恢复旧 Action 后明确记录 Node 20 warning 回归，本专项状态改为阻断而不是完成。
6. [x] 如果需要工作流架构变化，另开执行方案，不在本专项中扩张。

---

## 17. 回滚策略

### 17.1 尚未提交

- [x] 只撤销本专项明确修改的行。
- [x] 不触碰用户其他未提交改动。
- [x] 撤销后重新运行 `git diff` 确认范围。

### 17.2 已本地提交但未推送

- [x] 优先通过新修正提交保持证据链。
- [x] 只有用户明确要求改写本地提交时才调整提交历史。
- [x] 不使用 `git reset --hard`。

### 17.3 已推送但 Verify 失败

- [x] 创建新的修复或 revert 提交。
- [x] 不 force push。
- [x] 不删除远端分支历史。
- [x] 修复后等待新的完整 Verify，不把旧失败 run 当作通过。

### 17.4 下一次真实发布才暴露问题

- [x] 如果 GitHub Release 尚未成立，先按发布策略判断能否修复后补跑已有 tag 流程。
- [x] 如果 GitHub Release 已成立，不覆盖同 tag 资产；按不可变发布规则准备新版本。
- [x] 不通过关闭 digest 校验、跳过 asset gate 或跳过 attestation 补救。

---

## 18. 最终执行记录

### 18.1 执行环境

- [x] 基线 commit：`6305a40b386367396cef2ddb06803b3ec4d85120`。
- [x] 最终 commit：`未创建；本轮未获得本地提交要求，改动保留在工作区`。
- [x] Node / npm：`v24.18.0 / 11.16.0`。
- [x] 执行日期：`2026-08-11`。

### 18.2 修改结果

- [x] 替换旧 Action 引用：`21 / 21`。
- [x] 新增或更新策略测试：`更新发布 workflow 的 v7/v8 契约；新增覆盖 6 类、40 处 Action 的 Node 24 allowlist`。
- [x] 工作流行为性改动：`0；归一化 Action 引用后，三个 workflow 均与基线完全一致`。
- [x] 兼容代码或双轨 fallback：`0`。

### 18.3 本地验证结果

| 命令 | 结果 | 耗时 | 备注 |
| --- | --- | ---: | --- |
| `npm run test:release` | 通过 | `0.8s` | 修改前按预期失败；修改后及对抗式增强后通过 |
| `npm test` | 通过 | `16.8s` | 全部快速确定性测试通过 |
| `npm run test:replay` | 通过 | `0.8s` | 15 个 replay 测试通过 |
| `npm run build` | 通过 | `13.7s` | 沙箱内先因原生绑定 / spawn EPERM 失败；沙箱外同命令通过 |
| `npm run check` | 通过 | `139.1s` | 含 coverage、mutation、85 个 browser smoke 和 bundle |
| `npm run check:full` | 通过 | `154.5s` | 对抗式修复后最终复验；Rust 与依赖审计通过 |

### 18.4 远端验证结果

- [x] Verify run：`本次不适用；没有当前任务远端推送授权`。
- [x] frontend：`本地 npm run check 与 check:full 通过；未触发远端 job`。
- [x] Rust：`本地 624 passed / 1 ignored；未触发远端 job`。
- [x] Tauri runtime：`工作流行为未改；未触发远端 job`。
- [x] Node 20 annotation：`本地静态契约确认全部 40 处 Action 为已审查 Node 24 修订；远端 annotation 留待下一次授权 push 验收`。
- [x] 首轮失败与处置：`无远端运行；本地 build 的沙箱 EPERM 通过同命令沙箱外运行证明为环境限制`。

### 18.5 最终对抗式结论

- [x] 是否隐藏 warning：`否；warning 抑制模式命中 0`。
- [x] 是否放宽摘要校验：`否；digest-mismatch、archive: false、skip-decompress、continue-on-error 命中 0`。
- [x] 是否引入浮动 Action 引用：`否；40/40 为完整 SHA，mutable tag 命中 0`。
- [x] 是否改变发布产物契约：`否；归一化 Action 引用后三个 workflow 与基线完全一致`。
- [x] 是否改变权限或 tag / Release 行为：`否`。
- [x] 是否允许归档：`是；本地实施、验证和对抗式审查完成，远端条件按授权规则延期`。

---

## 19. 推荐执行顺序

1. [x] 阶段 A：冻结仓库、工具链和 Action 引用基线。
2. [x] 阶段 B：先增加能捕获旧 SHA 的策略测试，并观察预期失败。
3. [x] 阶段 C：替换三个工作流中的 21 处旧 Action 引用。
4. [x] 阶段 D：执行旧 SHA、目标计数和最小 diff 静态核验。
5. [x] 阶段 E：按聚焦测试、最低验证、完整门禁顺序验证。
6. [x] 阶段 F：执行对抗式审查。
7. [x] 阶段 G：完成提交边界审查；本次没有提交要求，未创建 commit。
8. [x] 阶段 H：完成远端授权边界审查；本次没有 push 授权，未触发 Verify。
9. [x] 填写第 18 节真实执行记录。
10. [x] 将本文移动到 `docs/archive/`；本次没有提交要求，不创建归档 commit。

---

## 20. 当前结论

本专项的正确方案不是修改 Patina 的 Node 版本，也不是屏蔽 GitHub warning，而是：

- [x] 保持项目 Node `24.18.0` 不变。
- [x] 把旧 JavaScript Action 固定修订升级到官方 Node 24 版本。
- [x] 继续使用完整 commit SHA，拒绝浮动 tag。
- [x] 保留 `download-artifact` v8 更严格的摘要失败语义。
- [x] 用本地策略测试防止旧 SHA 回流。
- [x] 用主分支远端 Verify 证明真实 GitHub runner 行为。
- [x] 不用测试 tag 或假 Release 破坏发布不可变边界。

方案已全部执行并完成本地归档。工作流和策略测试改动保留在工作区；未创建 commit，未推送远端，也未触发 tag 或 Release。
