# Patina 工具链升级与 pnpm 迁移执行方案

创建日期：2026-09-11。归档日期：2026-09-11。文档状态：本地实施与验收完成；原生 ARM64、远端 CI 及签名安装更新验收已转交后续发布执行者，未声明通过。

Related: [Ceceliaee/patina#56](https://github.com/Ceceliaee/patina/issues/56)。

## 1. 从问题和结果出发

依赖管理的任务是把明确的软件包版本可靠地变成可构建、可运行的本地依赖图。版本选择、仓库可用性、安装布局、编译耗时和应用分发分别属于不同环节，不能用一次工具替换来解释全部收益。

本项交付两个可以分别验证的结果：先将 JS/TS 依赖管理从 npm 客户端迁移到 pnpm，保持已有功能和检查；再将 Node 与相关依赖升级到实施时核查并冻结的最新兼容稳定组合。两阶段分开，才能判断失败和性能变化来自管理器还是依赖版本。

| 需要解决的事实 | 所属环节 | 本次处理方式 |
| --- | --- | --- |
| 多个安装目录可能重复存储依赖文件 | 包管理器与文件系统 | 使用 pnpm，测量共享存储及项目新增占用 |
| 部分版本落后于稳定发行版 | 工具链和依赖选择 | 按支持范围、peerDependencies、风险及验证选择组合 |
| 脚本、CI 和发布工具依赖 npm 行为 | 仓库工程入口 | 迁移真实调用和解析逻辑，保留原有失败保护 |
| npm 仓库尚未提供某个新版本 | 远端仓库 | 保持现有仓库；不将其延迟归因于客户端 |
| Rust target 占用大量空间 | Cargo 编译产物 | 单独计量，本次不清理或调整 Rust 编译缓存 |
| 用户下载和升级桌面程序 | Windows 发布链 | 保持安装包、更新通道和发布校验契约 |

成功标准是新环境可以从锁文件完成安装，所有适用的验证仍能发现原来的失败，开发及发行产物正常，并能如实解释时间和空间变化。安装变快不是未经测量即可认定的事实；即使没有明显提速，也应记录维护收益和额外成本。

## 2. 范围、约束和依据

### 2.1 实施范围

- Node LTS、pnpm、JS/TS 直接依赖及因升级必要变化的传递依赖。
- 包管理器声明、JS 锁文件、安装策略、脚本调用、审计、测试治理、PR 准入、CI、Tauri 前端构建钩子和发布版本校验。
- 安装、开发、验证和发布说明中的有效命令与契约。
- Windows x64、ARM64 受影响的安装依赖、构建、打包和运行时验证。

### 2.2 受保护边界

- pnpm 继续消费 npm 官方仓库中的包，不部署仓库服务，不切换镜像或包发布平台。
- Rust 依赖仍由 Cargo 管理；不进行整库 Rust 依赖升级。若 Tauri JS 更新确实要求 Rust 配套变更，先证明版本约束并按发布风险重新划定最小范围。
- 不扩展产品平台，不改变追踪、持久化、恢复、隐私、UI 或现有安装更新语义。
- 不修改其他项目、系统默认 Node/包管理器和永久代理配置。
- 不用删测试、调高预算、放宽 peer 约束或关闭审计来使迁移通过。
- 不自动提交、推送、创建分支、打 tag、发布或修改 Issue；外部动作沿用各自的当前任务授权。

### 2.3 长期规则入口

产品与优先级遵循 [产品范围](../product-principles-and-scope.md) 和 [路线图](../roadmap-and-prioritization.md)；实现落点遵循 [架构](../architecture.md)；本次采用 [执行单模式](../issue-fix-boundary-guardrails.md)。验证和文档契约由 [工程质量](../engineering-quality.md) 拥有，版本、双架构资产及更新验证由 [发布规范](../versioning-and-release-policy.md) 拥有。

实施时依 [Project 维护规则](../github-project-maintenance.md) 读取实时队列；本文不保存其正文、字段或排序。配置和脚本拥有机器事实，下面的文件表是迁移调查入口，不是永久命令清单。

## 3. 当前仓库事实与影响面

编写时读取到 Node 24.18.0、npm 11.16.0；以下只是调查快照，实施前须重读。候选版本不沿用聊天里的 latest 结果，必须在实施当天核查。

| 现有入口 | 已发现的耦合 | 必须保住的行为 |
| --- | --- | --- |
| `package.json`、`.node-version` | engines、devEngines、allowScripts 和嵌套 npm 命令 | 明确工具版本、依赖脚本权限、检查顺序和退出码 |
| `package-lock.json` | npm 依赖图及根应用版本副本 | 依赖解析可审阅、冻结安装、完整性信息 |
| `src-tauri/tauri.conf.json`、`scripts/tauri-cli.ts` | beforeDevCommand、beforeBuildCommand 和 CLI 定位 | dev profile 隔离、参数传递、正式构建入口 |
| `scripts/check-test-suite-governance.ts` | 解析 npm run/test 调用图 | 孤儿、重复、缺失入口及测试分层检查 |
| `scripts/check-pr-intake.ts`、`scripts/pr-intake-policy.ts` | npm 命令解析、锁文件分类、Validation 文案 | 可信 base 准入、风险分类和新增测试可达性 |
| `scripts/audit-dependencies.ts`、`scripts/npm-audit.ts` | npm_execpath、npm audit 参数和 JSON 判断 | 漏洞失败、网络错误区分、有界重试及离线边界 |
| `scripts/release.ts`、`tests/releasePolicy.test.ts` | 直接读取和同步 package-lock.json 版本 | 真实版本来源一致、资产校验和现有发布恢复流程 |
| `.github/workflows/verify.yml`、`prepare-release.yml` | npm 安装、缓存、复合命令和参数分隔 | 独立质量任务、双架构、受控发布和完整性证据 |
| `tests/tauriRuntimeSmoke.test.ts` 等运行时测试 | 直接调用 Node/CLI、专用 target 与 profile | 真实二进制、IPC、权限、数据库和进程清理 |
| `README.md`、`CONTRIBUTING.md`、有效 docs 与 PR 模板 | 安装、检查、贡献和发布命令 | 文档与机器入口一致，历史记录不被重写 |

## 4. 阶段 A：建立可恢复、可比较的基线

- [x] A1. 读取当前 Git HEAD、`git status --short` 和相关 diff，记录本任务外的未提交改动。重点复核发布脚本、发布测试及发布说明的并行变化；发生重叠时基于最新内容制作最小补丁，不覆盖他人工作。
- [x] A2. 重新读取清单、锁文件、Node/Rust 版本和 CI。记录实际 Node、npm、Cargo、rustc 版本与 Windows 架构；核对命令退出码。
- [x] A3. 建立任务专用临时目录，保存清单和锁文件哈希、版本表、命令日志与测量结果；不复制用户数据、凭据和共享缓存，不提交这些诊断产物。
- [x] A4. 联网前检查 npm/pnpm/Git 的现有代理、代理环境变量及 Windows 系统代理；沿用有效设置，必要时只为当前进程配置。日志不得包含认证信息，PAC URL 不当成代理地址。
- [x] A5. 在无旧 node_modules 的临时副本完成 `npm ci` 和基线检查，记录已存在的失败。隔离副本只带实际源码与配置，不复制 `.git`、Rust target、构建输出或本机 secrets；实际输入以哈希清单标识。
- [x] A6. 记录基线 JS 依赖的名称、解析版本、依赖类型、peer 关系、optional 架构包、override 和完整性信息；后续比较语义图，不逐行比较两种锁文件格式。
- [x] A7. 完成第 10 节的 npm 冷安装、热缓存安装及存储基线。已有整目录大小只能作为背景，不代替受控对照实验。

阶段出口：已知当前输入和已有失败，具备恢复清单及可比较的 npm 结果。基线失败先归因；与迁移无关的缺口单列，不伪称通过。

## 5. 阶段 B：选择并冻结工具组合

- [x] B1. 为 Node、pnpm、React/React DOM、TypeScript、Vite/plugin-react、ESLint/typescript-eslint、Tauri JS 工具及其余直接依赖建立候选表，逐项填写当前版本、候选版本、官方来源、查询日期、engines、peerDependencies、变更风险和结论。
- [x] B2. Node 选择受支持的 LTS；pnpm 选择与当前或候选 Node 兼容的正式版本。固定精确 pnpm 版本，先确认其在 Windows x64/ARM64 的安装方式和执行形式，不假定入口一定是 JavaScript 文件。
- [x] B3. 包管理迁移阶段尽量保持当前 Node 与依赖版本。如候选 pnpm 必须升级 Node，先独立验证 Node 的最小必要升级并另记结果，避免把其影响记入管理器收益。
- [x] B4. 核对 React 与 React DOM 配套、TypeScript 与 typescript-eslint 支持交集、Vite 与插件/Node 要求、Tauri JS 与现有 Rust API 的兼容性。latest 标签不是兼容性证明。
- [x] B5. 读取各跨主版本迁移说明；列出确实需要的配置或调用适配。若要求大范围业务重写，先保留受支持版本并记录原因，再单独评估扩展范围。
- [x] B6. 冻结候选，不在验证过程中自动追随新发布的 latest。新发现的安全修复重新走候选核查，不使用无界批量升级或强制 audit fix。
- [x] B7. 为每个暂缓版本记录具体阻碍及重新评估条件；不把“尚未验证”写成“不兼容”。

候选核查与最终选择：

| 包或工具 | 当前解析版本 | 候选精确版本 | 官方来源与日期 | 支持交集/风险 | 采用或暂缓原因 |
| --- | --- | --- | --- | --- | --- |
| @tailwindcss/vite | 4.2.2 | 4.3.3 | [官方 registry 元数据](https://registry.npmjs.org/@tailwindcss/vite/4.3.3)；2026-09-11 | vite: ^5.2.0 \|\| ^6 \|\| ^7 \|\| ^8 | 采用 4.3.3 |
| @tauri-apps/api | 2.11.1 | 2.11.1 | [官方 registry 元数据](https://registry.npmjs.org/@tauri-apps/api/2.11.1)；2026-09-11 | 核对 engines、现有调用和分组检查 | 保持 2.11.1 |
| @tauri-apps/plugin-opener | 2.5.3 | 2.5.5 | [官方 registry 元数据](https://registry.npmjs.org/@tauri-apps/plugin-opener/2.5.5)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 2.5.5 |
| @tauri-apps/plugin-sql | 2.3.2 | 2.4.1 | [官方 registry 元数据](https://registry.npmjs.org/@tauri-apps/plugin-sql/2.4.1)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 2.4.1 |
| esbuild | 0.28.1 | 0.28.2 | [官方 registry 元数据](https://registry.npmjs.org/esbuild/0.28.2)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 0.28.2 |
| lucide-react | 1.7.0 | 1.43.0 | [官方 registry 元数据](https://registry.npmjs.org/lucide-react/1.43.0)；2026-09-11 | react: ^16.5.1 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0 | 保留 1.7.0；1.43.0 导致共享块预算失败；1.44.0 冻结时未满 24 小时 |
| react | 19.2.4 | 19.3.0 | [官方 registry 元数据](https://registry.npmjs.org/react/19.3.0)；2026-09-11 | 核对 engines、现有调用和分组检查 | 保持 19.2.4；19.3 组合的 vendor 为 63.64 KiB，超过现有预算 |
| react-dom | 19.2.4 | 19.3.0 | [官方 registry 元数据](https://registry.npmjs.org/react-dom/19.3.0)；2026-09-11 | react: ^19.3.0 | 保持 19.2.4；19.3 组合的 vendor 为 63.64 KiB，超过现有预算 |
| tailwindcss | 4.2.2 | 4.3.3 | [官方 registry 元数据](https://registry.npmjs.org/tailwindcss/4.3.3)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 4.3.3 |
| @eslint/js | 10.0.1 | 10.0.1 | [官方 registry 元数据](https://registry.npmjs.org/@eslint/js/10.0.1)；2026-09-11 | eslint: ^10.0.0 | 保持 10.0.1 |
| @tauri-apps/cli | 2.10.1 | 2.11.4 | [官方 registry 元数据](https://registry.npmjs.org/@tauri-apps/cli/2.11.4)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 2.11.4 |
| @types/node | 24.13.3 | 24.13.4 | [官方 registry 元数据](https://registry.npmjs.org/@types/node/24.13.4)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 24.13.4 |
| @types/react | 19.2.14 | 19.3.0 | [官方 registry 元数据](https://registry.npmjs.org/@types/react/19.3.0)；2026-09-11 | 核对 engines、现有调用和分组检查 | 保持 19.2.14；19.3 组合的 vendor 为 63.64 KiB，超过现有预算 |
| @types/react-dom | 19.2.3 | 19.3.0 | [官方 registry 元数据](https://registry.npmjs.org/@types/react-dom/19.3.0)；2026-09-11 | @types/react: ^19.3.0 | 保持 19.2.3；19.3 组合的 vendor 为 63.64 KiB，超过现有预算 |
| @vitejs/plugin-react | 6.0.3 | 6.1.1 | [官方 registry 元数据](https://registry.npmjs.org/@vitejs/plugin-react/6.1.1)；2026-09-11 | vite: ^8.0.0 | 采用 6.1.1 |
| c8 | 11.0.0 | 12.0.0 | [官方 registry 元数据](https://registry.npmjs.org/c8/12.0.0)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 12.0.0 |
| eslint | 10.8.0 | 10.10.0 | [官方 registry 元数据](https://registry.npmjs.org/eslint/10.10.0)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 10.10.0 |
| eslint-plugin-react-hooks | 7.1.1 | 7.1.1 | [官方 registry 元数据](https://registry.npmjs.org/eslint-plugin-react-hooks/7.1.1)；2026-09-11 | eslint: ^3.0.0 \|\| ^4.0.0 \|\| ^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0-0 \|\| ^9.0.0 \|\| ^10.0.0 | 保持 7.1.1 |
| exceljs | 4.4.0 | 4.4.0 | [官方 registry 元数据](https://registry.npmjs.org/exceljs/4.4.0)；2026-09-11 | 核对 engines、现有调用和分组检查 | 保持 4.4.0 |
| saxes | 6.0.0 | 6.0.0 | [官方 registry 元数据](https://registry.npmjs.org/saxes/6.0.0)；2026-09-11 | 核对 engines、现有调用和分组检查 | 保持 6.0.0 |
| typescript | 5.8.3 | 6.0.3 | [官方 registry 元数据](https://registry.npmjs.org/typescript/6.0.3)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 6.0.3；7.0.2 超出 lint 工具的 <6.1 支持范围 |
| typescript-eslint | 8.64.0 | 8.70.0 | [官方 registry 元数据](https://registry.npmjs.org/typescript-eslint/8.70.0)；2026-09-11 | eslint: ^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0；typescript: >=4.8.4 <6.1.0 | 采用 8.70.0 |
| vite | 8.1.4 | 8.2.2 | [官方 registry 元数据](https://registry.npmjs.org/vite/8.2.2)；2026-09-11 | 核对 engines、现有调用和分组检查 | 保留 8.1.4；8.2.2 分块变化未通过现有体积门禁；8.3.0 冻结时未满 24 小时 |
| pnpm | 原管理器 npm 11.16.0 | 12.3.4 | [官方 registry 元数据](https://registry.npmjs.org/pnpm/12.3.4)；2026-09-11 | 核对 engines、现有调用和分组检查 | 采用 12.3.4 |
| Node LTS | 24.18.0 | 24.21.0 | [Node 发行](https://nodejs.org/dist/v24.21.0/)；2026-09-11 | 24.x LTS；Windows x64 ZIP 校验 SHA-256 | 已采用 |

## 6. 阶段 C：只迁移包管理器

### 6.1 清单、锁文件与安装策略

- [x] C1. 保持 `.node-version` 为构建 Node 的唯一选择来源，更新受测试的 engines 镜像；在 `package.json#packageManager` 固定 pnpm，处理原有 npm devEngines 约束，避免新旧检查相互拒绝。
- [x] C2. 按所选 pnpm 主版本的官方 schema 放置非认证安装设置，建立所需的 `pnpm-workspace.yaml`；只声明当前单应用，不提前拆成多包仓库。
- [x] C3. 优先验证默认依赖隔离布局。失败时查明是缺失直接依赖、硬编码路径还是工具不支持链接；先修正真实声明，只有明确兼容需要才采用 hoisted，并记录依据。
- [x] C4. 将现有 override 与 esbuild 安装脚本许可迁入有效配置。保留最小许可，验证被允许脚本实际执行、未许可脚本被阻止；核查所选版本的发布时间冷却策略，不为安装方便全局绕过。
- [x] C5. 保留 npm 锁文件的基线副本，在任务副本执行 `pnpm import` 生成 pnpm 锁文件。对照 A6 核查解析图；区分格式、peer 表达和平台过滤差异与真实版本变化。
- [x] C6. 解释每个导入后的真实解析变化，必要时固定版本重新导入。若不能保留等价图，先记录偏差；不得把含升级的结果当成纯管理器对照。
- [x] C7. 在干净副本执行 `pnpm install --frozen-lockfile`，核对清单和锁文件哈希未被改写。验证 x64、ARM64 所需原生 optional 包没有因当前机器过滤而漏锁。
- [x] C8. 增加或调整现有工具链检查：正确环境通过，错误 Node/pnpm、缺失或过期锁文件明确失败。检查安装前可用的内置能力，不让前置检查依赖尚未安装的库。
- [x] C9. 完成后续消费者迁移后，删除受维护的 `package-lock.json`，仅保留一份有效 JS 锁文件。不要删除 `Cargo.lock`，也不要在 pnpm 锁文件虚构应用版本字段。

### 6.2 命令调用与测试图

- [x] C10. 迁移 `package.json` 中嵌套调用，统一显式 `pnpm run <script>`；保留 coverage 包装、命令顺序、参数和失败传播，不将迁移变成测试并行化重构。
- [x] C11. 搜索有效代码、配置、测试和 CI 中的 npm/npx、npm_execpath、npm.cmd、package-lock 依赖，逐条分类处理。仓库 URL、协议名称和历史档案不机械替换。
- [x] C12. 调整测试治理脚本对 pnpm 命令的解析，验证嵌套 run、test 简写、Windows 入口、coverage 包装和参数分隔。用反例证明孤儿测试、重复执行、缺失脚本和 browser/runtime 混层仍会失败。
- [x] C13. 同步 PR 准入的生成锁文件分类、命令图解析和模板。保留从可信 base 执行、不安装或运行未审查 PR 代码的边界；验证锁文件不占手工代码行数预算，既有验证链不得减少。
- [x] C14. 不默认建立多包管理器兼容层。若迁移期间确有仍受支持的旧格式输入，限定在入口解析处并写明退出条件；真实执行路径只保留一种。
- [x] C15. 迁移 Tauri beforeDevCommand/beforeBuildCommand；验证 CLI 定位与参数传递不依赖旧 node_modules 扁平路径，避免从网络临时下载另一个 Tauri CLI。
- [x] C16. 验证开发启动采用现有隔离 profile，生产构建采用正式配置；运行时测试使用自己的数据库和进程，不能触碰日常 Patina 数据。

### 6.3 依赖审计

- [x] C17. 实测所选 pnpm 的 audit JSON、退出码和支持参数。不要把 `npm_execpath` 直接交给 Node 执行，也不要将 npm 专用 fetch/offline 参数无条件复制过去。
- [x] C18. 在现有审计 owner 内完成实现替换，必要时按新职责改名并更新消费者；保持 low 及以上漏洞门槛、超时上限和 Rust target 可达性例外校验。
- [x] C19. 补充真实格式 fixture 或受控子进程测试，覆盖无漏洞、漏洞、服务错误、认证失败、无效 JSON、超时和执行失败。退出码为零但报告损坏不得直接宣称审计通过。
- [x] C20. 仅对已识别瞬时网络错误执行有界重试；漏洞和权限错误不重试掩盖。离线入口保留工程质量要求的本地证据；若 pnpm 不支持等价离线审计，明确失败或提供可验证的本地报告校验，不静默跳过，也不代替发布联网审计。

### 6.4 发布脚本与版本一致性

- [x] C21. 重新阅读当前 `scripts/release.ts`、对应测试及发布规范，基于并行工作完成后的实际契约实施，不恢复已经退出的旧发布行为。
- [x] C22. 移除对 npm 锁文件根版本的读取和同步；核对 pnpm 锁文件真实结构。应用版本继续从清单、Tauri、Cargo、tag、Release 和更新资产的真实来源校验，不新增无意义版本副本。
- [x] C23. 在临时 fixture 中验证版本同步、有效/无效 SemVer、版本不一致、锁文件缺失及现有测试版发布恢复路径。不得在正式项目中试写发布版本或触发真实发布。
- [x] C24. 核查只生成发布资产的 job 是否新增了 YAML 库等运行依赖；若新增，应明确安装所需依赖，否则保持该入口可按现有方式执行。
- [x] C25. 运行本阶段受影响的脚本、审计、发布和运行时专项；阶段 D 同步完 CI 与文档后，再完成迁移组合的完整验证，才进入依赖升级阶段。

## 7. 阶段 D：迁移 CI 和有效文档

- [x] D1. 枚举 Verify、发布、PR intake 及其他实际工作流中使用 Node/包管理器的 job；每个 job 独立配置所需环境。
- [x] D2. 在缓存初始化之前准备锁定的 pnpm，确认所选 setup Action 的顺序与 Node 来源。Action 固定官方发行对应的完整 SHA，注释遵循仓库规范。
- [x] D3. 安装统一为冻结锁文件方式；缓存指向 pnpm 存储，按锁文件、系统和架构等实际兼容输入区分，不缓存可漂移的 node_modules 来替代安装。
- [ ] D4. 原生 ARM64 启动待验证，已转交下一次发布执行者在 `windows-11-arm` 的 Verify 与 Prepare Release 中补齐。当前 x64 启动及双架构锁条目已验证，保留原生 Rust host 与独立 runtime smoke job；静态核查不等于 ARM64 运行通过。
- [x] D5. 核查 `--` 参数实际到达 Tauri、发布资产准备及验证脚本；用受控输入验证错误参数和子进程失败能使 job 失败。
- [x] D6. 保留发布触发、权限、凭据来源、签名、哈希、来源证明及更新架构选择；不为 CI 验证触发对外发布。
- [x] D7. 按真实变更更新 README、CONTRIBUTING 中英两部分、PR 模板及长期 owner 中的有效命令。仅修正发生变化的事实；历史执行记录保留当时命令。
- [x] D8. 同步发布规范中的版本来源及工程质量中的工具版本 owner/验证入口，使 prose 与脚本一致；不建立第二份完整脚本清单。
- [x] D9. 运行文档检查；若涉及检查器或治理规则，追加其自测和受影响反例。复核链接、UTF-8、代码块及原有义务未丢失。随后按第 9 节完成迁移组合的本地完整验证，远端或设备缺口单列。

## 8. 阶段 E：分组升级稳定依赖

- [x] E1. 先保存迁移通过的输入哈希和有效证据，作为本阶段回退点。
- [x] E2. 升级 Node LTS（如尚未升级），独立核查内置 TypeScript 执行、子进程、环境变量和 Windows CLI 行为。
- [x] E3. 升级 TypeScript、ESLint、typescript-eslint 和相应类型声明这一兼容组，先跑类型、lint、脚本自测；编译成功不代替类型 API 兼容检查。
- [x] E4. 升级 Vite、React 插件及必要构建依赖，检查配置 API、开发启动、生产构建、原生可选包及 bundle 预算。
- [x] E5. 配套升级 React/React DOM 和类型声明，执行 model、SSR、browser 及代表性页面交互，检查警告、卸载和异步更新行为。
- [x] E6. 升级 Tauri JS API/CLI 和其他直接依赖，按真实使用点分组。对导出、日期、网络、压缩等依赖追加相应专项；需 Rust 配套变更时先按第 2 节重新判断。
- [x] E7. 每组审阅清单、锁文件、peer 和 override 变化，确认所有新增包及安装脚本来源。不要用全局放宽规则解决单包问题。
- [x] E8. 每组完成对应验证后再继续；失败定位到组内最小变量。最终冻结输入后完成第 9 节验收，避免把跨多个输入的零散成功拼成一次完整通过。

## 9. 验收矩阵与执行顺序

下列 pnpm 命令是完成入口迁移后的目标形式；执行前以当时 `package.json` 核对名称。按顺序运行共享输出相关的构建、browser 和 runtime 检查，不同时争用 dist、target 或同一 profile。

| 顺序 | 命令/操作 | 证明的事实 |
| --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 干净环境可以安装已冻结输入 |
| 2 | `pnpm run check:test-governance:self-test`、`pnpm run test:pr-intake`、`pnpm run test:dependency-audit`、`pnpm run test:release` | 迁移特有失败路径仍有保护 |
| 3 | `pnpm run check:full` | 默认前端、Rust 与依赖审计门槛完整通过 |
| 4 | `pnpm run test:tauri-runtime-smoke` | 真实 Tauri、WebView2、IPC、权限和落盘行为 |
| 5 | `pnpm run release:validate-version-files <version>`、`pnpm run release:validate-changelog` | 发布输入契约未因锁文件迁移丢失 |
| 6 | 按发布规范构建 x64/ARM64 安装包并验证资产 | 两种架构的产物、名称、签名和校验链 |
| 7 | 在隔离环境按发布规范验证安装和更新 | 实际分发边界未回归 |

- [x] F1. 保存最终源码/配置/锁文件哈希、环境、命令、退出码、日志位置及安装计时；前端和 Rust 的可比计时取消，详见 M5。复用输入未变且风险匹配的有效证据，补跑变更影响的检查。
- [x] F2. 在无旧依赖和输出的隔离副本完成最终冻结安装；不能仅凭日常目录热缓存验证可重建性。
- [x] F3. 运行上表适用检查；远端双架构和发布级验证需具备相应授权及环境。交叉编译成功不冒充 ARM64 原生运行成功。
- [x] F4. 原生 ARM64、远端 CI、双架构签名安装包及实际升级验收待验证。由下一次获授权的发布执行者依发布规范补齐；本地 x64 runtime 和发布 fixture 不证明这些分发边界。
- [ ] F5. 不适用：本任务没有推送授权，未执行推送或远端 CI；下一次获授权推送时由执行者验证实际提交。
- [x] F6. 审阅最终 diff，确认测试覆盖、检查路径、失败退出码和发布保证均未减少；缺少支持依据的版本退回最后通过组合。

## 10. 安装速度和存储对比方法

### 10.1 对照组

| 组 | 工具与依赖 | 用途 |
| --- | --- | --- |
| A | 当前 npm + 当前锁定依赖 | 原始基线 |
| B | 固定 pnpm + 尽量相同的依赖图 | 分离包管理器影响 |
| C | 固定 pnpm + 升级后的依赖图 | 最终开发环境成本 |

- [x] M1. 三组采用同一设备、磁盘卷、网络/代理和安全软件设置，记录 Node 差异。避免同时下载或编译；无法相同的条件明确列为限制。
- [x] M2. 每组冷安装采用独立空缓存/存储和无 node_modules 的任务副本；npm 使用任务级 cache，pnpm 使用所选版本支持的任务级存储/缓存配置。核实日志确实没有借用全局数据，不清空用户共享缓存。
- [x] M3. 每组热缓存安装保留该组缓存，仅在新的干净副本重装。区分“热缓存重新安装”和“已有 node_modules 无变化检查”，后者不能与 npm ci 混比。
- [x] M4. 每种条件测量至少三次以观察波动，记录每次值、范围和中位数。性能重复采样不等于失败测试自动重跑；安装失败单列原因，不从结果中无声剔除。
- [ ] M5. 部分完成：安装使用墙钟计时，安装脚本许可等价，工具准备和审计不混入计时。未建立前端与 Rust 的受控计时，取消这两项性能比较，保留正确性验证证据。

### 10.2 空间口径

- [x] M6. 报告 node_modules 逻辑字节数、缓存/存储规模、联合分配空间和第二份安装增量。同盘硬链接已由文件身份确认；首次安装前后差值未单独取样，不作该项声明。
- [x] M7. 统计存储和安装目录联合占用时，按卷与文件身份去重；采用能报告分配空间的 Windows API，并注明文件系统元数据等未计量部分。不能将目录属性合计直接当成物理磁盘增量。
- [ ] M8. 部分完成：另列全局共享存储当前逻辑总量；缺少安装前快照，取消增量归因。共享收益由任务隔离 store 下第二份安装的实测证明。
- [x] M9. Rust target、临时测试目录、Git 和应用安装包单独列出。此前生成的目录大小记录仅为背景：不包含完整受控安装时间，也不能用于推断迁移节省的物理空间。
- [x] M10. 为本次测量保存可重跑的任务脚本、统计口径和输入哈希；脚本留在诊断产物目录，不把个人磁盘路径或共享存储内容写进仓库。

结果表在实际测量后填写：

| 指标 | A：npm 基线 | B：pnpm 等价图 | C：pnpm 升级图 | 限制或解释 |
| --- | --- | --- | --- | --- |
| 冷安装中位耗时 | 13.591 秒 | 21.774 秒 | 21.877 秒 | 空缓存；包含获准的生命周期脚本，审计另跑 |
| 热缓存重装中位耗时 | 7.638 秒 | 5.906 秒 | 4.961 秒 | 新副本、已有缓存；不含已有目录无变化检查 |
| node_modules 逻辑大小 | 207,570,461 B | 205,629,564 B | 220,952,736 B | 不直接代表实际占用 |
| 缓存/存储与项目联合去重占用 | 279,354,904 B | 330,731,744 B | 345,976,904 B | 包含下载缓存、元数据和 store；在首次热重装后取样 |
| 同缓存第二份项目新增分配空间 | 226,516,504 B | 1,499,136 B | 1,519,616 B | 同卷文件身份去重，实测共享文件分别为 0、11,839、11,928 个 |
| 首次安装新增占用 | 未单独取样 | 未单独取样 | 未单独取样 | 不把热重装后联合占用冒充首次安装前后差值 |
| 前端检查与 Rust 验证耗时 | 未建立可比计时 | 未建立可比计时 | 未建立可比计时 | 保留验证日志，取消性能比较，不宣称编译提速 |

18 次安装全部成功，冻结输入未改写。冷安装三次值分别为 A：10.968、13.591、14.095 秒；B：24.219、21.774、21.431 秒；C：18.870、21.877、26.091 秒。热缓存重装分别为 A：7.459、7.638、7.921 秒；B：5.585、5.906、6.407 秒；C：4.961、4.378、6.492 秒。A/B 使用 Node 24.18.0，C 使用 24.21.0；网络时序和 pnpm 发布时间策略仍是比较限制。

Windows `FILE_STANDARD_INFO.AllocationSize` 计量分配空间，按卷和 `FILE_ID_INFO` 去重，跳过重解析点；不包含目录和文件系统元数据。联合占用中 A 约 266.41 MiB、C 约 329.95 MiB：单份项目连完整缓存没有缩小；热缓存重装更快，同盘第二份安装约新增 1.45 MiB。不能从多个目录的逻辑大小相加推断硬盘损耗。

全局 pnpm store 当前逻辑大小约 1.99 GiB，但缺少安装前快照，取消其增量归因。工作目录的 Rust target 约 279 GiB、Git 约 234 MiB、`.tmp` 约 185 MiB，均不属于本次 JS 依赖复用收益。诊断目录逻辑大小约 9.44 GiB，其中包含重复计算的硬链接副本，不能当成其实际新增占用。`pnpm clean` 后冻结重装的日常 node_modules 仍有 316,127,864 B 逻辑文件，包含被保留的旧 npm 备份；应与上表的干净副本区分。

## 11. 失败处理和回退

- [x] R1. 失败时保留首个有效错误、命令环境和输入哈希；先判断代理/仓库、锁文件、脚本权限、peer 或应用行为，不直接删除所有缓存重试。
- [x] R2. 升级失败的 React、Vite 与 Lucide 已恢复最后通过的声明、锁文件及配置。纯管理器迁移最终通过，未触发退回 npm；基线副本仍可恢复。
- [x] R3. 恢复必须成组覆盖声明、锁文件、调用方及验证逻辑，避免混用 npm 安装树和 pnpm 锁文件。只回退本任务补丁，不使用破坏性全树 reset 覆盖其他改动。
- [x] R4. 已核查删除目标，自动审批拒绝删除旧 npm 的 `node_modules/.ignored_*` 备份，仅返回 `blocked by policy`。未绕过，备份保留；`artifacts/pnpm-migration/` 的工具、副本和测量证据亦保留，供复核和后续清理。
- [ ] R5. 未触发：本次没有锁文件完整性异常，未刷新 checksum 或放宽完整性验证。

## 12. 完成与归档

- [x] Z1. 所有适用阶段有结果；未执行项注明待办、明确取消原因或转交责任，不以生成方案代替实施。
- [x] Z2. 最终记录回答：采用了哪些版本、哪些暂缓、哪里改变了安装/构建契约、实际节省多少、仍有哪些验证限制。
- [x] Z3. 有效长期契约已写回真实 owner；临时日志、机器路径和队列实时内容没有进入长期文档。
- [x] Z4. 文档、编码、链接和范围检查通过；用户现有改动未被覆盖。
- [x] Z5. 按 Project 和 Issue 的独立授权规则报告结果；方案完成不自动修改外部状态或关闭 Issue。
- [x] Z6. 全部适用工作完成或明确处置后，本文归档至 `docs/archive/`；原生 ARM64 和发布验收缺口保留明确归属，没有外部入链需要迁移。

## 官方操作参考

下列说明用于实施时核查所选工具版本；网页默认主版本可能变化，参数和配置需对应实际固定版本。

- [pnpm import](https://pnpm.io/cli/import)：从 npm 锁文件生成 pnpm 锁文件。
- [pnpm install](https://pnpm.io/cli/install)：冻结安装、离线存储和平台依赖选项。
- [pnpm audit](https://pnpm.io/cli/audit)：审计命令和实际支持的参数。
- [pnpm settings](https://pnpm.io/settings)：版本对应的安装布局、脚本权限和缓存配置。
- [Node 发行与支持状态](https://nodejs.org/en/about/previous-releases)：选择受支持的 LTS。

## 执行记录

- 已保存原始输入、npm 安装副本、既有未提交修改及 pnpm 迁移通过组合的哈希。既有发布说明与徽章改动保留。
- npm 基线完整 `check` 通过。迁移组合的前端检查、Rust 708 项测试与 clippy、联网和显式离线审计、115 项 browser smoke、真实 Tauri runtime smoke、版本和发布资产 fixture 均通过。完整入口首次在 browser 处失败后，保留错误并补跑受影响部分及后续门禁。
- 首次 lint 扫描了测量副本，browser 在启动处 CDP 超时；将 `artifacts` 生成目录排除出 ESLint 与 Vite 监听后，完整 browser 通过。未扩大超时或删测试。
- 导入锁文件没有新增解析版本。npm 锁中 5 条较旧的 WASM 辅助包重复版本未保留，这些包的新版本原本已经存在于 npm 锁中。x64/ARM64 原生 optional 包均有锁定条目。
- 实测冻结安装拒绝清单与锁不一致；许可安装脚本执行、拒绝脚本未执行；管理器错误和锁缺失通过真实脚本子进程验证。脚本运行前发现依赖过期即失败，避免运行检查时自动安装。
- 发布资产整理 job 保持仅依赖 Node；其余安装 job 先准备锁定 pnpm，再初始化 pnpm 缓存。双架构发布、签名、校验及更新流程保留。
- Node 24.21.0 使用校验 SHA-256 的任务级便携版本，未修改系统默认 Node。TypeScript 6 要求令牌生成函数明确使用 ArrayBuffer，修正仅影响类型声明。
- 诊断日志、测量脚本、版本来源及输入哈希位于忽略的 `artifacts/pnpm-migration/`；不提交本机测量副本。

- Vite 8.2.2、React 19.3 和 Lucide 1.43.0 已实际安装构建，分别触发现有分块或体积预算；退回验证组合并固定版本，预算不变。重新评估归属构建与性能 owner：在不放宽预算的前提下验证分块和新增体积，再重新选择版本。
- Tauri SQL 2.4.1 与原 2.3.2 的 dist-js/index.js 相同；仅更新 JS 工具依赖，Cargo 锁和数据库结构未变。

### 最终验收与边界

- 最终依赖组合完整 `pnpm run check:full` 曾通过，见 `final-full-2.log`。清理依赖重装后，新增冷启动验证暴露 Tailwind 扫描范围问题：依赖优化约 0.1 秒，App.css 请求约 16.7 秒。`src/App.css` 显式限定源码扫描，`tokens.css` 的 `@theme static` 保留既有主题变量；没有增加兼容分支或放宽超时。浏览器 harness 每次使用独立新缓存并在退出时清理。
- `final-cold-full.log` 中快速测试、类型、lint、治理、覆盖率和 27 项 mutation 已通过，browser 的主题变量断言失败后修复真实主题定义。最终新缓存下 115 项 browser 全部通过（`final-cold-browser.log`）；受影响的生产构建与预算、样式和测试治理检查通过。Rust 708 项测试、fmt、check、clippy 及真实 Tauri runtime 追加验证通过，分别见 `final-check-rust.log`、`final-test-tauri-runtime-smoke.log`。未把失败的完整命令记为通过；未变化输入的有效证据按工程质量规则复用。
- 联网及显式离线审计均通过（`final-audit-online.log`、`final-audit-offline.log`）。一次 Rust 回环测试因代理未排除 localhost 失败，一次审计因任务命令重复添加代理协议失败；均保留首个错误，修正进程环境后重验。项目代码和永久代理配置未因这两项环境故障改变。
- 发布版本 1.9.6、changelog 校验及隔离发布同步 fixture 通过。用户现有发布徽章改动保留。没有更改应用版本、Cargo 依赖或数据库结构；测试使用隔离数据，未打开日常数据库。
- `final-inputs.json` 保存源码与配置哈希；测量输入、18 次原始计时、文件分配统计和失败日志仍保留在忽略的诊断目录。归档记录完成的本地任务；D4/F4 的发布缺口由下一次发布执行者承担，未执行任何提交、推送或外部状态修改。

### 归档后对抗式审查

- 以任务起点 HEAD 和保存的既有改动为基准，检查 staged、unstaged 与新增文件；不把原有发布徽章改动归入迁移实现。审查涵盖管理器声明、实际命令、冻结锁、脚本许可、审计、PR 准入、CI、发布版本 owner、浏览器冷缓存与主题输出。
- 发现并修复一项 P2：pnpm 12 对 HTTP 503/401 在 stderr 输出 `ERR_PNPM_AUDIT_BAD_RESPONSE`，旧 JSON 错误解析导致瞬时服务错误不重试。用受控 HTTP 服务复现原始输出后，按当前格式判断状态码和已识别网络故障，移除旧格式解析。
- 现有审计测试增加真实 pnpm 子进程与隔离 HTTP 服务：503 后成功必须重试一次，401 必须立即失败；fixture 覆盖限流、超时、断连、证书失败、坏报告、漏洞、锁变化及过期快照。服务、环境和临时目录在退出时清理。类型、lint、审计测试、测试治理、热点预算、PR 准入和发布回归通过。
- 复核迁移前 tag 的补跑路径：按发布规范选择 tag 对应的原始 workflow，当前实现只运行 pnpm，不增加 npm 回退分支。浅色主题渲染与完整浏览器状态矩阵已复核。审查后没有剩余已确认的代码缺陷；远端与原生 ARM64 的验证限制仍按 F4 转交，不能由本地审查消除。
