# Node 24 LTS 工具链升级执行方案

## 1. 文档定位

本文是 `Patina` 从 Node `22.23.1` / npm `10.9.8` 升级到 Node `24.18.0` / npm `11.16.0` 的一次性执行方案与执行记录。

文档类型是面向仓库维护者的执行型 How-to。它回答四个问题：

- 为什么工具链升级不能只改一个版本字符串。
- 本机、仓库、CI 和依赖锁文件怎样收敛到同一个可复现环境。
- 怎样用现有质量门槛证明升级没有破坏正确性、性能或发布链。
- 出现失败时，何时继续修复，何时回滚到上一条已验证基线。

本文在执行期间放在 `docs/working/`。升级完成、结果回写且不再作为当前执行依据后，应移动到 `docs/archive/`，不长期留在顶层 `docs/`。

## 2. 当前状态

- 执行日期：`2026-07-19`
- 当前状态：`完成（含对抗式审查）`
- 旧项目基线：Node `22.23.1` / npm `10.9.8`
- 新项目基线：Node `24.18.0` / npm `11.16.0`
- Rust 基线：`1.94.1`，本次不变
- 应用版本：`1.8.4`，本次不变
- 目标平台：Windows x64
- Node 安装方式：Node.js 官方 x64 MSI
- Node 版本来源：仓库根目录 `.node-version`
- npm 一致性声明：`package.json` 的 `engines.npm`
- CI 读取方式：GitHub Actions 的 `actions/setup-node` 读取 `.node-version`

## 3. 第一性原理

### 3.1 工具链版本是构建输入，不是开发者偏好

同一份源代码在不同 Node、npm 或 Rust 版本下，可能得到不同的依赖解析结果、测试时序、性能数据和构建产物。因此工具链版本属于构建输入，必须像源代码和锁文件一样可追踪、可复现。

结论：

- 不能以“本机能运行”为验收标准。
- 不能让每台机器自行选择任意 LTS 小版本。
- 不能让本机、CI 和发布工作流使用不同工具链后再比较测试结果。

### 3.2 “最新 LTS”是选型策略，精确版本才是执行输入

“使用最新 LTS”决定升级方向，但 `latest` 会随时间变化，不能成为可复现配置。开始执行时必须把目标解析成精确版本，并在一次升级中保持不变。

本次解析结果：

- Node 最新 LTS 精确版本：`24.18.0`
- Node 24.18.0 官方安装包对应 npm：`11.16.0`
- 官方归档页：<https://nodejs.org/en/download/archive/v24.18.0>
- 官方发布状态页：<https://nodejs.org/en/about/previous-releases>

以后即使 Node 24 出现更高补丁版，本次执行仍以 `24.18.0` 为验收目标。后续版本应作为新的工具链升级单独验证，不能在执行中静默漂移。

### 3.3 单一真源不等于只允许一个文件出现版本号

`.node-version` 是 Node 工具链选择的单一真源。其他位置可以镜像同一事实，但不能独立决定另一个版本：

- `.node-version`：本机版本管理器与 CI 的选择输入。
- `package.json > engines`：安装时的兼容性声明与错误提示。
- `package-lock.json` 根包 `engines`：由 npm 根据 `package.json` 写入的锁文件元数据。

结论：升级时先决定 `.node-version`，再同步派生声明；不能分别维护三套版本判断。

### 3.4 锁文件保护依赖图，但不能证明新运行时兼容

`package-lock.json` 固定依赖解析结果，避免升级 Node 时顺带升级全部依赖。但锁文件只能说明“安装了什么”，不能说明这些依赖在新 Node 上一定正确。

结论：

- 先用 `npm install --package-lock-only --ignore-scripts` 只同步根元数据。
- 检查锁文件没有无关依赖漂移。
- 再用 `npm ci` 从锁文件做一次干净安装。
- 最终由构建、测试、运行时 smoke 和性能基准证明兼容性。

