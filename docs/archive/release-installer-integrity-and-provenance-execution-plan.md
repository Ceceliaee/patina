# Patina Windows 发布安装包完整性与构建来源证明执行方案

## 1. 文档定位

本文是一次性、可勾选的实施方案，用于为 Patina 正式发布的 Windows 安装包补齐以下能力：

- 对最终公开安装包生成可独立复算的 SHA-256 校验文件。
- 对同一个最终公开安装包生成 GitHub Artifact Attestation。
- 在 GitHub Release 对外发布前，自动阻断安装包缺失、候选歧义、版本漂移、文件名漂移、哈希不一致和 updater manifest 指向错误。
- 在首次真实发布中验证公开附件、来源证明和 R2 镜像仍符合长期发布规则。

本文面向 Patina 维护者和后续负责实施的 Codex。执行者应从顶部开始按阶段推进，只有当前阶段的退出条件全部满足，才勾选该阶段并进入下一阶段。

本文不是新的长期规则来源。实施完成后，稳定规则必须同步到 [`../versioning-and-release-policy.md`](../versioning-and-release-policy.md)，本文随后移入 `docs/archive/`。

### 1.1 当前状态

- 文档状态：本地实现、完整验证与对抗式复审完成；已归档。
- 对应 Project item：`为发布安装包生成哈希与构建来源证明`。
- 截图中状态：`Next`；执行开始前由维护者在 Board 视图手动拖到 `In progress`。
- 计划编写日期：2026-08-08。
- 计划不授权：创建提交、推送分支、创建或推送 tag、发布 GitHub Release、修改 Project 状态或执行其他远程写入。

### 1.2 如何使用本文

- `[ ]` 表示尚未完成的动作或判据。
- `[x]` 只允许在执行者取得对应证据后填写。
- 每个阶段末尾的“退出条件”是硬门槛，不得因后续阶段看似可执行而跳过。
- 发现真实仓库状态与本文假设不一致时，先更新本文或长期规则，再继续实现；不得静默扩大范围。
- 首次真实发布属于单独授权的发布动作。本地实现完成不等于获准创建 tag 或发布 Release。

### 1.3 执行结果（2026-08-08）

- [x] 最终公开安装包采用唯一候选选择，并在复制前后复算 SHA-256。
- [x] 生成严格单记录、UTF-8 无 BOM、LF 结尾的 `SHA256SUMS.txt`。
- [x] 增加独立的发布资产复验命令，覆盖安装包、校验文件和 `latest.json` 的重新读取与交叉校验。
- [x] GitHub Actions 以最小权限为最终公开 `.exe` 生成 Artifact Attestation，失败即阻断 Release。
- [x] GitHub Release 资产集合固定为安装包、`latest.json` 与 `SHA256SUMS.txt`；R2 仍只镜像安装包与 `latest.json`。
- [x] 增加同 tag 并发串行、既有 Release fail-closed 检查和禁止覆盖同名资产，避免重复运行改写已发布字节。
- [x] 专项测试与 `npm run check:full` 全部通过；依赖审计为 0 个已知漏洞。
- [x] 对抗式审查发现的重复发布覆盖风险已修复；复审未发现新的高、中风险问题。
- [x] 长期规则已同步到 `docs/versioning-and-release-policy.md`，README 未修改。
- [ ] 下一次获准正式发布后，下载公开附件并执行远程 SHA-256、attestation 与 R2 验收。该项保留为发布时运行检查，不是本次自动化实现事项的完成前置条件。

执行过程中重新核对了 live Project 的原始范围：事项要求发布工作流自动生成、验证并发布证明材料，但没有授权或要求本次立即创建 tag/GitHub Release。因而，本次事项以“发布路径已实现、自动 gate 已测试、工作流与长期规则已完成”为完成边界；真实远程发布仍必须在未来取得独立发布授权后执行。

---

## 2. 第一性原理

### 2.1 我们真正要证明什么

用户下载到一个名为 `Patina_<version>_x64-setup.exe` 的文件时，仅凭文件名不能知道它是否可信。任何人都可以复制文件名。因此发布系统必须建立一条从“最终字节”到“官方发布上下文”的可验证链路。

需要分别证明四个事实：

1. **对象唯一**：本次发布究竟选择了哪个 Tauri 安装包作为输入。
2. **字节稳定**：公开安装包与被选中的输入安装包字节完全一致，且发布后可由任何人复算。
3. **来源可追踪**：该组最终字节由 Patina 仓库的指定 GitHub Actions 工作流，在指定源码引用下登记。
4. **发布前一致**：版本、文件名、下载 URL、updater 签名引用和公开附件集合在发布发生前已经对齐。

这四个事实不能由单一机制全部证明：

| 机制 | 证明的事实 | 不证明的事实 |
| --- | --- | --- |
| SHA-256 | 两份文件是否具有相同字节 | 哈希由谁发布、软件是否安全 |
| `SHA256SUMS.txt` | 官方声明的最终附件摘要 | 校验文件本身未被一起替换 |
| Artifact Attestation | 摘要与仓库、工作流、源码引用之间的签名声明 | 源码不存在漏洞、runner 和依赖绝对安全 |
| Tauri `.sig` | updater 私钥授权该安装包用于更新 | 手动下载用户容易验证、构建工作流来源 |
| 发布资产 gate | 当前 runner 上即将发布的文件彼此一致 | GitHub Release 发布后绝不会被平台外部因素改变 |

### 2.2 为什么必须针对最终公开文件

当前流程先由 Tauri 生成 NSIS 安装包和 `.exe.sig`，再由 [`../../scripts/release.ts`](../../scripts/release.ts) 把安装包复制为公开名称：

```text
Patina_<version>_x64-setup.exe
```

用户下载的是复制后的最终文件，不是 Tauri bundle 目录中的原始路径。因此：

- SHA-256 必须从 `dist-release/Patina_<version>_x64-setup.exe` 重新读取并计算。
- Attestation 的 `subject-path` 必须指向该最终文件。
- 校验必须比较输入安装包与最终安装包的摘要，不能仅假设 `copyFile` 永远得到预期对象。
- 文件名必须进入校验不变量，避免“名字是新版本、内容是旧版本”。

