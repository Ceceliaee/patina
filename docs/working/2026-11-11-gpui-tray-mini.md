# GPUI 桌面迁移执行方案：托盘、Mini 与 QuietPro

首个可用版本应能完成一次真实操作：从托盘打开 Mini，看到当前活动，收起或关闭 Mini 后继续工作，再次打开时能看到这段时间的记录。先在这个范围内验证常驻内存、CPU 和记录正确性，再决定是否迁移主窗口。

- [x] 在当前工作目录从本地 `main` 的 `b032de5f` 创建并切换到 `codex/gpui`。

新增测试遵循[工程质量中的 GPUI 测试约定](../engineering-quality.md#51-测试分层与稳定性治理)。

## 用什么判断这次迁移值得做

| 用户需要什么 | 哪些工作必须持续 | 怎样观察 |
| --- | --- | --- |
| 关掉所有窗口仍能记准时间 | 前台采样、会话切分与落库由同一套 Rust 引擎负责。窗口可以随时创建和销毁。 | 在两次打开 Mini 之间切换应用，核对数据库中的会话、时长与暂停边界。 |
| 全天挂托盘或贴边小窗，尽量少占资源 | 只挂托盘时仍需接收系统消息。Mini 收起时仍需处理唤出和状态变化，详细内容只在展开时读取。 | 分别测量各状态的整个进程树。用唤醒、读库、绘制次数解释 CPU 变化，用关窗后的私有提交判断资源回收。 |
| 新界面操作起来仍像 Patina | 颜色、尺寸和输入反馈由 QuietPro 统一，活动的含义与用户操作的结果由 Patina 决定。 | 用同一份数据和同一 DPI 对照现版，实际操作贴边、悬停、关闭和重开。[Quiet Pro 规范](../quiet-pro-component-guidelines.md) |

## 1. 建立基线与实验身份

- [x] 在实现前保存一份可重复运行的 Tauri 对照构建，记下提交、构建配置、测试库和设置。见下方基线记录。测量口径沿用[资源测量与生命周期验证](../engineering-quality.md#53-性能测量与资源生命周期)和[历史托盘测量](../archive/2026-11-06-desktop-resource-optimization.md)。
- [x] 沿用同一工作目录。GPUI 的 Cargo 输出在 `desktop/target/`；开始时磁盘可用约 436 GiB。对照构建和原始采样保留在忽略的 `artifacts/runtime-smoke/`。Tauri 补丁仍在对应分支维护。
- [x] 给 GPUI 程序分配独立的应用身份、单实例锁、配置及数据根。用固定样本库或一致性备份的副本验证。启动时指定无效实验路径应明确失败；重复启动同一实验身份时，数据库只有一个记录者。[运行身份与持久化隔离](../architecture.md#69-运行身份与持久化隔离)

### Tauri 对照构建与复测

构建运行编号为 `1794366757836-2c00b7ce-91cd-4b50-8b01-26337b70d77e`，来自 `b032de5f` 的 Windows validation 构建。测量运行编号为 `1794366877162-a86b4c71-7cc5-4fb7-8671-a4e640eadac4`。每个场景从独立测试库启动，使用相同的前台应用样本，开启托盘、关闭 Web Activity。确认已生成活动会话、主窗口自然释放后才计时。WebView2 调试连接只在需要验证 Mini 状态时保留。

本机为 i5-13400F，16 个逻辑处理器，Windows build 26100，WebView2 157，屏幕 2560 × 1440、125% 缩放、60 Hz，Atlas 电源计划。每个场景采样 10 分钟，间隔 5 秒；结果包含探测子进程和属于测试实例的 WebView2。私有提交单位为 MiB，CPU 以一个逻辑核心的 100% 为满载。

| Tauri 场景 | 第 1 轮：私有提交 / CPU | 第 2 轮：私有提交 / CPU | 第 3 轮：私有提交 / CPU |
| --- | ---: | ---: | ---: |
| 纯托盘 | 34.78 MiB / 0.40% | 39.32 MiB / 0.33% | 34.74 MiB / 0.29% |
| Mini 收起 | 225.89 MiB / 1.30% | 240.76 MiB / 1.30% | 251.16 MiB / 1.45% |
| Mini 展开 | 220.41 MiB / 1.58% | 225.25 MiB / 1.45% | 219.10 MiB / 1.55% |

九组均完成，每组 121 个样本。纯托盘、Mini 收起和展开的三轮工作集中位数分别为 268.77、643.16、655.16 MiB。运行目录中的 `resource-summary.json` 保留各组采样间隔、CPU 覆盖时长、工作集、私有提交、线程、句柄和进程角色。

私有提交取进程树总和的时间中位数，CPU 取有效间隔的时间加权均值。私有提交包含可换出的内存；工作集是驻留页，但跨进程求和会重复计算共享页。汇总脚本分别保留两种口径。以第一轮收起为例，6 个 WebView2 进程合计的私有提交中位数为 184.18 MiB；主进程贡献单核 CPU 的 1.11%，WebView2 合计 0.14%。这些是受控验证构建的数据，不能代替安装版的实测。

在仓库根目录运行 `pnpm run test:tauri-runtime-prepare` 生成与当前源码匹配的 manifest，构建 `src-tauri` 的 `windows-resource-sample` example；把两者的路径依次传给 `node --experimental-strip-types tests/tauriTrayMiniBaseline.ts`。使用 `node --experimental-strip-types tests/resourceSummary.ts <已完成的 JSONL 文件...>` 汇总。重新构建分支上的 Tauri 会测到已修改的共享引擎，应单独保留其运行编号。

## 2. 让记录引擎在纯托盘下运行

Patina 自己维护 Windows 桌面入口。平台层通过现有的 `windows` crate 接入系统托盘，接收菜单动作。应用层决定何时打开或关闭 Mini、暂停记录和退出进程。GPUI 提供窗口和事件循环，QuietPro 提供 Mini 使用的控件。

[原生工作区](../../desktop/Cargo.toml)使用 `gpui-kit 0.9.1`、`gpui-base 0.9.1` 和 `gpui-pre 0.3.12`。QuietPro 启用 Kit 的 `assets` 功能，使用 `icon_assets!` 登记界面实际用到的 Lucide 图标。桌面入口和控件示例注册同一个资源源，控件按 `IconName` 使用图标。图标清单由 [QuietPro](../../desktop/quietpro/src/lib.rs) 持有。

[实验入口](../../desktop/patina/src/lib.rs)在常驻进程中使用 GPUI 的 `WindowingRequest::Headless`，接收 Win32 托盘和电源消息，并持有唯一的记录引擎。打开第一个 Today 或 Mini 时启动[窗口进程](../../desktop/patina/src/window_process.rs)。两个窗口共享图形设备。启用「关闭到后台」时，关闭主窗口后 Mini 可继续使用，最后一个窗口关闭后仅保留常驻进程，继续记录。关闭该选项后，关闭主窗口会一并退出 Mini 和记录进程。

在 Windows 仓库根目录运行 `cargo run` 启动 GPUI 开发预览，默认打开主窗口。用 `cargo run -- --mini` 预览 Mini。启动器按原生工作区的工具链编译，监听 Rust 源码和内嵌资源。保存后编译成功会重启预览，主窗口回到上次浏览的页面。页面草稿和弹窗随重启关闭。编译报错时可以继续操作上一次成功的预览，修正并保存后会再次编译。按 Ctrl+C 或从预览托盘退出即可结束。开发预览使用 `%LOCALAPPDATA%/Patina.GPUI.Dev/Patina.GPUI.Experimental/`，也可通过 `PATINA_GPUI_PROFILE_PARENT` 指定已有的绝对目录。

需要单次运行时，从仓库根目录直接启动实验版。原生工作区使用 Rust 1.100.0，Tauri 保持 1.94.1。

```powershell
cargo +1.100.0 run --locked --manifest-path desktop/Cargo.toml -p patina-gpui -- --mini
```

不带窗口参数时，首次启动按「静默启动」偏好决定是否打开主窗口，再次启动会打开同一配置的主窗口，隐藏托盘图标后也可通过此方式返回。`--mini` 打开 Mini，`--today` 打开主窗口。左键单击「Patina · GPUI」托盘图标打开主窗口。右键菜单可打开主窗口或 Mini、暂停或恢复记录，以及退出应用。

在「设置 → 常驻」保存「开机自启动」后，Windows 会在当前用户登录时启动相应配置的 GPUI 程序。新实验配置默认关闭该选项，启用静默启动和关闭到后台。默认数据位于 `%LOCALAPPDATA%/Patina.GPUI.Experimental/`。需要另一个测试库时，把 `PATINA_GPUI_PROFILE_PARENT` 设为已存在的绝对目录，程序仍使用该目录中的 `Patina.GPUI.Experimental/` 子目录。正式旧库的迁移历史修复与升级演练在主线接替前完成。

使用 `cargo +1.100.0 run --locked --manifest-path desktop/Cargo.toml -p patina-gpui --example native-lifecycle` 在独立临时库验收实际窗口、真实采样循环与退出。前台应用由原有的调试探测样本提供，程序结束后释放临时库。

本机还在默认实验目录启动了真实前台探测，核对到可见的 Mini。通过托盘的退出命令关闭程序后，以只读连接确认实验库中未结束的会话数为 0；重新启动后继续使用同一实验库。

本轮 `pnpm run check:full` 通过，包含 232 个浏览器用例、Tauri Rust 回归和依赖审计。原生工作区单独通过 Windows 构建与 Clippy（`--workspace --bins --examples -- -D warnings`）。窗口生命周期和独立控件验收日志保存在本地 `artifacts/gpui-native/`。

- [x] 在 Patina 仓内建立 GPUI 桌面入口和私有 `quietpro` crate（`publish = false`）。选择相互匹配的 GPUI、gpui-base 版本并锁定依赖。用 Windows 构建和依赖树核实实验程序能够独立启动，记录所用版本。[GPUI Base 使用说明](https://gpui-kit.com/base/getting-started/)
- [x] 沿用 [TrackingDataStore](../../desktop/recorder/src/engine/tracking/ports.rs) 和现有 SQLite 实现。沿[记录循环](../../desktop/recorder/src/engine/tracking/runtime.rs)逐处识别经 `AppHandle` 读取的状态、发布的事件及启动的任务，将实际用到的能力交给桌面入口提供。两个宿主调用同一份采样、会话和恢复逻辑。
- [ ] 在两版上重放完全相同的前台序列，逐条比较应用身份、会话边界和时长。
- [x] 接入 Windows 托盘的打开 Mini、暂停、恢复与退出动作，参照[现有托盘实现](../../desktop/patina/src/tray.rs)。先在无可见窗口时验证采样与落库，再验证暂停期间无新增活动、恢复后按新样本起算、显式退出后会话封口。
- [ ] 单独观察退出前后的探测子进程，确认没有残留。
- [ ] 用锁屏、休眠恢复和进程中断重启验证已有保障。以最后一次有效采样核对恢复边界；不确定的停机时间应保持为空。关闭 Mini 和退出程序分别验证。

## 3. 用 QuietPro 实现 Mini

现版 Mini 是视觉对照。保留信息层级、明暗色、紧凑尺寸和贴边手感。比如[现版固定和关闭按钮](../../desktop/patina/src/mini.rs)的命中尺寸参见[原生窗口布局](../../desktop/patina/src/mini.rs)，在原生版中由 QuietPro 持有。每迁一个控件，先区分它是动作、选择还是状态展示，再确定谁持有值、如何触发、能否聚焦，以及禁用时读到什么。视觉一致和行为正确分别验收；后续页面遇到同一种控件就消费同一接口。

- [x] [QuietPro 图标控件](../../desktop/quietpro/src/lib.rs)共享 24 px 命中框、14 px 图标、焦点和禁用样式。关闭接一次动作；固定接当前选中值和变更回调，让辅助技术能读出开关状态。调用方提供稳定 ID 和本地化名称，并持有窗口与业务状态。
- [x] 用 Windows UI Automation 在独立示例中读到固定开关和复位按钮的名称、开关值和禁用状态。切换一次只更新一次计数，复位后按钮禁用。在 `desktop/` 下运行 `cargo test --locked -p quietpro --test controls -- --ignored`。测试会构建并启动示例。[控件验收测试](../../desktop/quietpro/tests/controls.rs)
- [ ] 在独立的[控件示例](../../desktop/quietpro/examples/controls.rs)中切换系统明暗主题，以 Tab 聚焦固定按钮，按一次 Space 或 Enter 只增加一次计数。清零后复位按钮应不可再触发。运行命令：`cargo +1.100.0 run --locked --manifest-path desktop/Cargo.toml -p quietpro --example controls`。
- [ ] 对照现版逐项检查默认浅色、深色及缩放下的 Mini。实验版目前跟随系统明暗外观；自定义预设随设置页迁移。用键盘验证焦点可见、按钮触发一次、禁用时无回调，再验证鼠标悬停不抢输入焦点。视觉差异和组件行为分别记录。

- [ ] 从 Mini 实际需要的主题、文本和图标按钮开始。QuietPro 定义语义颜色、尺寸、交互反馈和组件接口，内部组合 gpui-base 的交互能力。用不连接 Patina 数据库的最小示例验证明暗主题、焦点和触发回调。
- [ ] Patina 负责窗口位置、贴边、展开和内容，用已有[领域规则](../../desktop/recorder/src/domain/mini_window)与[展示快照](../../desktop/recorder/src/domain/mini_window/content.rs)接入 GPUI。收起时只消费必要状态，展开时读取活动明细。用快速收起再展开、关闭时仍有读取在途等情形，验证旧结果不会更新新窗口。[Mini 生命周期](../architecture.md#mini-生命周期)
- [x] 在 125% 缩放下验证展开态客户区为 400 × 300 物理像素，顶部贴合工作区。15 次关闭和重开中，重复请求只打开一个 Mini；被动打开不取得前台焦点。关窗后切换样本应用仍能生成会话。
- [x] 在 125% 缩放下，固定画布中的可见区域可从 400 × 300 连续收至 140 × 30。验收覆盖展开、收起及收起中途反向。关闭 Windows 客户区动画时直接显示目标状态。
- [x] 用真实鼠标从横条移入，再从内容区、固定按钮和关闭按钮移出。四次实测在移出后 211–230 ms 开始收起，381–399 ms 恢复横条；等待期间移回面板会取消收起。运行原生 `native-lifecycle` 示例时附加 `-- --pointer` 可复测。
- [ ] 在前台编辑器里持续输入，移入贴边 Mini 时能展开，输入仍到达编辑器；移出可收起。重复从托盘打开只出现一个 Mini。关闭后观察订阅、定时任务和图形资源的释放，再切换应用并重开，核对活动是否连续。
- [ ] 对照现版检查普通与缩放显示下的窗口尺寸、贴边位置、鼠标命中范围和明暗主题。首阶段的托盘承担打开 Mini 的入口。

## 4. 做资源对照并决定下一步

- [x] 使用同机 Tauri 基线完成 GPUI 三种稳态的三轮采样。每组 10 分钟、间隔 5 秒，统计整个进程树。[历史测量口径](../archive/2026-11-06-desktop-resource-optimization.md)
- [ ] 对差异落在轮间波动内的指标，在相同机器上交替运行两个版本后再判断收益。

### GPUI 与 Tauri 的常驻开销

2026-11-11 的 GPUI 运行编号为 `gpui-tray-mini-20261111-134207`。同一台机器、同一 Windows 采样器、同一固定前台应用和独立空库。GPUI 使用当前 dev 程序，纯托盘从无窗口启动，收起和展开分别核对 140 × 30 和 400 × 300 物理像素。展开态固定面板。每组预热 30 秒后计时，采样期间核对窗口状态，前后核对活动会话 ID 和最后成功采样时间。九组各有 121 个样本，CPU 有效覆盖各约 600 秒。Tauri 采用当天稍早的 validation 构建基线，两版分批运行。

| 场景 | 私有提交 MiB（Tauri → GPUI） | 工作集 MiB（Tauri → GPUI） | 单核 CPU（Tauri → GPUI） |
| --- | ---: | ---: | ---: |
| 纯托盘 | 34.78 → 25.05 | 268.77 → 185.19 | 0.33% → 0.30% |
| Mini 收起 | 240.76 → 85.61 | 643.16 → 226.88 | 1.30% → 0.95% |
| Mini 展开 | 220.41 → 85.29 | 655.16 → 222.55 | 1.55% → 0.88% |

每项取三轮中位数。收起态私有提交节省 155.14 MiB（64.4%），工作集总和减少 416.27 MiB（64.7%），单核 CPU 下降 0.35 个百分点（相对降低 27.0%）。三轮收起态私有提交分别为 85.61、91.39、85.52 MiB，单核 CPU 分别为 0.73%、0.97%、0.95%。纯托盘的 CPU 区间与 Tauri 重叠。GPUI 在收起时保留绘制面板的画布，收起比纯托盘多用约 60.56 MiB 私有提交。工作集跨进程相加包含共享页的重复计数。

复测使用与 Tauri 基线相同的 Windows 采样器。先按第 1 节构建采样器，再在交互式 Windows 桌面的 `desktop/` 目录运行 `cargo test --locked -p patina-gpui --test resources tray_mini_baseline -- --ignored --nocapture`。测试创建新的 `artifacts/runtime-smoke/gpui-baseline-*/` 目录，结果文件 `result.json` 记录二进制散列、窗口尺寸和记录进度，九份 JSONL 可交给前述 `resourceSummary.ts` 汇总。将测试名替换为 `sampler_smoke` 可验证三个状态各 15 秒的采样流程，结果写入单独的 `gpui-smoke-*/` 目录。[资源验收测试](../../desktop/patina/tests/resources.rs)

| 场景 | 核对结果 |
| --- | --- |
| 纯托盘，窗口已释放 | 进程树私有提交中位数、平均单核 CPU、有效采样间隔、已写入会话 |
| Mini 贴边收起、展开后静置 | 两种状态各自相对纯托盘的增量，静置时的刷新、绘制和唤醒，首次显示内容的延迟 |
| 打开和关闭 Mini 15 次，静置 60 秒 | 暖机后第 3、8、15 次和静置后的私有提交、线程、句柄及重开耗时，核对是否逐轮增长 |

- [ ] 按进程角色记录原始值与配对差值。记录正确且资源改善可重复、超过基线波动时，列出获益场景和代价，再启动 Today 页迁移。内存与 CPU 一降一升时分别报告；差值落在波动内时保留“收益未定”。若记录退化或资源持续累积，先定位对应的采样、渲染或释放路径并复测。

## 5. Today 与共用组件

从托盘菜单或 Mini 标题栏打开今天页，重复打开会激活现有窗口。主窗口标题栏也可打开 Mini。[主窗口](../../desktop/patina/src/main_window.rs)管理壳层，[Today](../../desktop/patina/src/today.rs)持有图表、排行和读取任务。关闭窗口会注销页面订阅和刷新任务，后台记录继续使用同一引擎。QuietPro 提供现有的图标动作、开关和明暗色；Today 和 Mini 共用时长格式。环图、小时图和排行留在 Today。

[现版读模型](../../desktop/patina/src/today.rs)比较当地今天截至读取时的活动与完整的昨天。两版复用 [SQLite 小时聚合查询](../../desktop/recorder/src/data/activity_read_model/hourly.rs)，由它处理原生记录、精确导入、时段导入、匿名活动和重叠优先级。应用排行使用关联后的统计身份、显示名覆盖和占总时长的四舍五入百分比。总时长显示到整分钟，小时图按小时分配并舍入。暂停时静置页面的下次定时读取安排在本地午夜，窗口重新激活会重新读取。

[Rust 验收](../../desktop/patina/tests/today.rs)在独立 SQLite 库写入跨午夜的 Studio 会话、Writer 会话、与 Writer 重叠的精确导入及匿名活动。预期今天 70 分钟、昨天 30 分钟；三项排行分别为 45、20、5 分钟（64%、29%、7%）。零点和一点的活动分别为 60 和 10 分钟。两版从同一份已关闭的数据库复制启动，使用英语、总量模式和暂停记录的设置。Windows UI Automation 从实际窗口读取结果。恢复记录的生命周期场景另外使用固定前台应用。

在 Windows 的 `desktop/` 目录运行：

```powershell
cargo test --locked -p patina-gpui --test today
cargo test --locked -p patina-gpui --test today ranked_app_actions -- --ignored
cargo test --locked -p patina-gpui --test today main_window_lifecycle -- --ignored --nocapture
```

最后一条命令使用第 4 节的 Windows 采样器，输出本次 `artifacts/runtime-smoke/today-*/` 路径。把该目录和第 1 节 Tauri 对照构建的 `prepared/manifest.json` 的绝对路径分别赋给 `PATINA_TODAY_RUN` 和 `PATINA_TAURI_MANIFEST`，再运行 `cargo test --locked -p patina-gpui --test today tauri_comparison -- --ignored`。该测试使用 Python 标准库在本机回环地址提供已构建的前端资源。交互样本包含当天 01:10 前的活动，在当地 01:10 后运行。

### 2026-11-11 同机对照（窗口进程拆分前）

配对运行目录为 `artifacts/runtime-smoke/today-20261111T094101.988Z/`。Tauri 使用第 1 节的 validation 构建，GPUI 使用当前 dev 构建。两版客户区均为 1100 × 736 DIP，在 120 DPI 下为 1375 × 920 物理像素。`gpui.json` 和 `tauri.json` 保留各自的二进制散列、相同的 SQLite 样本散列、窗口读数和标题相对客户区的坐标。专注分布标题分别在 (232, 244) 和 (232, 245)，今日活动在 (232, 581) 和 (232, 585)，应用排行在 (721, 244) 和 (720, 245)。两版的总计、昨日差额、24 小时读数和三项排行一致，都能从总量图切换到分类图。

| 状态 | 私有提交中位数 | 工作集中位数 | 平均单核 CPU |
| --- | ---: | ---: | ---: |
| Tauri Today，分类图 | 279.86 MiB | 522.86 MiB | 9.06% |
| GPUI Today，分类图 | 103.87 MiB | 107.19 MiB | 1.04% |
| GPUI 冷启动托盘 | 12.37 MiB | 49.02 MiB | 0.16% |
| GPUI 首次关窗回托盘 | 25.84 MiB | 85.44 MiB | 0.57% |
| GPUI 开关 15 次，回托盘静置 60 秒 | 27.27 MiB | 87.17 MiB | 0.42% |
| 从 Mini 重开 Today，再关回同一个 Mini，已恢复记录 | 98.38 MiB | 237.06 MiB | 0.42% |

每个状态采集整个进程树 30 秒，每 5 秒一次，7 个样本。Today 对照均已读出真实数据并完成图表切换。测试库的关闭设置让 Tauri 关窗退出，GPUI 实验宿主始终保留托盘。此前的配对运行 `today-20261111T092345.423Z` 测得 Tauri 与 GPUI 的 Today 私有提交分别为 241.14 和 95.85 MiB，单核 CPU 分别为 2.71% 和 0.42%。两轮内存差方向一致，CPU 在短样本间波动较大；长期稳态沿用第 4 节多轮口径。

修正前，同样开关 15 次后，主进程私有提交达到 626.60 MiB。Win32 原生关闭先销毁 HWND，GPUI 随后才尝试注销持有窗口对象的 OLE 拖放目标。现在系统关闭请求先交给 GPUI 销毁窗口，供它在句柄有效时注销拖放目标。修正后，第 3、8、15 次窗口刚关闭时主进程私有提交为 38.79、51.75、52.42 MiB，句柄为 536、546、560，重开至能读出排行的耗时为 331、514、520 ms。静置后进程树数值见上表。剩余的逐轮句柄增长见下节。

- [x] 从托盘打开、关闭、重开 Today，切换图表后重建仍保留模式。只挂托盘时恢复采样，再从 Mini 的「打开主窗口」按钮重开，关闭后原来的 Mini 仍在，测试库继续记录同一固定前台应用。
- [x] 在 Windows 辅助功能树中定位排行应用，Enter 打开用量详情，Escape 关闭。右击 Studio，改为 Office 后，零点的 Office 从 15 分钟变为 60 分钟。通过改名输入框保存 Workroom 后，排行与详情入口都读出新名称。
- [x] 小时图在总量和分类模式下均支持键盘提示。Tab 从模式开关进入有活动的小时，Escape 收起提示并保留焦点，再按 Tab 进入下一小时。空时段跳过，离开图表收起提示。分类提示分别读出类别和分钟数，包括匿名活动。对应真实窗口用例为上文的 `ranked_app_actions`。

Today 排行入口与 History 的应用分布共用所选应用的详情，支持日期切换、时间线缩放、最短时长筛选和标题明细。匿名活动纹理和各主题的视觉细节留到页面整体对照阶段。

本轮仓库级 `pnpm run check:full` 通过前端检查、232 个浏览器用例、Tauri Rust 回归和 Clippy，在最后的依赖审计报告 `RUSTSEC-2026-0486`（`rustix 1.1.4`）。该版本已在分支基点的 Tauri 锁文件中。原生工作区分别对二进制、示例、Patina 与 QuietPro 测试目标运行 Clippy。Recorder 的共享模块由 Tauri 测试目标编译；显式对整个工作区运行 `clippy --all-targets` 也会尝试编译 Recorder 禁用的独立库测试目标，缺少 Tauri 测试宿主。

### 主窗口句柄归属与回托盘复验

修复前运行 `handles-20261111T103805.138Z`。两个独立实例从同一暂停记录的 SQLite 样本复制启动，各开关 Today 15 次。无 UI Automation（UIA）组只用 Win32 找到窗口并发送关闭消息；有 UIA 组每轮从真实窗口读取排行。在已暖机的第 3 至第 15 轮，两组均多出 12 个 Section（共享内存映射）和 12 个 Mutant（Windows 互斥体）。它们是指向同一对具名对象的新句柄。关窗静置 5 秒后仍在原 Patina 主进程的句柄表中。

| 关窗后常驻进程总句柄 | 第 3 轮 | 第 8 轮 | 第 15 轮 |
| --- | ---: | ---: | ---: |
| 修复前，无 UIA | 395 | 405 | 419 |
| 修复前，有 UIA | 412 | 422 | 436 |
| 修复后，无 UIA | 271 | 271 | 271 |
| 修复后，有 UIA | 271 | 271 | 271 |

Section 的对象名末段为 `{2627E361-24E2-4F14-99ED-A20D0685D8DD}_v22`，互斥体另有 `_0` 后缀。本机载入的 NVIDIA Game Proxy（`nvspcap64.dll`，11.0.9.251）包含相同的 GUID 和版本后缀。独立 D3D11 对照无需启动 Patina 或显示窗口：只创建设备时计数保持稳定；让五个新设备各自首次创建交换链，即使从未调用 `Present` 且已释放交换链和设备，每次仍多留一对句柄。在同一设备上反复重建交换链，只有第一次增加。显式清空和刷新 D3D 上下文、切换 GPUI 呈现后端均未消除增长。

修复后运行 `handles-20261111T110419.615Z`。每次打开都在渲染进程中读到目标 Section 和互斥体各 1 个，30 次关窗均确认对应进程正常退出，常驻记录进程每次均为 0 对。[窗口进程管理](../../desktop/patina/src/window_process.rs)通过进程代次和最近一次打开请求识别过期的关窗通知，父进程异常退出时由 Windows Job 回收子进程。[原生回归](../../desktop/patina/tests/today/handles.rs)同时覆盖关窗立即重开、渲染进程中断后重开，以及常驻进程退出后的子进程回收。

资源运行 `today-20261111T110458.317Z` 采集整个进程树。每个状态测 30 秒、每 5 秒一次。内存取中位数，CPU 按一个逻辑核心计算。首次关窗时渲染进程退出，CPU 有效覆盖约 25 秒，其余各项约 30 秒。

| 状态 | 私有提交 MiB | 工作集 MiB | 平均单核 CPU |
| --- | ---: | ---: | ---: |
| 暂停记录，冷启动托盘 | 12.26 | 48.27 | 0.10% |
| 暂停记录，Today 分类图 | 105.49 | 125.46 | 0.31% |
| 暂停记录，首次关回托盘 | 12.31 | 49.56 | 0.19% |
| 暂停记录，15 轮后回托盘静置 60 秒 | 12.27 | 49.61 | 0.21% |
| 记录中，Today 关回纯托盘 | 24.73 | 150.66 | 0.26% |
| 记录中，固定展开的 Mini，打开 Today 前 | 92.99 | 224.55 | 0.68% |
| 记录中，关回同一个 Mini | 104.46 | 238.31 | 0.99% |

纯托盘重开 Today 到可读排行，第 3、8、15 轮分别为 663、662、663 ms。保留 Mini 时沿用同一个 HWND 和渲染进程。单次关回 Mini 的进程树私有提交比打开 Today 前高 11.47 MiB。另在暂停记录的测试库固定 Mini 并开关 Today 15 次，目标句柄始终为一对；第 3、8、15 次关窗后 300 ms 的渲染进程总句柄均为 718，私有提交分别为 122.68、114.33、123.31 MiB。这 15 轮未观察到逐轮线性增长。短时 CPU 读数仅用于这次生命周期复验。

记录连续性由只读 SQLite 连接核对。固定前台应用的活动会话 ID 全程为 3，关回纯托盘后最后成功采样时间前进 30.535 秒，关回原来固定的 Mini 后又前进 30.468 秒。独立复跑 `today-20261111T111250.969Z` 的这两段分别前进 30.650 和 30.599 秒。其 `recording.json` 保留了进度和退出后的数据库读数：同一条会话已封口，结束时间比最后一次成功采样晚 1.016 秒。

在交互式 Windows 桌面的 `desktop/` 目录运行下列测试。前两项分别输出本机 Direct3D 对照计数及两组逐轮进程快照。资源测试使用第 4 节的 Windows 采样器，原始文件位于 `artifacts/runtime-smoke/` 的对应运行目录。

```powershell
cargo test --locked -p patina-gpui --test today graphics_handles -- --ignored --nocapture
cargo test --locked -p patina-gpui --test today window_handles -- --ignored --nocapture
cargo test --locked -p patina-gpui --test today mini_window_handles -- --ignored --nocapture
cargo test --locked -p patina-gpui --test today renderer_recovery -- --ignored
cargo test --locked -p patina-gpui --test today main_window_lifecycle -- --ignored --nocapture
```

窗口进程拆分后，原生工作区测试和 Clippy 通过，Mini 生命周期、排行编辑、窗口故障恢复均通过。仓库完整检查通过 232 项浏览器用例、Tauri Rust 回归（含原生探测进程回收）和 Clippy，最后在依赖审计处失败。告警为分支基点已锁定的 `rustix 1.1.4`（`RUSTSEC-2026-0486`）。

2026-11-12，Tauri 锁文件将 `rustix` 升至修复版 `1.1.6`，与 GPUI 工作区一致。`pnpm run check:dependencies` 联网复验通过，该告警已解除。

## 6. History、数据、分类、设置与关于

五页均已接入 GPUI 主窗口。下表列出在独立 SQLite 库上操作过的路径及仍需对照的功能。

| 页面 | 已验证的操作与读数 | 仍需完成 |
| --- | --- | --- |
| 历史 | 从侧栏进入，前后切日，在应用与分类时间轴之间切换，打开时间线缩放弹窗，改变最短时长。从历史与 Today 打开 Studio，核对标题样本的日期范围。含时段导入的样本日总量为 72 分钟，其中可定位的时间线为 70 分钟。 | 时间轴模式偏好持久化、网站历史视图、关联成员的来源标识及完整标题分组与现版逐项对照。 |
| 数据 | 七天总量 1 小时 40 分，选 Studio 后 1 小时 15 分，切到三十天保留选择。可按锚点日期选择自然周、月或年。Office 为 20 分，空网站分组为零。从日读数进入应用详情。应用与网站分别消费共享 SQLite 聚合查询。 | 所选对象热力图、网站详情及无障碍图表交互。 |
| 分类 | 双列应用卡片中改分类，取消后恢复；修改名称与分类并保存，Today 排行和重开页面都读到新名称。创建自定义分类后可直接分配并保存。多项改动在一个 SQLite 事务内提交，遇到冲突时先前的写入一并回滚。 | 应用关联、分类合并/删除、网站分类及删除前的记录预览。 |
| 设置 | 时间规则和主题支持保存与取消。「配色方案」分别预览和保存浅色、深色预设。常驻设置控制关窗、托盘和启动行为。网页同步和远程推送随记录进程运行。「存储」提供导出与导入、本地与 WebDAV 快照、定时任务配置、历史清理和数据库目录迁移。更改数据目录后重启生效，插件和本机凭据保留在配置目录内。 | 状态展示、星期与时间选择器已接入；真实 WebDAV 故障与重试状态仍需发布前验收。 |
| 关于 | 版本展示只保留版本号；反馈与赞助使用双卡片布局，隔离测试验证二维码说明、品牌入口和关闭返回。 | 原生更新详情、进度、失败重试与安装返回页面已接入；更新测试程序被火绒隔离，完整安装更新链路仍待验收。 |

本分支的 Tauri 设置、关于和更新页面及专用调用链已移除。旧实现可在 `tauri-maintenance` 查阅。共享设置、主题、语言、导入导出与备份模块继续服务原生窗口和保留的 Tauri 功能；二维码与商店图片由原生资源目录持有。灵动视效已移除，保留系统减少动态效果偏好。

2026-11-16，GPUI 网页同步通过 `services::settings_services` 原生验收，覆盖安装指南、手动安装入口、Token 轮换、本地请求、关窗后台运行及重启恢复。Tauri 网页同步设置面板、安装指南和专用轮询已移除，同时删除连接快照命令、权限及专用状态缓存；GPUI 使用的三张商店图片和共享文案保留。网页记录、共享设置及历史、数据页的网页展示保留。剩余设置保存只提交实际修改的字段，不再整理网页同步 Token 或启用状态。清理后 Settings 分块为 15.46 KiB gzip，预算从 24 收紧至 16 KiB，保留至少 3% 余量；入口与总预算不变。

2026-11-16，GPUI 四种语言的选择、保存和切页通过 `repeated_sidebar_navigation_keeps_window_alive` 原生复验。Tauri 语言选择控件及专用预览状态已移除；已保存语言的加载、资源失败回退和多语言文案保留。设置页继续保留动态效果与存储入口，保存动态效果时不改写语言。共用下拉框的键盘回归由独立控件 fixture 覆盖。

2026-11-17，GPUI 的 `storage::settings_storage_card` 和 Recorder 的 `storage::storage_round_trip_and_migration` 复验通过，覆盖存储弹窗的打开、关闭与焦点恢复，以及历史清理和数据目录迁移。Tauri「清除历史记录」入口、范围弹窗和专用前端调用链已移除；保留共享 Rust 清理实现、GPUI 文案，以及匿名活动和 Mini 刷新验收仍使用的按时间删除命令。Tauri 存储页的导入导出、备份恢复、定时任务与目录管理入口保留。

GPUI 的[常驻设置验收](../../desktop/patina/tests/pages/resident.rs)、[服务设置验收](../../desktop/patina/tests/pages/services.rs)和[配色方案验收](../../desktop/patina/tests/pages/schemes.rs)均使用独立测试配置。记录设置和关于页由[原生页面测试](../../desktop/patina/tests/pages.rs)中的 `settings_navigation`、`about_navigation` 验证；本轮删除前两项均已通过。

2026-11-17，设置与关于的剩余交互迁移后，隔离桌面的 `settings_navigation`、`about_navigation`、`services::settings_services`、`storage::settings_storage_card` 通过，覆盖即时语言预览与取消、双卡片弹窗、服务设置、导出日历、字段分组、子弹窗返回和焦点。Recorder 的存储往返测试验证导出偏好、一次性更新返回记录、数据库与备份目录迁移；导出范围与格式单元测试通过。旧外壳的无头导航、多语言、字体排版、类型、接口和本地化检查通过，相关原生代码的 Clippy 通过。

生产构建与包体预算检查通过。删除设置、关于及其专用弹窗的分块检查；工具仍使用的日历、分段选项、下拉框和时间选择器继续独立分块。首屏 JS/CSS 为 157.60 KiB gzip，总 JS/CSS 为 230.85 KiB gzip，聚合预算未上调。

更新专用测试在进入测试函数前被火绒删除，检测名为 `Trojan/ShellLoader.gx`；本轮不将编译结果计作更新运行验收，也不将该告警判定为误报。安装后的返回页面与完整升级流程仍由发布验收跟进，未恢复隔离文件或添加排除项。

### 同机原版对照

对照使用第 1 节的 Tauri 程序、同一个英语样本库、1375 × 920 物理像素客户区和 120 DPI。原版控件与新版定位结果分别保存在 `today-20261111T094101.988Z/original-pages.json` 和 `native-layout-comparison.json`。五个页头的标题起点同为 (297, 132)。History 的当天时间轴标题纵坐标为原版 245、GPUI 244，当日摘要为 454、当日活动为 673。坐标比较之外还实看了两版窗口，按原版补入图标侧栏、数据趋势曲线与热力图。工具页继续保留在 Tauri。

### 切页与关窗资源

布局调整后的运行目录为 `artifacts/runtime-smoke/history-20261111T144539.816Z/`。每种状态采集整棵进程树 30 秒，间隔 5 秒。记录已暂停，测试用同一主窗口往返 History 和 Today 五轮，最后关窗，确认渲染进程退出后才采集托盘。

| 状态 | 私有提交中位数 | 工作集中位数 | 平均单核 CPU |
| --- | ---: | ---: | ---: |
| History 静置 | 117.77 MiB | 142.96 MiB | 0.52% |
| 五轮后切回 Today | 118.78 MiB | 144.51 MiB | 0.78% |
| 关闭回托盘 | 12.43 MiB | 51.14 MiB | 0.26% |

同一版随后用固定前台样本开启记录（`today-20261111T153252.810Z`）。主窗关回托盘后，整棵进程树私有提交为 24.84 MiB，工作集为 156.42 MiB，单核 CPU 为 0.62%。关回固定 Mini 后分别为 104.98 MiB、248.52 MiB、0.42%；打开主窗前的固定 Mini 为 92.79 MiB、232.53 MiB、0.52%。两种返回状态的采样各覆盖 30 秒。同一个 SQLite 活动会话在托盘与 Mini 中分别前进 30.520 和 30.519 秒，退出后已封口。

五页接入后的句柄复验见 `handles-20261111T153211.705Z`。有、无 UIA 读取的两组各开关 15 次，两组在第 3、8、15 轮关回托盘后均为 271 个句柄，目标 Section 和 Mutant 均为零。固定 Mini 时同一渲染进程保留一对；第 4 至第 15 轮总句柄为 739。

首次复验出现的关窗 panic 已在 `handles-20261112T025024.956Z/native.stderr.log` 重现。该组测试只用 Win32 操作窗口，渲染进程仍收到了 UI Automation 的元素边界请求。AccessKit 0.34.0 的 `BoundingRectangle` 在 HWND 销毁后调用 `ClientToScreen` 并对失败结果执行 `unwrap()`，渲染进程以 `0xC0000409` 退出。日志未标识发起请求的客户端进程。

[Windows 适配器修补](../../desktop/vendor/accesskit_windows/README.md)让这类请求返回 `UIA_E_ELEMENTNOTAVAILABLE`。复验 `handles-20261112T025312.863Z` 和 `handles-20261112T025928.911Z` 使用相同操作。每次有、无 UIA 主动读取各开关 15 轮，每组的渲染进程均正常退出，四份标准错误日志均为空。第 3、8、15 轮的托盘进程均为 273 个句柄，目标 Section 与 Mutant 均为零。两次固定 Mini 各开关 15 轮后，原窗口和固定状态均保留。另连续执行 15 次立即重开与渲染进程恢复测试，各次错误输出均无 panic。

[页面回归](../../desktop/patina/tests/pages.rs)使用独立的临时 SQLite 库，覆盖页面导航、布局对照、精确记录与时段导入、事务冲突回滚。中文空库用例从数据页点击历史，验证“活跃跨度”和“高峰时段”的两个空值都可通过 UI Automation 读取，再通过侧栏返回今天。日常页面交互由测试入口分配临时桌面。以下全套验收命令在[专用 Windows 测试会话](../engineering-quality.md#5-默认验证门槛)中从 `desktop/` 运行。布局对照需要第 5 节基线目录中的 `original-pages.json`、`tauri.json` 和同目录的样本库。

```powershell
$env:PATINA_PAGE_BASELINE = (Resolve-Path ../artifacts/runtime-smoke/today-20261111T094101.988Z/original-pages.json).Path
cargo test --locked -p patina-gpui --test pages -- --include-ignored --test-threads=1
```

### 清理 Tauri Today 后的前端产物

旧 Today 可从 `82978c5f:src/features/dashboard/components/Dashboard.tsx` 查阅。Tauri 的历史页现在是默认入口。历史页仍使用当天聚合缓存作为首次读取的种子；已移除昨天对比的额外读取。旧 Mini 的工具状态按钮仍需打开同一 Tauri 进程的工具面板。

在同机对第 1 节的 Tauri 对照产物和清理后的生产构建使用 `check:bundle` 的 Node gzip 口径，首屏 JS/CSS 从 204.34 降至 194.77 KiB，总 JS/CSS 从 405.14 降至 401.82 KiB。移除同步导入的 Today 后，小时图进入历史页，快捷分类启动器由历史和数据页共享。页头、图表提示、徽标及部分图标随页面按需加载。无需为余下页面在首屏预载这些组件。此处对比本地迁移基线，正式发行基线仍按发布流程记录。

| gzip 分块 | 对照与当前实际值（KiB） | 分块预算调整（KiB） |
| --- | --- | --- |
| 主入口 JS | 53.40 → 46.84 | 65 → 49（−24.6%） |
| 历史页 | 15.28 → 17.09 | 16.4 → 17.7（+7.9%） |
| 对象详情弹窗 | 8.96 → 8.99 | 9.25 → 9.30（+0.5%） |
| 快捷分类启动器 | 原随入口加载，现独立加载 2.60 | 独立上限 2.72 |
| 其余懒加载辅助模块 | 清理后共 8.69，其中启动器占 2.60，其余占 6.09 | 4.36 → 6.30（+44.5%） |

各分块继续保留 3% 余量，首屏、主要懒加载页面和全产物的总上限沿用原值。历史与数据切页继续验证冷启动、缓存交接和对象详情。

清理 Tauri 配色弹窗后，共享主题预设仍在首屏加载。移除设置页的直接消费者会让打包器将预设合入入口；构建配置显式保留原有独立分块，并由源码归属检查约束。入口和总预算不变，主题预设新增单独上限。同环境下恢复旧配色实现作构建对照，入口为 46.83 KiB；清理并固定分块后为 46.75 KiB，主题预设为 2.55 KiB，首屏 JS/CSS 为 194.56 KiB，总产物为 398.97 KiB。配色预览与保存由 GPUI 原生专项验证，Tauri 主题对比度回归使用保留的导出弹窗。

## 后续里程碑

各页先复刻现版 Tauri 的侧栏、页头、面板布局和操作位置。在相同样本、客户区尺寸及 DPI 下逐页对照。工具页之外的页面迁完后，再集中修订 Quiet Pro 与视觉细节。

各页的验收范围与差异见[第 6 节](#6-history数据分类设置与关于)。

长期文档沿用现有位置。产品原则、Quiet Pro 的交互约定和数据恢复规则由两版共用。GPUI 原型的路径、测量结果和待验证行为记在本方案中。

页面专用逻辑随页面维护。多个 GPUI 页面共用的展示逻辑放在 `desktop/patina/src/` 下按用途命名的模块，例如两个页面都需要的时间轴布局可归入 `timeline`。通用控件归 QuietPro，活动时长的计算归记录与数据层。

- [ ] **逐模块核对命名。** 每迁移一个模块，就把含糊、重复或沿用旧框架术语的内部名称改成简短、能说明用途的名字，并同步更新调用方和测试。Rust 命名风格和已发布协议的命名规则见[架构中的命名约定](../architecture.md#45-命名与跨层协议)。

- [ ] 开始迁移一项功能时，先确定用户要完成的操作和已有的数据保障，再核对旧实现的调用方。遇到重复状态、职责混杂或为 WebView 绕行的代码，按实际用途简化，用同一场景验证结果。迁移旧前端 `shared/lib/` 时逐项判断，例如 History 和 Mini 共用的时间线合并规则只保留一份。原生应用的 `lib.rs` 负责入口与装配，接入主窗口时把窗口的创建、重开和释放放到负责其生命周期的模块。
- [ ] GPUI 接替主线前，从中英文 README 和贡献指南走一遍构建、测试、打包与升级流程，替换过时的 Tauri 命令和链接。维护 Tauri 版本时，以对应分支上的文档为准。

- [x] [桌面窗口模块](../../desktop/patina/src/app_windows.rs)管理渲染进程中的 Today 和 Mini 窗口。[常驻进程](../../desktop/patina/src/window_process.rs)处理重开请求和最后一个窗口关闭后的渲染进程回收。
- [x] 主窗口接入历史、数据、分类、设置与关于；Today、历史和数据页共用应用详情入口。
- [ ] 按第 6 节差异表补齐各页，逐项复验原版布局、输入、焦点、数据读数和窗口重建。设置的备份恢复还需用包含专注历史与提醒数据的样本演练。
- [ ] **工具页以外的页面迁完后统一修订 Quiet Pro。** 对照已迁移的主窗口、各页和 Mini，按实际使用情况确定字号、间距、布局密度与控件状态。把共同规则写回现有 Quiet Pro 规范，在仓内组件和各页面落实，并复验键盘操作、明暗主题及缩放显示。
- [ ] **主线接替。** GPUI 接替主线后，在仓库根目录直接运行 `cargo run`，验证 Patina GPUI 应用能按默认方式启动。用已发布版本的数据副本演练升级，验证历史、设置与恢复，再进行桌面生命周期和发布验收。主线切换与发布分别决定。[版本与发布规范](../versioning-and-release-policy.md)
- [ ] **QuietPro 独立。** 当第二个应用要使用现有组件、示例和测试能够独立运行时，再将 crate、通用规范和示例迁到新项目。Patina 改用其版本化依赖，追踪、窗口动作和业务文案继续由应用持有。

工具页已接入专注、提醒和可安装 Rust 面板。当前边界见[GPUI 实验版工具插件](../architecture.md#46-gpui-实验版工具插件)，桌面验收与资源数据见[已归档的执行方案](../archive/2026-11-12-gpui-tools-plugins.md)。