### 3.5 性能预算是产品边界，不是为了升级而调整的数字

仓库历史记录显示，本机 Node `24.13.0` 下曾有两个 Data 读模型基准超预算。这个记录只是风险信号，不能直接证明 Node `24.18.0` 一定失败，也不能被忽略。

结论：

- 必须在目标工具链上重新运行 `npm run perf:stable`。
- 若失败，先复跑单个命中基准并定位波动、Node 行为变化或真实回归。
- 不允许为了完成工具链升级而直接提高预算。
- 只有满足 `docs/engineering-quality.md` 的预算变更证据要求，才能另行提出预算调整。

### 3.6 回滚必须恢复完整基线

工具链回滚不是只把 `.node-version` 改回去。完整回滚必须同时恢复：

- 本机 Node 与 npm。
- `.node-version`。
- `package.json` 的 `engines`。
- `package-lock.json` 根包元数据。
- 旧工具链下重新安装的 `node_modules`。

否则会得到“声明已回滚、实际环境仍混合”的假回滚。

## 4. 目标、范围与非目标

### 4.1 目标

- 本机 Windows x64 使用 Node `24.18.0` 和 npm `11.16.0`。
- 仓库声明、锁文件根元数据与本机实际版本完全一致。
- CI 和发布工作流继续只从 `.node-version` 读取 Node 版本。
- 现有依赖图不因工具链升级发生无关漂移。
- `npm run check:full` 在新工具链上通过。
- `npm run perf:stable` 在新工具链上通过，或对失败形成明确、可复现且不放宽预算的阻断结论。
- 必要的 Windows Tauri runtime smoke 在新工具链上通过。

### 4.2 允许修改

- `.node-version`
- `package.json` 中的 `engines.node` 与 `engines.npm`
- `package.json` 中的 `devEngines`、精确 `allowScripts` 与 `@types/node`
- `package-lock.json` 根包的对应 `engines` 元数据
- `package-lock.json` 中 Node 24 类型依赖及其类型依赖
- `tests/releasePolicy.test.ts` 的工具链一致性门禁
- `docs/engineering-quality.md` 与 `CHANGELOG.md` 的长期规则和未发布记录
- 本执行方案及后续执行结果

只有当验证证明新工具链暴露了真实兼容问题时，才允许另行扩大到相关 owner 文件；扩大范围前必须记录失败证据与真实 owner。

### 4.3 非目标

- 不修改应用版本 `1.8.4`。
- 不修改 Tauri、React、Vite、TypeScript 或任何产品运行时依赖版本；对抗式审查允许把纯开发期 `@types/node` 收敛到 Node 24 类型线。
- 不修改 Rust `1.94.1` 工具链。
- 不更新 bundle、hotspot 或性能预算来绕过失败。
- 不顺手重构业务代码、测试结构或 CI workflow。
- 不创建 tag，不触发正式发布，不修改 GitHub Release。

## 5. 目标状态矩阵

| 检查面 | 旧状态 | 目标状态 | 验证方式 |
| --- | --- | --- | --- |
| 本机 Node | `24.13.0` | `24.18.0` | `node --version` |
| 本机 npm | `11.17.0` | `11.16.0` | `npm --version` |
| `.node-version` | `22.23.1` | `24.18.0` | 读取文件 |
| `package.json` Node engine | `22.23.1` | `24.18.0` | 读取 JSON |
| `package.json` npm engine | `10.9.8` | `11.16.0` | 读取 JSON |
| `package-lock.json` 根元数据 | Node 22 / npm 10 | Node 24 / npm 11 | 检查根包 `engines` |
| npm 开发工具链门禁 | 无强制门禁 | `devEngines` 精确版本、错误即失败 | 错版本反向探针 |
| Node 类型契约 | `@types/node ^26.0.1` | `@types/node ^24.13.3` | release policy 测试与类型检查 |
| 依赖安装脚本 | esbuild 未审查提示 | 只允许 `esbuild@0.28.1` | `npm approve-scripts --allow-scripts-pending` |
| Rust | `1.94.1` | `1.94.1` | `rustc --version` |
| 应用版本 | `1.8.4` | `1.8.4` | 发布版本文件校验 |
| CI Node 来源 | `.node-version` | `.node-version` | 检查 workflow |