### 2.3 为什么生成与验证必须分离

一个函数如果刚刚写出校验文件，随后只相信自己内存中的摘要，就只能证明“写入代码执行过”，不能证明磁盘上的最终产物仍然一致。

本方案要求两个独立命令：

```text
release:prepare-assets
release:verify-assets
```

前者生成文件；后者重新打开磁盘文件、重新解析文本和 JSON、重新计算摘要并决定是否放行。GitHub Release 必须显式依赖第二个命令成功。

---

## 3. 威胁模型与能力边界

### 3.1 本方案需要处理的风险

- [x] Tauri bundle 中没有 `.exe.sig`，但流程继续发布了未配对安装包。
- [x] Tauri bundle 中存在多个 `.exe.sig`，脚本用 `.find()` 静默选择了第一个候选。
- [x] `.exe.sig` 存在，但对应 `.exe` 缺失。
- [x] 公开文件名中的版本与目标 tag 版本不一致。
- [x] 复制或后续处理导致最终安装包字节与输入安装包不一致。
- [x] `SHA256SUMS.txt` 缺失、格式错误、记录了错误文件名或错误摘要。
- [x] `latest.json` 的版本、平台键、下载 URL 或 signature 缺失或漂移。
- [x] workflow 生成了校验文件，但没有把它上传为 Release asset。
- [x] workflow 对原始 bundle 而不是最终公开附件生成 attestation。
- [x] attestation 权限缺失或步骤失败，但 Release 仍然被发布。
- [x] R2 镜像职责扩大后反向阻塞或改变 GitHub Release 主发布事实。

### 3.2 本方案明确不解决的风险

- [x] 不阻止第三方原封不动转售 MIT 许可下的官方二进制。
- [x] 不修改 `LICENSE`，不重新定义商业使用权。
- [x] 不加入 Windows Authenticode 代码签名服务。
- [x] 不承诺消除 SmartScreen、“未知发布者”或杀毒软件误报。
- [x] 不证明源码、依赖、runner 或构建工具链绝对没有漏洞。
- [x] 不在应用内增加自我校验按钮或联网查询 attestation 的运行时逻辑。
- [x] 不修改 `README.md` 或 `README.zh-CN.md`。
- [x] 不把 attestation bundle 导出为普通 GitHub Release 附件。
- [x] 不把 `SHA256SUMS.txt` 复制到 R2，也不把 R2 变成历史发布仓库。

### 3.3 安全陈述边界

实现、注释和发布说明只能声称：

> 用户可以验证下载到的安装包是否与 Patina 官方发布工作流登记的最终构建产物具有相同字节，并查看该证明关联的仓库、源码引用和工作流。

不得声称：

- “通过校验就绝对安全”。
- “通过校验就没有恶意代码”。
- “第三方收费版本一定违法”。
- “Attestation 等同于 Windows 代码签名”。

---

## 4. 当前发布链路与已确认缺口

### 4.1 当前链路

当前 [`../../.github/workflows/prepare-release.yml`](../../.github/workflows/prepare-release.yml) 的相关顺序是：

```text
resolve tag
  -> version/changelog/frontend/rust gates
  -> build Tauri NSIS bundle and .exe.sig
  -> upload tauri-bundle workflow artifact
  -> publish job downloads bundle
  -> prepare-release-assets copies and renames installer
  -> write latest.json
  -> upload release-assets workflow artifact
  -> publish GitHub Release
  -> optionally sync installer and latest.json to R2
```

### 4.2 当前缺口

- [`../../scripts/release.ts`](../../scripts/release.ts) 的 `findSignedInstaller()` 使用 `.find()`，存在多候选时不会失败。
- `prepareReleaseAssets()` 复制最终安装包后没有重新计算或比较输入与输出摘要。
- workflow 没有生成或发布 `SHA256SUMS.txt`。
- workflow 顶层目前只有 `contents: write`，没有 attestation 所需的 job 级权限。
- workflow 没有在最终文件形成后调用 `actions/attest@v4`。
- GitHub Release 发布前没有独立的 release asset gate。
- [`../../tests/releasePolicy.test.ts`](../../tests/releasePolicy.test.ts) 只检查当前附件与 job 结构，没有覆盖哈希格式、安装包候选歧义、manifest 对齐或 attestation 顺序。
- [`../versioning-and-release-policy.md`](../versioning-and-release-policy.md) 仍把 Patina Release 描述为只发布安装包、`latest.json` 与 updater 所需资产，尚未登记 `SHA256SUMS.txt` 和来源证明规则。

---

## 5. 已确认设计决策

### 5.1 最终公开资产

GitHub Release 的固定公开资产为：

```text
Patina_<version>_x64-setup.exe
SHA256SUMS.txt
latest.json
```

约束：

- `SHA256SUMS.txt` 只记录 Windows 安装包，不记录 `latest.json`。
- `.exe.sig` 继续只作为生成 `latest.json` 中 updater signature 的输入，不作为普通 Release asset。
- release notes 继续通过 `body_path` 发布，不作为普通 Release asset。
- R2 继续只同步安装包和 R2 专用 `latest.json`。

### 5.2 SHA-256 文件格式

`SHA256SUMS.txt` 必须使用 UTF-8、LF 和单个末尾换行，正文恰好一条非空记录：

```text
<64 个小写十六进制字符><两个空格>Patina_<version>_x64-setup.exe
```

示例：

```text
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  Patina_1.9.3_x64-setup.exe
```

禁止：

- 绝对路径或 `dist-release/` 前缀。
- 大写或混合大小写摘要。
- 多个安装包记录。
- `SHA256 (file) = digest` 等平台专用格式。
- 额外说明文字、Markdown code fence 或 BOM。

### 5.3 Attestation 位置

Attestation 必须在 `publish` job 中执行：

1. `Prepare release assets` 成功。
2. `Verify release assets` 成功。
3. `actions/attest@v4` 对最终 `.exe` 成功。
4. workflow artifact 与 GitHub Release 才能上传或发布。