## 6. 分阶段执行清单

### 阶段 0：冻结事实与修改边界

- [x] 阅读 `docs/engineering-quality.md` 的工具链、质量门槛和性能预算规则。
- [x] 阅读 `docs/versioning-and-release-policy.md`，确认本次不是应用发版。
- [x] 记录升级前本机版本：Node `24.13.0`、npm `11.17.0`、Rust `1.94.1`。
- [x] 记录升级前仓库版本：Node `22.23.1`、npm `10.9.8`。
- [x] 确认 `.node-version` 是 CI Node 版本来源。
- [x] 确认 `verify.yml`、`pr-intake.yml` 和 `prepare-release.yml` 均使用 `node-version-file: .node-version`。
- [x] 确认本次允许修改的三个版本文件在执行前没有用户未提交改动。
- [x] 确认目标是精确版本 Node `24.18.0` / npm `11.16.0`，而不是浮动的 `latest`。

验收条件：目标版本、文件范围、验证门槛和回滚基线均已明确，没有把工具链升级与应用发版或依赖升级混在一起。

### 阶段 1：升级本机 Windows 工具链

#### 1.1 获取并验证官方安装包

- [x] 从 Node 官方地址下载 x64 MSI：

  ```text
  https://nodejs.org/dist/v24.18.0/node-v24.18.0-x64.msi
  ```

- [x] 同时下载官方校验文件：

  ```text
  https://nodejs.org/dist/v24.18.0/SHASUMS256.txt
  ```

- [x] 使用 SHA-256 校验 MSI，而不是仅依赖文件名或浏览器下载成功状态。
- [x] 实际校验值记录为：

  ```text
  e30cd4ca15529583afe0efc978f1ae3ab3a93c2400c222d0752d17900552ebb3
  ```

- [x] 校验值与官方 `SHASUMS256.txt` 中 `node-v24.18.0-x64.msi` 条目一致。