这确保 attestation 失败会阻断正式 Release，而不是在 Release 已经公开后才报错。

### 5.4 权限最小化

不得把 attestation 权限授予整个 workflow 的所有 job。目标结构：

```yaml
permissions:
  contents: read

jobs:
  publish:
    permissions:
      contents: write
      id-token: write
      attestations: write
      artifact-metadata: write
```

执行时必须以所采用的 `actions/attest@v4` 版本实际要求为准。如果 `artifact-metadata: write` 在仓库当前平台能力中不可用或不必要，应先查明原因并记录，不得通过扩大为其他宽泛权限绕过。

### 5.5 Owner 边界

- `scripts/release.ts`：发布资产命名、生成、解析和一致性校验的唯一代码 owner。
- `tests/releasePolicy.test.ts`：发布脚本纯逻辑和 workflow 结构契约测试。
- `.github/workflows/prepare-release.yml`：远程 job 顺序、权限、attestation 和公开附件编排。
- `docs/versioning-and-release-policy.md`：长期发布规则和维护者操作说明。
- 不新建通用 `src/shared`、`src/platform` 或产品运行时模块。

---

## 6. 完成定义

实现完成必须同时满足：

- [x] 对最终公开安装包生成规范化 `SHA256SUMS.txt`。
- [x] 输入 bundle 与最终安装包摘要一致，否则失败。
- [x] 安装包和 `.exe.sig` 候选不是恰好一对时失败。
- [x] 独立 `verify-release-assets` 命令可以重新验证磁盘产物。
- [x] `latest.json` 的版本、目标平台、URL 和 signature 被 gate 校验。
- [x] GitHub Release 发布前生成最终 `.exe` 的 Artifact Attestation。
- [x] Attestation 失败会阻断 GitHub Release。
- [x] GitHub Release 包含 `.exe`、`SHA256SUMS.txt` 和 `latest.json`。
- [x] R2 同步行为和非阻塞边界保持不变。
- [x] 正向和反向测试覆盖新增的不变量。
- [x] `npm run check:full` 通过。
- [ ] `npm run release:validate-changelog -- <version>` 在实际发布准备版本上通过；普通实现阶段没有正式版本参数时，不伪造版本执行。
- [ ] 首次获准的真实发布中，远程下载、SHA-256 复算和 attestation 验证通过。
- [x] 长期发布文档已更新，本计划归档。

---

## 7. 阶段 0：建立实施基线

### 7.1 Project 与授权边界

- [x] 重新读取 live Project，确认对应 item、当前状态、唯一 `In progress` 和 `Next` 窗口。
- [x] 不适用：live Project 读取时事项已经位于 `In progress`，无需再建议 `Next -> In progress`。
- [x] 未发现其他主要 `In progress` 与本事项冲突。
- [x] 不代替维护者修改运行中的 Project 状态。
- [x] 确认本轮授权仅包含本地实现和验证；没有明确远程授权时，不执行 `git push`、tag 或 Release 操作。

### 7.2 工作区与基线

- [x] 执行 `git status --short`，记录用户已有改动。
- [x] 不覆盖或整理与本事项无关的工作区变化。
- [x] 检查以下文件当前内容：
  - [x] `scripts/release.ts`
  - [x] `tests/releasePolicy.test.ts`
  - [x] `package.json`
  - [x] `.github/workflows/prepare-release.yml`
  - [x] `docs/versioning-and-release-policy.md`
- [x] 确认当前附件名仍为 `Patina_<version>_x64-setup.exe`。
- [x] 确认 Tauri 仍生成 `.exe` 与配对 `.exe.sig`。
- [x] 确认 R2 job 仍依赖 `publish`，且 R2 失败不会撤销 GitHub Release。

### 7.3 阶段退出条件

- [x] 事项状态建议和实际 live Project 差异已报告。
- [x] 文件 owner、现有改动和远程授权边界清楚。
- [x] 未发现需要扩大为 Authenticode、许可证或产品 UI 的新范围。

---

## 8. 阶段 1：强化安装包输入解析

### 8.1 把“找到一个”改为“证明恰好一个”

修改 `scripts/release.ts`：

- [x] 将 `findSignedInstaller()` 重构为可测试的候选解析逻辑与文件系统读取逻辑。
- [x] 递归扫描 bundle 目录后，收集全部以 `.exe.sig` 结尾的普通文件。
- [x] 使用稳定排序后再生成错误信息，避免目录枚举顺序导致测试和日志漂移。
- [x] 候选数为 `0` 时失败，并报告扫描根目录。
- [x] 候选数大于 `1` 时失败，并列出全部相对候选路径。
- [x] 候选数为 `1` 时，通过移除最后一个 `.sig` 后缀得到配对 `.exe` 路径。
- [x] 配对 `.exe` 不存在或不是普通文件时失败。
- [x] `.exe.sig` 内容为空白时失败。
- [x] 返回显式结构：`installerFilePath`、`signatureFilePath` 和经过 trim 的 `signature`；避免调用方再次用不同规则解析。

### 8.2 纯逻辑测试接口

为了避免单元测试依赖真实 Tauri 构建，至少导出一个纯函数，例如：

```ts
export function selectSignedInstallerCandidates(entries: string[]) {
  // 返回唯一 .exe/.exe.sig 配对，或返回可断言的错误结果。
}
```

具体函数名可以按现有 `release.ts` 风格调整，但必须满足：

- [x] 测试能直接输入 `string[]` fixture。
- [x] `0 / 1 / 2+` 个签名候选均有确定性结果。
- [x] Windows 路径分隔符不会进入最终公开文件名。
- [x] 错误消息不泄露 secret，只包含本地路径和候选文件。

### 8.3 反向场景

- [x] 无 `.exe.sig` 时测试失败。
- [x] 两个 `.exe.sig` 时测试失败，不能选第一个。
- [x] 签名存在但 `.exe` 缺失时集成 fixture 失败。
- [x] 空签名文件时集成 fixture 失败。
- [x] 恰好一对时返回正确配对。

### 8.4 阶段退出条件

- [x] 输入候选选择不再依赖 `.find()`。
- [x] 错误路径具备可操作信息。
- [x] 新增逻辑已有正向和歧义测试。

---

## 9. 阶段 2：生成最终安装包 SHA-256

### 9.1 流式计算摘要

修改 `scripts/release.ts`：

- [x] 从 `node:crypto` 使用 `createHash("sha256")`。
- [x] 从文件流分块更新摘要，不使用 `readFile()` 把完整安装包一次性载入内存。
- [x] 摘要输出固定为 64 位小写十六进制。
- [x] 流读取失败时保留明确文件路径并终止命令。
- [x] 将摘要计算封装为单一 helper，生成和验证共同使用同一算法入口。

建议接口：

```ts
async function sha256File(filePath: string): Promise<string>
```

### 9.2 生成公开校验文件

在 `prepareReleaseAssets()` 中：

- [x] 先完成最终安装包复制。
- [x] 从最终安装包路径重新读取并计算 SHA-256。
- [x] 使用纯函数渲染 `SHA256SUMS.txt` 内容。
- [x] 写入 `dist-release/SHA256SUMS.txt`，编码显式为 UTF-8。
- [x] 内容只使用 basename，不包含绝对路径或工作区路径。
- [x] 内容恰好一条记录和一个末尾换行。
- [x] 不把 `.sig`、`latest.json` 或 release notes 写入该文件。

建议纯函数：

```ts
export function renderSha256Sums(digest: string, fileName: string): string
```

### 9.3 输入与输出摘要对齐

- [x] 分别计算 Tauri 输入 `.exe` 与最终公开 `.exe` 的 SHA-256。
- [x] 两者不一致时立即失败。
- [x] `SHA256SUMS.txt` 只能使用最终公开 `.exe` 的实算摘要。
- [x] 不使用文件大小或修改时间替代摘要比较。

### 9.4 反向场景

- [x] 非 64 位摘要不能渲染为合法 checksum 行。
- [x] 非十六进制摘要被拒绝。
- [x] 包含 `/`、`\` 或绝对路径的公开文件名被拒绝。
- [x] 文件名版本漂移时失败。
- [x] 输入和输出字节不同时失败。
- [x] 生成文本中不得出现 BOM 或 CRLF 假设；测试断言精确字符串。

### 9.5 阶段退出条件

- [x] 最终文件而非原始 bundle 成为公开摘要对象。
- [x] 校验文件格式具有精确自动化断言。
- [x] 输入到输出的字节一致性有明确 gate。

---

## 10. 阶段 3：实现独立发布资产校验命令

### 10.1 新命令

在 `scripts/release.ts` CLI 增加：

```text
verify-release-assets <version> <bundle-dir> <output-dir> <repository> [target]
```

在 `package.json` 增加：

```json
"release:verify-assets": "node --experimental-strip-types scripts/release.ts verify-release-assets"
```

### 10.2 校验顺序

`verifyReleaseAssets()` 必须从磁盘重新读取，并按以下顺序失败：

1. 参数和版本格式。
2. 唯一 Tauri `.exe/.exe.sig` 配对。
3. 最终公开安装包存在性和文件名。
4. 输入安装包与最终安装包摘要一致性。
5. `SHA256SUMS.txt` 存在性、格式和唯一记录。
6. checksum 文件名与预期公开文件名一致。
7. checksum 摘要与最终安装包实算摘要一致。
8. `latest.json` 存在且为合法 JSON object。
9. `latest.json.version` 与目标版本一致。
10. `latest.json.platforms[target]` 存在。
11. updater `signature` 非空，且与选中 `.exe.sig` 的 trim 后文本一致。
12. updater URL 与固定 GitHub Release URL 完全一致。

预期 URL：

```text
https://github.com/<repository>/releases/download/v<version>/Patina_<version>_x64-setup.exe
```

### 10.3 checksum 解析器

建议导出纯函数：

```ts
export function parseSha256SumsText(content: string)
```

必须检查：

- [x] 拒绝 UTF-8 BOM。
- [x] 忽略最终单个空行，但拒绝多个非空记录。
- [x] 摘要只能是 64 位小写十六进制。
- [x] 分隔符必须是两个空格。
- [x] 文件名必须是安全 basename。
- [x] 文件名必须与当前版本期望值完全一致。

### 10.4 manifest 纯校验

建议导出可测试纯函数：

```ts
export function validatePreparedReleaseAssets(input): string[]
```

它应收集所有可确定的纯数据错误，便于一次显示多个漂移；文件读取失败仍可立即失败。执行者可按现有 `validateReleaseVersionFilesText()` 风格调整接口，但必须保证：

- [x] 单元测试不依赖网络。
- [x] 不验证私钥或尝试重新生成 Tauri 签名。
- [x] 不改变 `latest.json.pub_date` 的现有生成职责。
- [x] 错误消息指出字段、实际值和期望值。

### 10.5 命令帮助与退出码

- [x] 更新 `help()`，列出新命令和参数顺序。
- [x] 验证成功输出简洁摘要：版本、文件名和 SHA-256。
- [x] 验证失败使用非零退出码。
- [x] 成功日志不得输出 updater 私钥或完整 secret；`.sig` 是公开签名数据，但无需在日志全文打印。

### 10.6 阶段退出条件

- [x] 生成命令和验证命令职责独立。
- [x] 验证命令重新读取所有最终文件。
- [x] manifest、checksum、输入 bundle 和公开安装包形成闭合一致性检查。

---

## 11. 阶段 4：补齐自动化测试

### 11.1 测试归属

优先扩展 `tests/releasePolicy.test.ts`，保持 release 风险由既有 owner 承担。只有当文件因 fixture 和文件系统集成测试明显失去可读性时，才考虑新增 `tests/releaseAssets.test.ts`；新增文件前必须同步登记唯一 package script owner，避免违反 test governance。

### 11.2 纯函数测试

- [x] 公开安装包名称由稳定版本正确生成。
- [x] 预发布版本名称正确生成。
- [x] checksum 渲染精确匹配 `<digest>  <filename>\n`。
- [x] checksum parser 接受唯一合法记录。
- [x] parser 拒绝 BOM。
- [x] parser 拒绝大写摘要。
- [x] parser 拒绝摘要长度错误。
- [x] parser 拒绝一个空格、三个空格或 tab 分隔。
- [x] parser 拒绝多个非空记录。
- [x] parser 拒绝目录穿越和带路径文件名。
- [x] 候选解析拒绝零个和多个 `.exe.sig`。
- [x] manifest 校验拒绝版本、平台、URL、signature 漂移。

### 11.3 文件系统集成测试

使用测试专属临时目录构造小型字节 fixture，不构建真实 NSIS：

- [x] 测试创建的临时根目录来自系统临时目录，并记录其解析后的绝对路径。
- [x] 成功、失败和异常路径都在 `finally` 中清理。
- [x] 清理前验证目标仍位于测试专属根目录，不递归删除工作区或宽泛目录。
- [x] fixture `.exe` 使用任意小型二进制字节，不伪装真实可执行文件语义。
- [x] fixture `.exe.sig` 使用非空公开测试字符串。
- [x] 正向测试运行 prepare，再运行 verify。
- [x] 篡改最终 `.exe` 一个字节后 verify 失败。
- [x] 篡改 checksum 摘要后 verify 失败。
- [x] 篡改 checksum 文件名后 verify 失败。
- [x] 篡改 `latest.json` URL 后 verify 失败。
- [x] 篡改 `latest.json` signature 后 verify 失败。
- [x] 添加第二个签名候选后 verify 失败。

### 11.4 workflow 结构测试

更新 `testReleaseWorkflowDoesNotPublishBrowserExtensionAssets()`：

- [x] 断言公开 `.exe` 路径仍存在。
- [x] 断言 `dist-release/SHA256SUMS.txt` 同时出现在 workflow artifact 和 Release files 中。
- [x] 断言 `.exe.sig` 没有成为普通 Release asset。

更新 `testReleaseWorkflowSplitsQualityGatesBeforePublish()` 或拆出更聚焦测试：

- [x] 断言存在 `Verify release assets`。
- [x] 断言 verify 位于 prepare 之后、attest 之前、Release 发布之前。
- [x] 断言 `actions/attest@v4` 存在。
- [x] 断言 `subject-path` 精确指向最终公开 `.exe`。
- [x] 断言 `publish` job 具有 `contents: write`、`id-token: write` 和 `attestations: write`。
- [x] 断言其他 job 没有继承 `id-token: write` 或 `attestations: write`。
- [x] 断言 `r2` 仍为 `needs: [resolve, publish]`。
- [x] 断言 R2 上传集合没有新增 `SHA256SUMS.txt`。

不要只用一个跨整份 YAML 的宽泛正则证明权限隔离。必要时按 job 边界截取文本或引入已有依赖可承受的 YAML 解析；不得仅为该测试引入重量级运行时依赖。

### 11.5 阶段退出条件

- [x] 每个新增生产不变量至少有一个能杀死对应错误实现的测试。
- [x] 测试覆盖“应该失败”的真实风险，不只覆盖成功日志。
- [x] 所有新测试从 `npm run check` 或明确 release 专项入口可达，且不重复执行。

---

## 12. 阶段 5：接入 GitHub Artifact Attestation

### 12.1 workflow 权限

修改 `.github/workflows/prepare-release.yml`：

- [x] 把 workflow 顶层 `contents: write` 收紧为 `contents: read`。
- [x] 在 `publish` job 增加 job 级 `permissions`。
- [x] 仅 `publish` 获得 `contents: write`。
- [x] 仅 `publish` 获得 `id-token: write`。
- [x] 仅 `publish` 获得 `attestations: write`。
- [x] 按 action 当前要求决定是否加入 `artifact-metadata: write`，并由测试固定最终决定。
- [x] 不加入 `packages: write`、`actions: write` 或其他无关权限。

### 12.2 显式验证步骤

在 `Prepare release assets` 后加入：

```yaml
- name: Verify release assets
  shell: pwsh
  run: |
    $version = "${{ needs.resolve.outputs.version }}"
    npm run release:verify-assets -- $version src-tauri/target/release/bundle dist-release ${{ github.repository }} windows-x86_64