PowerShell 复核命令：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\node-v24.18.0-x64.msi'
```

#### 1.2 安装 Node 24.18.0

- [x] 完全退出可能使用系统 Node 的桌面开发工具，避免 MSI 替换文件时影响正在运行的宿主。
- [x] 双击经过校验的 `node-v24.18.0-x64.msi`。
- [x] 保持默认安装目录 `%ProgramFiles%\nodejs`。
- [x] 完成 UAC 提权和 MSI 安装。
- [x] 重新打开终端，避免旧进程保留安装前环境状态。
- [x] 验证生效 Node 版本：

  ```powershell
  node --version
  # 期望：v24.18.0
  ```

- [x] 验证 `where.exe node` 只命中预期安装路径：

  ```powershell
  where.exe node
  # 期望包含：%ProgramFiles%\nodejs\node.exe
  ```

- [x] 验证 Windows 卸载注册表中的 Node.js 版本为 `24.18.0`。

#### 1.3 对齐 npm 精确版本

Node MSI 原位升级后保留了机器上更高的 npm `11.17.0`。为了让本机与本次固定基线完全一致，显式对齐到 `11.16.0`：

```powershell
npm install --global npm@11.16.0
```

- [x] 执行 npm 精确版本安装。
- [x] 验证 `npm --version` 输出 `11.16.0`。
- [x] 验证 `where.exe npm` 指向 `%ProgramFiles%\nodejs` 下的 npm 启动文件。
- [x] 最终记录本机版本：Node `24.18.0` / npm `11.16.0` / Rust `1.94.1`。

验收条件：终端实际版本、可执行文件路径和系统安装注册信息一致，不存在旧 Node 抢占 PATH。

### 阶段 2：同步仓库工具链声明

#### 2.1 更新 Node 单一真源

- [x] 将根目录 `.node-version` 从 `22.23.1` 改为 `24.18.0`。
- [x] 不在 GitHub workflow 中新增第二份硬编码 Node 版本。

#### 2.2 更新兼容性声明

- [x] 将 `package.json > engines.node` 改为 `24.18.0`。
- [x] 将 `package.json > engines.npm` 改为 `11.16.0`。
- [x] 保持应用 `version` 为 `1.8.4`。

#### 2.3 同步锁文件根元数据

使用目标 npm 只更新锁文件元数据：

```powershell
npm install --package-lock-only --ignore-scripts
```

- [x] 执行锁文件元数据同步。
- [x] 确认审计结果为 `0 vulnerabilities`。
- [x] 检查 `package-lock.json` 只变更根包 `engines.node` 和 `engines.npm`。
- [x] 确认没有依赖版本、resolved URL、integrity、optional dependency 或 lockfileVersion 漂移。

允许的版本文件差异应严格等价于：

```text
.node-version:      22.23.1 -> 24.18.0
package.json:       Node 22.23.1 -> 24.18.0; npm 10.9.8 -> 11.16.0
package-lock.json:  根包 engines 同步为 Node 24.18.0 / npm 11.16.0
```

验收条件：工具链声明一致，锁文件依赖图保持不变。

### 阶段 3：用目标工具链重建依赖环境

执行：

```powershell
npm ci
```

注意：`npm ci` 会删除并重建当前 `node_modules`，这是预期行为；它不应修改 `package.json` 或 `package-lock.json`。

- [x] 执行 `npm ci`。
- [x] 确认命令使用 Node `24.18.0` / npm `11.16.0`。
- [x] 确认安装过程没有 `EBADENGINE`、生命周期脚本失败或原生二进制不兼容。
- [x] 对比 `npm ci` 前后的 `package.json` 与 `package-lock.json` 差异，确认干净安装没有额外改写版本文件。
- [x] 运行 `npm ls --depth=0`，确认顶层依赖没有 invalid 或 missing。

实际结果：安装 `268` 个包，审计 `269` 个包，`0 vulnerabilities`。npm 报告 esbuild 安装脚本尚未进入 allowScripts 清单，但没有脚本失败；后续 esbuild 直接加载、Vite 生产构建和完整门槛均通过，因此该提示不构成本次升级阻断。

失败处理：

- 如果出现 `EBADENGINE`，先定位具体包的 engine 约束，不修改根项目 engine 掩盖问题。
- 如果 esbuild 或其他平台二进制失败，先确认 `npm ci` 是否在目标 Node 下完整重建，不能复用旧 `node_modules` 下的二进制。
- 如果锁文件被改写，检查 npm 实际版本；只有能解释且属于目标工具链的元数据变化才允许保留。

### 阶段 4：验证工具链事实与应用版本不变

- [x] 运行以下版本快照：

  ```powershell
  node --version
  npm --version
  rustc --version
  cargo --version
  ```

- [x] 验证 `.node-version`、`package.json` 和 `package-lock.json` 的工具链声明完全一致。
- [x] 运行应用版本文件校验：

  ```powershell
  npm run release:validate-version-files -- 1.8.4
  ```

- [x] 确认本次没有改变 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 或发布文档中的应用版本。

验收条件：工具链版本发生预期变化，应用版本与 Rust 工具链保持不变。

### 阶段 5：运行完整质量门槛

先运行默认完整门槛：

```powershell
npm run check:full
```

- [x] `npm run check` 通过。
- [x] TypeScript 类型检查通过。
- [x] ESLint、命名、架构、IPC、hotspot、Quiet Pro 和测试治理门禁通过。
- [x] 快速测试、coverage、mutation、browser smoke 和生产构建通过。
- [x] bundle budget 通过，记录关键 chunk 与总 gzip 结果。
- [x] `npm run check:rust` 通过。
- [x] Rust fmt、check、test 和 clippy 在锁定依赖下通过。
- [x] `npm run check:dependencies` 通过。

实际结果：首次在普通沙箱运行到 browser smoke 时因子进程 `spawn EPERM` 失败；直接加载 Tailwind Oxide 与 esbuild 均成功，提升权限后的 browser smoke `43/43` 通过。随后在允许创建子进程的环境中连续重跑 `npm run check:full`，耗时 `98.3s`，完整通过。Rust 测试 `420 passed / 0 failed / 1 ignored`，依赖审计为 `0` 个 Windows 可达漏洞。

Bundle 结果：

| 指标 | 结果 |
| --- | ---: |
| Initial JS + CSS | `295.13 KiB gzip` |
| Lazy JS | `84.76 KiB gzip` |
| Total JS + CSS | `379.89 KiB gzip` |
| Index | `62.45 KiB gzip` |
| Charts | `109.24 KiB gzip` |
| React vendor | `54.54 KiB gzip` |

若 `check:full` 失败：

1. 记录第一个失败命令、退出码和完整错误，不用后续噪音覆盖首个证据。
2. 单独复跑命中的叶子命令，确认是否可重复。
3. 判断失败属于工具链兼容、环境依赖、既有工作区改动，还是非确定性测试。
4. 只修改真实 owner；不放宽测试、coverage、bundle 或 hotspot 门槛。
5. 修复后先通过叶子命令，再重新运行完整 `npm run check:full`。

### 阶段 6：运行 Windows Tauri runtime smoke

工具链升级影响前端构建产物和桌面开发链，因此在 Windows 上追加真实 runtime 验证：

```powershell
npm run test:tauri-runtime-smoke
```

- [x] 真实 Tauri 应用成功构建并启动。
- [x] command、Rust event、plugin SQL、capability 拒绝和结构化错误路径通过。
- [x] 测试创建的进程、数据库与临时目录已清理。
- [x] 没有遗留本轮创建的 Patina 测试进程或占用测试端口。

实际结果：`PASS real Tauri runtime command/event/SQLite/capability smoke`，耗时 `62.4s`。复核时存在一个早于本轮测试启动的用户 Patina 进程，未将其误判为测试残留，也未终止用户进程。

如果失败只发生在真实 runtime，不能用 browser stub smoke 的成功替代；应按 Tauri、WebView2、IPC、plugin 或进程生命周期的真实 owner 定位。

### 阶段 7：运行稳定性能基准

执行：

```powershell
npm run perf:stable
```

- [x] 串行完成全部稳定性能场景。
- [x] 记录 average、p50、p95 与 max。
- [x] Dashboard read model 预算通过。
- [x] History read model 预算通过。
- [x] Data read model 预算通过。
- [x] Data history browser 预算通过。
- [x] SQLite query plan 不出现禁止的 table scan。
- [x] Startup bootstrap 预算通过。

实际结果：普通沙箱在第一次子进程创建前因 `spawnSync EPERM` 退出，没有产生测量；提升权限后原样运行，`6` 组基准各重复 `5` 次，耗时 `390.6s`，全部预算通过。

主要聚合结果如下，单位均为毫秒：

| 场景 | Average | Worst p50 | Worst p95 | Worst max |
| --- | ---: | ---: | ---: | ---: |
| History reference | `15.83` | `15.54` | `18.88` | `45.48` |
| Current History read model | `76.90` | `76.80` | `92.81` | `127.71` |
| Dashboard read model | `22.47` | `22.01` | `25.96` | `58.14` |
| Data trend 7d | `6.09` | `6.12` | `7.10` | `11.29` |
| Data app trend 7d | `6.77` | `6.70` | `7.68` | `21.66` |
| Data trend 365d | `322.99` | `317.19` | `414.65` | `447.05` |
| Data app trend 365d | `391.28` | `398.27` | `424.91` | `424.91` |
| Data combined trends 7d | `7.45` | `7.46` | `10.08` | `10.88` |
| Data combined trends 365d | `390.55` | `394.10` | `422.55` | `422.55` |
| Data selected app derive 365d | `19.71` | `20.05` | `25.32` | `53.84` |
| Data heatmap recent | `52.92` | `51.24` | `144.12` | `202.22` |
| Browser cold History meaningful content | `183.10` | `189.60` | `189.60` | `189.60` |
| Browser Dashboard to Data active | `108.41` | `115.90` | `156.00` | `156.00` |
| Browser Dashboard to Data | `263.52` | `254.62` | `362.19` | `362.19` |
| Browser Data 7d to 365d | `390.82` | `415.87` | `498.31` | `498.31` |
| Browser Data 365d to 7d | `427.44` | `438.77` | `620.10` | `620.10` |
| Browser Dashboard to History | `151.61` | `150.07` | `221.43` | `221.43` |
| Browser Dashboard to History active | `55.17` | `49.30` | `100.20` | `100.20` |
| Browser hot History meaningful content | `54.45` | `49.40` | `82.50` | `82.50` |
| SQLite sessions current coalesce | `98.82` | `101.70` | `101.70` | `101.70` |
| SQLite sessions split baseline | `103.77` | `106.30` | `106.30` | `106.30` |
| SQLite title samples current | `0.38` | `0.40` | `0.40` | `0.40` |
| SQLite web activity current | `46.22` | `47.48` | `47.48` | `47.48` |
| SQLite sessions candidate indexes | `98.84` | `101.35` | `101.35` | `101.35` |
| Startup bootstrap | `0.0035` | `0.0015` | `0.0070` | `0.3255` |

若出现超预算：

1. 不修改预算。
2. 单独运行失败的 `perf:*` 叶子命令至少两次，区分稳定回归与一次性系统噪音。
3. 记录机器负载、后台任务、首次运行预热和防病毒扫描等环境事实。
4. 对比同一机器、同一目标工具链下的重复结果；不拿 Node 22 与 Node 24 的单次结果直接宣称因果。
5. 如果失败稳定可复现，定位是 Node 运行时变化、测试口径问题还是真实产品回归。
6. 如果需要代码修复，先确认真实 owner，再形成最小修复范围。
7. 如果无法在不损害正确性的前提下通过，工具链升级保持阻断，进入回滚阶段。

### 阶段 8：复核 CI 与提交范围

- [x] 再次搜索 workflow，确认没有硬编码旧 Node `22.23.1` 或 npm `10.9.8`。
- [x] 确认所有 `actions/setup-node` 继续使用 `node-version-file: .node-version`。
- [x] 运行 `git status --short`，区分本次文件与用户其他改动。
- [x] 运行 `git diff --check`，确认没有空白错误。
- [x] 运行 `git diff --stat` 和必要的逐文件 diff。
- [x] 确认最终范围只包含工具链声明与强制门禁、Node 类型契约、锁文件、release policy 测试、长期工程规则、changelog 和本执行方案；未扩大到业务 owner。
- [x] 在用户要求提交前，不创建 commit、tag、分支或发布。

### 阶段 9：完成与归档

- [x] 将第 7 节执行记录补齐实际命令、结果和关键数值。
- [x] 将本文状态从 `执行中` 改为 `完成`。
- [x] 确认所有必需项已勾选；条件式回滚项无需为了形式勾选。
- [x] 对抗式审查确认长期工具链治理规则发生变化，已回写 `docs/engineering-quality.md`。
- [x] 文档不再是当前执行依据后，将其移动到 `docs/archive/`。

## 7. 执行记录

### 7.1 已完成

| 时间 | 动作 | 结果 |
| --- | --- | --- |
| 2026-07-19 | 核对 Node 官方发布状态 | `24.18.0` 为目标 LTS 精确版本 |
| 2026-07-19 | 核对本机旧环境 | Node `24.13.0` / npm `11.17.0` |
| 2026-07-19 | 核对 Rust | Rust/Cargo `1.94.1`，与仓库一致 |
| 2026-07-19 | 下载并校验官方 MSI | SHA-256 与官方清单一致 |
| 2026-07-19 | 用户手动安装 Node MSI | 注册表与 PATH 生效为 Node `24.18.0` |
| 2026-07-19 | 对齐 npm | npm `11.16.0` |
| 2026-07-19 | 更新仓库版本声明 | `.node-version` 与 `package.json` 已同步 |
| 2026-07-19 | 同步锁文件根元数据 | 仅两个 engine 字段变化，依赖图未漂移 |
| 2026-07-19 | 对抗式审查 Node 类型契约 | 将 `@types/node` 从 26 收敛到 `24.13.3`，同步 `undici-types 7.18.2` |
| 2026-07-19 | 强制开发工具链 | 增加 `devEngines`，错误 Node/npm 在 npm 命令前失败 |
| 2026-07-19 | 审查依赖安装脚本 | 精确允许 `esbuild@0.28.1`，干净安装无待审查脚本 |
| 2026-07-19 | 清理本机 npm 双入口 | 移除 AppData 重复 npm，仅保留 Node MSI 自带 npm `11.16.0` |
| 2026-07-19 | 增加自动回归门禁 | 24 项 release policy 测试覆盖声明、类型、脚本许可与 CI 单一真源 |

### 7.2 最终验证结果

- `npm ci`：通过，268 个包，0 个漏洞。
- `npm run release:validate-version-files -- 1.8.4`：通过。
- `npm run check:full`：通过，连续完整运行耗时 `98.3s`。
- `npm run test:tauri-runtime-smoke`：通过，耗时 `62.4s`。
- `npm run perf:stable`：通过，6 组基准各 5 次，耗时 `390.6s`。
- Bundle：总 JS + CSS `379.89 KiB gzip`，预算通过。
- 性能：全部现有预算与 SQLite query-plan 门槛通过。
- 最终结论：Node `24.18.0` / npm `11.16.0` 可作为新的可复现项目基线，不需要修改业务代码或放宽任何质量与性能预算。
- 对抗式审查后复核：`npm ci` 无待审查脚本；针对性测试、最终 `npm run check:full` 与真实 Tauri runtime smoke 连续通过，总耗时 `143s`。运行时 bundle 文件名与体积保持不变，因此此前同一 Node/npm 下的稳定性能结果仍有效。

## 8. 回滚方案

只有出现以下任一条件时才进入回滚：

- 新工具链导致稳定、可复现且无法在正确 owner 内小修解决的质量门槛失败。
- 真实性能回归稳定超过预算，且继续升级会损害用户高频路径。
- Tauri runtime 或发布链在 Node 24 下存在阻断问题，短期不能安全修复。
- 依赖生态明确不支持目标 Node/npm 组合。

回滚步骤：

- [ ] 保存所有失败日志、复现命令和环境版本。
- [ ] 完全退出使用系统 Node 的开发工具。
- [ ] 安装官方 Node `22.23.1` x64 MSI。
- [ ] 执行 `npm install --global npm@10.9.8`。
- [ ] 验证本机 Node `22.23.1` / npm `10.9.8`。
- [ ] 将 `.node-version` 恢复为 `22.23.1`。
- [ ] 将 `package.json` engines 恢复为 Node `22.23.1` / npm `10.9.8`。
- [ ] 使用旧 npm 同步或恢复 `package-lock.json` 根包 engines。
- [ ] 执行 `npm ci` 重建旧工具链依赖环境。
- [ ] 运行 `npm run check:full`，证明回滚后基线恢复。
- [ ] 在本文记录阻断原因、证据和下一次复核前置条件。

不允许使用 `git reset --hard` 或覆盖用户其他工作来完成回滚。只恢复本执行范围内的文件和本机工具链。

## 9. 完成定义

只有同时满足以下条件，升级才算完成：

- [x] 本机 Node、npm、PATH 与安装注册信息一致。
- [x] `.node-version`、`package.json`、`package-lock.json` 一致。
- [x] CI 继续从 `.node-version` 读取 Node，没有第二份硬编码版本。
- [x] `npm ci` 在目标工具链下可重复成功。
- [x] 应用版本 `1.8.4` 与 Rust `1.94.1` 未改变。
- [x] `npm run check:full` 通过。
- [x] `npm run test:tauri-runtime-smoke` 通过。
- [x] `npm run perf:stable` 通过。
- [x] 没有通过放宽测试、bundle、hotspot 或性能预算换取通过。
- [x] 最终 diff 范围可解释、可审计且没有混入用户其他改动。
- [x] 本文记录了实际执行结果，并在任务结束后按文档卫生规则归档。

## 10. 对抗式审查

审查目标不是再次证明“当前能运行”，而是主动寻找能让升级在下一台机器、下一次 CI 或下一次依赖安装中失效的反例。

### 10.1 审查发现与修复

- [x] 发现运行时 Node 24 与 `@types/node` 26 不一致；修正为 `@types/node ^24.13.3`。
- [x] 发现 `engines` 在 `engine-strict=false` 下只提供提示；增加 Node `24.18.0` / npm `11.16.0` 的 `devEngines` 精确错误门禁。
- [x] 使用伪造 Node `24.17.0` / npm `11.17.0` 运行 npm 内部规则探针，确认两项均被判为 error。
- [x] 发现 esbuild 安装脚本未进入 allowlist；审查脚本入口后仅允许精确的 `esbuild@0.28.1`。
- [x] 在干净 `npm ci` 前后运行待审查脚本查询，均返回 `No packages with unreviewed install scripts`。
- [x] 发现本机 Program Files 与 AppData 存在两个 npm 副本；移除 AppData 重复副本，仅保留 Node MSI 自带 npm。
- [x] 验证最终 `where.exe npm` 只命中 `%ProgramFiles%\nodejs`，实际 npm 仍为 `11.16.0`。
- [x] 校验绝对路径后删除本任务创建的临时 MSI、SHA-256 清单和安装日志目录；如需重装可从 Node 官方归档重新下载。
- [x] 增加 release policy 测试，自动比对 `.node-version`、`engines`、`devEngines`、锁文件、Node 类型主版本与 esbuild 精确许可。
- [x] 增加 workflow 门禁，要求每个 `actions/setup-node` 都使用 `.node-version`，并拒绝硬编码 `node-version:`。

### 10.2 审查后验证

- [x] `npm ci`：通过，268 个包，0 个漏洞，无待审查安装脚本。
- [x] `npm run test:release`：24 项通过。
- [x] `npm run check:types`：通过。
- [x] `npm run check:test-governance`：通过。
- [x] `npm run build`：通过，运行时 bundle 哈希与审查前一致。
- [x] `npm run check:full`：通过。
- [x] `npm run test:tauri-runtime-smoke`：通过。
- [x] 性能复用判定：只有类型包和 package 元数据发生变化，产品运行时依赖与 bundle 未变化，因此复用审查前同一工具链下已通过的 6 组、每组 5 次性能结果。

### 10.3 审查结论

未发现剩余阻断项。升级不再只依赖维护者手工遵守版本文件：错误 Node/npm 会在 npm 命令前失败，Node 类型契约与运行时主版本一致，CI 版本来源和依赖脚本许可都有默认测试保护，本机也不存在用户级 npm 覆盖 MSI 自带 npm 的双入口。