```

- [x] 参数顺序与 CLI help 一致。
- [x] 使用 workflow 已解析的版本，不重新从文件名猜测。
- [x] verify 失败时后续 attestation、artifact upload 和 Release publish 均不执行。

### 12.3 Attestation 步骤

紧接 verify 后加入：

```yaml
- name: Attest Windows installer
  uses: actions/attest@v4
  with:
    subject-path: dist-release/Patina_${{ needs.resolve.outputs.version }}_x64-setup.exe
```

- [x] `subject-path` 不使用 glob。
- [x] 不指向 Tauri bundle 原始目录。
- [x] 不把整个 `dist-release/**` 一次性声明为 subject。
- [x] 不把 `SHA256SUMS.txt` 当作安装包来源证明的 subject。
- [x] attestation 步骤位于正式 Release 发布之前。
- [x] action 版本与仓库现有 major-tag 更新风格一致；如果执行时仓库已采用 commit pinning，则遵循届时的统一规则。

### 12.4 为什么不使用 checksum 文件作为唯一 attestation 输入

本次只有一个明确的最终二进制，`subject-path` 可以让 workflow 直接对该文件计算摘要，减少 checksum parser 配置对 attestation 生成本身的影响。`SHA256SUMS.txt` 仍由独立 gate 验证，两条路径应对同一最终字节收敛，而不是让 attestation 只相信本项目刚生成的文本。

### 12.5 阶段退出条件

- [x] attestation 只绑定最终 `.exe`。
- [x] 最小权限只存在于 publish job。
- [x] attestation 失败可以阻断 GitHub Release。

---

## 13. 阶段 6：调整 GitHub Release 与发布说明

### 13.1 workflow artifact

在 `Upload release assets` 的 `path` 中加入：

```text
dist-release/SHA256SUMS.txt
```

- [x] `if-no-files-found: error` 保持不变。
- [x] `retention-days: 7` 保持不变，除非另有长期策略变更。
- [x] workflow artifact 中恰好携带供 R2/排障需要的 `.exe`、`SHA256SUMS.txt` 和 `latest.json`。

### 13.2 GitHub Release assets

在 `softprops/action-gh-release` 的 `files` 中加入：

```text
dist-release/SHA256SUMS.txt
```

- [x] `.exe`、checksum 和 `latest.json` 三个路径都使用精确路径。
- [x] 不使用 `dist-release/*`，防止未来临时文件意外公开。
- [x] 不发布 `.exe.sig`、release notes 临时文件或 R2 manifest。

### 13.3 Release 正文验证说明

修改 `renderReleaseNotes()` 的“下载”部分，不改 README：

- [x] 保留 Windows 安装包下载说明。
- [x] 增加 `SHA256SUMS.txt` 用途的一句话说明。
- [x] 提供 Windows PowerShell 复算命令。
- [x] 提供 GitHub CLI attestation 验证命令。
- [x] 命令使用 `<version>` 占位符或由 `renderReleaseNotes()` 注入实际版本；不得生成永远无法直接运行的混合形式。
- [x] 不声称校验能够阻止合法转售或证明软件绝对安全。

建议展示内容：

```powershell
Get-FileHash .\Patina_<version>_x64-setup.exe -Algorithm SHA256
gh attestation verify .\Patina_<version>_x64-setup.exe --repo Ceceliaee/patina
```

如果要约束 signer workflow，应先在首次真实发布中验证当前 GitHub CLI 接受的精确参数和 workflow identity，再固化到发布正文，避免文档先于可运行事实。

### 13.4 长期文档同步

更新 `docs/versioning-and-release-policy.md`：

- [x] 在附件命名规则中加入 `SHA256SUMS.txt`。
- [x] 明确 SHA-256 只覆盖最终公开 Windows 安装包。
- [x] 明确 Artifact Attestation 绑定最终公开安装包。
- [x] 把 `release:verify-assets` 加入远程发布资产 gate 说明。
- [x] 更新默认发布流程顺序。
- [x] 保留“默认不在本地手工生成正式安装包”的规则。
- [x] 保留 GitHub Release 为主发布事实、R2 为非阻塞镜像的规则。
- [x] 说明验证证明的边界，不写成泛化安全承诺。

### 13.5 阶段退出条件

- [x] 三个固定文件作为精确 Release assets 发布。
- [x] Release 正文提供可执行验证入口且不修改 README。
- [x] 长期规则与 workflow 现实一致。

---

## 14. 阶段 7：保持 R2 镜像边界

### 14.1 不改变的行为

- [x] `r2` 继续 `needs: [resolve, publish]`。
- [x] R2 secrets 不完整时继续安全跳过。
- [x] R2 继续生成指向 R2 安装包 URL 的专用 `latest.json`。
- [x] R2 继续只上传当前版本安装包与根路径 `latest.json`。
- [x] R2 同步失败不删除、覆盖或撤销已经完成的 GitHub Release。
- [x] R2 不上传 `SHA256SUMS.txt` 或 attestation bundle。

### 14.2 字节一致性的继承

R2 上传源仍是 `release-assets` workflow artifact 中通过 gate 的同一安装包。因此 GitHub Release 中 `SHA256SUMS.txt` 的摘要也应能验证从 R2 下载的安装包。

首次真实发布时执行一次远程抽查：

- [x] 从 GitHub Release 下载安装包并计算 SHA-256。
- [x] 如果 R2 已配置，从 R2 下载同版本安装包并计算 SHA-256。
- [x] 两者与 `SHA256SUMS.txt` 的摘要完全一致。
- [x] R2 未配置时记录为“安全跳过”，不视为主发布失败。

### 14.3 阶段退出条件

- [x] 新校验没有把 R2 提升为主发布依赖。
- [x] R2 上传源仍是已经通过 gate 的最终安装包。

---

## 15. 阶段 8：本地验证

### 15.1 快速专项验证

实现过程中先运行：

```powershell
npm run test:release
```

如果当前实际 script 名不同，以 `package.json` 登记的 `tests/releasePolicy.test.ts` 唯一 owner 为准，不新造重复入口。

- [x] release policy 测试通过。
- [x] 新增测试数量与结尾日志计数一致；如果测试仍手工打印数量，必须同步更新。
- [x] `npm run check:test-governance` 通过。
- [x] `npm run check:types` 通过，确认 `scripts/**/*.ts` 与 `tests/**/*.ts` 可解析和类型可检查。

### 15.2 fixture 级 prepare/verify

不得为了普通本地实现验证构建正式 NSIS。使用自动化测试 fixture 或显式临时目录：

- [x] prepare 生成预期三个文件。
- [x] verify 输出版本、文件名和摘要并返回 `0`。
- [x] 修改最终 `.exe` 后 verify 返回非零。
- [x] 恢复 `.exe`、修改 checksum 后 verify 返回非零。
- [x] 恢复 checksum、修改 manifest URL 后 verify 返回非零。
- [x] 临时目录在全部路径完成清理。

### 15.3 仓库最低门槛

运行：

```powershell
npm run check:full
```

- [x] `npm run check` 通过。
- [x] `npm run check:rust` 通过。
- [x] `npm run check:dependencies` 通过。
- [x] 没有为了使本任务通过而放宽 bundle、hotspot、coverage 或 dependency gate。

发布脚本和 workflow 变更还需要：

- [ ] 在具有真实目标版本的发布准备阶段执行 `npm run release:validate-version-files -- <version>`。
- [ ] 在具有真实目标版本的发布准备阶段执行 `npm run release:validate-changelog -- <version>`。
- [ ] 正式发布准备执行 `npm run release:check`。

如果当前只是实现功能、尚无目标发布版本，不要使用虚构版本修改 changelog 来满足最后三项；将它们保留给实际发布阶段。

### 15.4 diff 审查

- [x] `git diff --check` 通过。
- [x] 本事项的限定 diff 只包含本事项需要的文件；工作区中的其他改动保持不动。
- [x] 检查 Markdown、TypeScript 和 YAML 均为 UTF-8，无 BOM、mojibake 或意外编码改写。
- [x] workflow 的 job/step 缩进和表达式语法正确。
- [x] 没有修改 README、LICENSE、产品 UI 或 Tauri updater 公钥配置。

### 15.5 阶段退出条件

- [x] 专项反向测试和完整质量门槛均通过。
- [x] 未进行本地正式安装包构建，除非另有明确排障授权。
- [x] diff 范围与 Project item 一致。

---

## 16. 阶段 9：首次真实发布远程验收

本阶段只有在维护者明确授权版本准备、远程推送、tag 和正式发布后执行。普通实现授权不得解释为发布授权。

### 16.1 发布前

- [ ] 确认目标版本和对应 `v<version>` tag。
- [ ] 完成版本文件、changelog 和本地 `release:check`。
- [ ] 获得当前任务明确的远程 push 授权。
- [ ] 获得独立的 tag 创建/推送或发布授权。
- [ ] 确认 release workflow 从目标 tag 对应 commit checkout。

### 16.2 Actions job 验收

- [ ] `Prepare release assets` 成功。
- [ ] `Verify release assets` 成功，并在日志中显示目标版本、最终文件名和摘要。
- [ ] `Attest Windows installer` 成功。
- [ ] `Upload release assets` 成功。
- [ ] `Publish GitHub Release` 成功。
- [ ] 如果 attestation 失败，确认 Release 没有被后续步骤创建。
- [ ] R2 未配置时确认 job 安全跳过；已配置时确认同步独立发生。

### 16.3 GitHub Release 公开资产

- [ ] Release tag 是 `v<version>`。
- [ ] Release 标题是 `Patina v<version>`。
- [ ] 附件恰好包含预期的 Patina 主应用资产，没有浏览器扩展或临时文件。
- [ ] `Patina_<version>_x64-setup.exe` 存在。
- [ ] `SHA256SUMS.txt` 存在。
- [ ] `latest.json` 存在。
- [ ] checksum 文件名与安装包名完全一致。
- [ ] Release 正文包含验证方法。

### 16.4 下载后 SHA-256 验证

在新的临时目录下载 `.exe` 和 `SHA256SUMS.txt`，避免误用工作区产物：

```powershell
Get-FileHash .\Patina_<version>_x64-setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

- [ ] PowerShell 输出摘要与 checksum 文件一致，比较时忽略十六进制显示大小写差异。
- [ ] checksum 中没有路径前缀。
- [ ] 下载文件大小合理且非零。

### 16.5 Attestation 验证

在同一个临时目录执行：

```powershell
gh attestation verify .\Patina_<version>_x64-setup.exe --repo Ceceliaee/patina
```

- [ ] 命令成功。
- [ ] 输出 subject digest 与本地 SHA-256 一致。
- [ ] 输出来源仓库为 `Ceceliaee/patina`。
- [ ] 输出源码引用对应发布 tag 或其 commit。
- [ ] 输出 signer workflow 对应 `.github/workflows/prepare-release.yml`。

如需固化更严格命令，再验证以下约束在当前 CLI 版本可运行：

- [ ] `--signer-workflow`。
- [ ] `--source-ref`。
- [ ] `--source-digest`。

只有实际运行成功的约束才能写入长期文档或 Release 正文。

### 16.6 updater 与 R2 回归

- [ ] GitHub `latest.json` 的 URL 指向同一 Release 安装包。
- [ ] `latest.json` 的版本和平台键正确。
- [ ] 既有客户端仍能通过 Tauri `.sig` 验证更新；本事项不改变签名算法或公钥。
- [ ] R2 已配置时，R2 安装包摘要与 GitHub checksum 一致。
- [ ] R2 `latest.json` 仍指向 R2 URL，而不是错误复用 GitHub URL。

### 16.7 阶段退出条件

- [ ] 公开安装包同时通过 SHA-256 和 attestation 验证。
- [ ] updater 主链没有回归。
- [ ] R2 保持可选镜像语义。

---

## 17. 验收标准追踪矩阵

| 验收要求 | 实现位置 | 自动化证据 | 首次发布证据 |
| --- | --- | --- | --- |
| 最终公开安装包生成 SHA-256 | `scripts/release.ts` | checksum 精确字符串和 fixture 测试 | 下载后 `Get-FileHash` |
| checksum 作为 Release asset | workflow | YAML 结构测试 | Release 附件列表 |
| Attestation 绑定最终 `.exe` | workflow | step 顺序和 subject-path 测试 | `gh attestation verify` |
| 缺失安装包时阻断 | release script | 无候选 fixture | Actions 失败日志，仅在受控诊断时验证 |
| 多候选时阻断 | release script | 双候选 fixture | 不需要污染真实发布验证 |
| 文件名或版本漂移时阻断 | verifier | checksum/manifest 反向测试 | verify step 日志 |
| 输入与最终字节一致 | verifier | 篡改最终 `.exe` 测试 | checksum 与 attestation digest 收敛 |
| updater URL/signature 对齐 | verifier | manifest 反向测试 | 公开 `latest.json` 检查 |
| R2 不反向阻塞 GitHub Release | workflow/policy | dependency 结构测试 | R2 跳过或同步结果 |
| README 不变 | scope guard | git diff 审查 | 不适用 |

---

## 18. 失败处理、停止条件与补跑规则

### 18.1 本地实现失败

- [ ] 如果新增 helper 迫使 `scripts/release.ts` 变成跨领域通用模块，停止并重新判断 owner；不要移入 `shared/*`。
- [ ] 如果必须引入新的生产依赖才能完成 SHA-256，停止并优先使用 Node 标准库。
- [ ] 如果测试需要真实私钥，说明设计耦合过深；改用公开 fixture，不把 secret 引入测试。
- [ ] 如果发现用户已有改动与本事项重叠，停止覆盖并报告冲突。

### 18.2 workflow 失败

- [ ] `verify-release-assets` 失败：修复资产或脚本，不允许临时注释 gate。
- [ ] attestation 权限失败：检查 job permissions 和仓库能力，不允许改成 `write-all`。
- [ ] attestation action 平台故障：Release 尚未形成时保持失败；是否补跑由维护者决定。
- [ ] Release upload 失败：在原因确认后可对同一已有 tag 使用 `workflow_dispatch` 补跑。
- [ ] 不为补跑修改或强推已发布 tag。

### 18.3 已发布后发现问题

如果 GitHub Release 已经公开：

- [ ] 不原地覆盖已发布稳定版本的安装包。
- [ ] 不重写或强推 tag。
- [ ] 判断是否需要发布新的 patch 版本。
- [ ] 保留失败证据：workflow run、附件摘要、attestation 输出和发现时间。
- [ ] R2 问题不反向改写 GitHub Release；修复镜像或安全停用 R2。

### 18.4 回滚边界

本事项的代码回滚只能撤销未发布实现。已经形成公开发布事实后：

- checksum 和 attestation 是该版本事实的一部分；不能假装它们从未存在。
- 后续版本可以修正工作流，但不得删除历史证据来掩盖失败。
- 如果必须停用 attestation，应先更新长期发布规则并说明原因，不得静默跳过。

---

## 19. 文件级变更清单

预期修改：

- [x] `scripts/release.ts`
  - 唯一安装包配对选择。
  - 流式 SHA-256。
  - checksum 渲染和解析。
  - prepare 输出 checksum。
  - 独立 verify 命令。
- [x] `tests/releasePolicy.test.ts`
  - 纯函数、fixture 和 workflow 结构测试。
- [x] `package.json`
  - `release:verify-assets` 命令。
- [x] `.github/workflows/prepare-release.yml`
  - 最小权限、verify、attest 和 checksum asset。
- [x] `docs/versioning-and-release-policy.md`
  - 长期附件、校验、来源证明和流程规则。
- [x] `docs/archive/release-installer-integrity-and-provenance-execution-plan.md`
  - 执行中勾选和证据记录；完成后归档。

默认不应修改：

- [x] `README.md`
- [x] `README.zh-CN.md`
- [x] `LICENSE`
- [x] `src/**`
- [x] `src-tauri/src/**`
- [x] Tauri updater 公钥或签名密钥配置

如果实际实现需要修改默认不应修改的文件，先停止并向维护者展示范围变化，不静默继续。

---

## 20. 命令速查

### 20.1 实现期

```powershell
npm run test:release
npm run check:test-governance
npm run check:types
npm run check:full
git diff --check
git status --short
```

### 20.2 fixture 资产

```powershell
npm run release:prepare-assets -- <version> <bundle-dir> <output-dir> Ceceliaee/patina windows-x86_64
npm run release:verify-assets -- <version> <bundle-dir> <output-dir> Ceceliaee/patina windows-x86_64
```

预期成功输出至少包括：

```text
version=<version>
installer=Patina_<version>_x64-setup.exe
sha256=<64 位摘要>
```

具体日志格式可符合现有脚本风格，但必须稳定、简洁且不暴露 secret。

### 20.3 正式发布准备

```powershell
npm run release:validate-version-files -- <version>
npm run release:validate-changelog -- <version>
npm run release:check
```

### 20.4 发布后用户侧验证

```powershell
Get-FileHash .\Patina_<version>_x64-setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
gh attestation verify .\Patina_<version>_x64-setup.exe --repo Ceceliaee/patina
```

---

## 21. Project 状态、提交与归档

### 21.1 实现开始

- [x] 维护者把事项从实际当前状态拖到 `In progress`。
- [x] Codex 根据 live Project 手动顺序重新计算最多三个 `Next`，并一次性报告补位建议。

### 21.2 实现完成但未真实发布

本事项交付的是“此后每次正式发布都会自动生成并验证证明材料”的发布能力。工作流实现、自动 gate、权限、阻断语义、专项测试和完整验证通过后，事项可完成；实际创建 tag 或 Release 是另一个需要独立授权的远程动作。

- [x] 本地实现、完整验证和对抗式复审完成。
- [x] 未把实现授权扩大解释为 tag、GitHub Release、Project 状态写入或 push 授权。
- [x] 首次真实发布的下载复验保留为长期发布流程中的运行检查，不据此把当前事项标记为 `Blocked`。

### 21.3 全部完成

- [x] 自动化实现的本地验收全部通过。
- [x] 告诉维护者把事项从实际状态拖到 `Done`。
- [x] 重新计算并报告 `Next` 补位建议。
- [x] 不自动关闭、重开或修改任何 GitHub Issue。
- [x] 只有用户明确要求时才创建本地提交。
- [x] 只有用户在当前任务明确要求推到远端时才执行 push。

### 21.4 文档归档

当本文不再是活动执行依据：

- [x] 确认长期规则已经写入 `docs/versioning-and-release-policy.md`。
- [x] 将本文从 `docs/working/` 移到 `docs/archive/`。
- [x] 归档后不再把本文作为默认发布规则来源。
- [ ] 正式发布并将变化写入 changelog 后，再按 Project 长期规则处理已完成 draft item 的清理；该远程动作需要对应授权。

---

## 22. 最终签收清单

以下清单区分本次自动化实现验收与下一次真实发布的运行验收：

- [x] 最终 `.exe` 名称、版本、输入摘要和输出摘要一致。
- [x] `SHA256SUMS.txt` 格式精确且可由下载者复算。
- [x] 独立 release asset gate 能发现篡改、歧义和 manifest 漂移。
- [x] Attestation 对最终公开 `.exe` 生成，且失败会阻断 Release。
- [x] GitHub Release 只发布精确允许的三个资产。
- [x] Release 正文提供验证方法，README 未修改。
- [x] Tauri updater 签名与 `latest.json` 生成逻辑保持兼容。
- [x] R2 仍是可选、非阻塞镜像。
- [x] 专项测试与 `npm run check:full` 通过。
- [ ] 下一次真实发布的 SHA-256 与 attestation 远程验证通过（等待未来独立发布授权）。
- [x] 长期发布文档同步完成。
- [x] live Project 状态建议已报告；状态拖拽仍由维护者手动处理。
- [x] 本计划已归档。
