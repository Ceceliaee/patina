# Changelog

本文件是版本说明的唯一来源。

格式遵循仓库内的 [`docs/versioning-and-release-policy.md`](docs/versioning-and-release-policy.md)。

每个正式版本应同时维护：

- `Release:` 给 GitHub Release 使用的简短摘要。
- `App note:` 给应用内更新弹窗使用的一句话。
- 分类条目保留完整版本记录，供后续追溯和维护使用。

## [Unreleased]

Release: 待定。
App note: 待定。
App note en: TBD.

### Added

### Changed

### Fixed

### Removed

### Internal

## [1.8.5] - 2026-07-20

Release: 新增活动记录导入和连续时间线，升级 SQLite 快照备份、Classification 管理与追踪控制。
App note: 新增活动导入和连续时间线，升级备份恢复、应用管理与排除统计。
App note en: Adds activity import and continuous timelines, with safer backups, app management, and exclusion controls.

### Added

- 设置页新增通用活动记录导入：可预览并导入规范 CSV，也可将 Tai / Taix 数据库安全拆解为规范 CSV；支持精确会话与小时汇总两种粒度、重复检测、导入批次管理和按批次删除，导入结果会进入对应的 Dashboard、History、Data 与 Classification 视图。Refs [#49](https://github.com/Ceceliaee/patina/issues/49)
- History 时间轴新增连续缩放与平移：可通过 1～24 小时滑杆、滚轮和拖动调整时间窗口，并可打开分轨列表查看同一窗口内的应用或分类活动。Refs [#6](https://github.com/Ceceliaee/patina/issues/6)

### Changed

- Classification 现在会自动加载全部仍有实际记录的应用，不再受 30 天范围或旧的可见数量上限约束；普通应用不再使用内置静态名称与分类映射，已有用户设置保持不变。Refs [#51](https://github.com/Ceceliaee/patina/issues/51)
- 系统性优化 Quiet Pro 界面组件与交互：统一按钮、搜索、日历、选择器、对话框、Tooltip 和 Toast，并在 Settings、History、Data 与 Tools 等页面补齐悬浮、聚焦、禁用、加载和错误反馈状态。
- 本地与 WebDAV 备份改用 SQLite 一致快照；覆盖恢复可在失败时回滚，合并恢复会保留当前数据并导入非重复数据。旧结构化备份兼容恢复至 2026 年 10 月 18 日，恢复后请立即创建当前格式的新备份。Refs [#38](https://github.com/Ceceliaee/patina/issues/38)
- 网页同步新增 QQ 浏览器识别，并统一应用与网页域名的“排除统计”语义：排除后停止追踪并隐藏已有历史，恢复后重新显示历史；排除期间不补记，底层数据不会删除。Refs [#48](https://github.com/Ceceliaee/patina/issues/48)

### Fixed

- 修复“静默启动”依赖“开机自启动”的问题；两项设置现在可以独立启用，手动启动与开机启动都会遵守静默启动偏好，隐藏启动固定进入托盘并保留安全恢复入口。Refs [#54](https://github.com/Ceceliaee/patina/issues/54)

### Removed

### Internal

- 重整前后端数据访问、读模型与运行时边界，并为备份恢复、活动导入、History 快照、Classification 完整目录和排除统计补充发布级回归验证。

## [1.8.4] - 2026-07-13

Release: 修复 v1.8.3 引入的存储操作重启卡住、窗口恢复异常及缓存目录切换后页面状态丢失。
App note: 修复 v1.8.3 中存储操作重启卡住，并确保重启后回到原页面。
App note en: Fixes a v1.8.3 regression that could hang storage-action restarts or lose the previous page.

### Added

### Changed

### Fixed

- 修复 v1.8.3 中清理 WebView 缓存、更改缓存目录或数据目录后，“重启并应用”可能卡住、停留在任务栏或没有回到可见主窗口的问题。
- 修复更改缓存目录后重启到默认首页的问题；迁移缓存目录时会保留恢复原页面所需的持久化 WebView 状态，同时不迁移可重新生成的缓存。

### Removed

### Internal

- 存储重启改用可从 IPC 正常返回的重启请求，并统一复用主窗口显示、取消最小化、前台激活和焦点恢复路径。
- 为存储重启、自动启动边界、窗口恢复及 WebView 持久化状态迁移补充回归测试。

## [1.8.3] - 2026-07-13

Release: 新增四格式活动记录导出与标题记录控制，并改进存储操作、排除规则和后台资源占用。
App note: 新增四格式数据导出和标题记录控制，改进存储操作与后台资源占用。
App note en: Adds four-format data export and title controls, with safer storage actions and lower background resource use.

### Added

- 设置页新增活动记录导出，可按时间范围和每种格式的默认字段导出 CSV、Markdown、Parquet 或 SQLite；支持在 32 个规范字段中按分组选择，导出结果使用稳定字段顺序与格式契约。
- 设置页、分类页和托盘新增全局、应用与网页标题记录控制；关闭后停止写入相应新标题，同时保留已有历史记录。
- “关于”页新增问题反馈渠道选择弹窗，可在 GitHub Issues 与 QQ 频道之间选择，并适配中英文和深浅主题。

### Changed

- 更改数据目录、恢复默认数据目录、清理 WebView 缓存等需要重启的存储操作，改为确认后立即安全重启并应用；取消操作不写入待处理状态。
- “启动时最小化”更名为“静默启动”；开机自启动且启用该选项时，“低耗后台”复用与手动进入后台相同的三分钟 WebView 回收策略，首次安装默认开启低耗后台，已有用户选择保持不变。

### Fixed

- 修复已排除应用或网页域名仍会写入新会话的问题；排除规则现在同时约束桌面追踪和网页活动写入。
- 修复网页同步完整 URL 丢失、升级或冷启动可能清理现有分类配置、Deflated 格式有效备份无法识别，以及远程状态接口跨域读取失败的问题。Refs [#36](https://github.com/Ceceliaee/patina/issues/36), [#37](https://github.com/Ceceliaee/patina/issues/37), [#38](https://github.com/Ceceliaee/patina/issues/38)

### Removed

### Internal

- 数据导出收口到统一 Rust owner 与 32 字段规范契约，并补充四种格式、字段默认值、空值转义、长文本和真实浏览器交互回归。
- 标题记录、排除规则、存储重启和主窗口后台回收均补充纯决策与生命周期测试，避免迟到设置、重复启动或销毁竞态覆盖用户最新意图。

## [1.8.2] - 2026-07-05

Release: 新增灵动视效开关，并改进数据页、历史时间线与页面恢复体验。
App note: 新增灵动视效，数据页、历史时间线和页面恢复更顺手。
App note en: Adds optional dynamic effects, with smoother Data, History, and page restore behavior.

### Added

- 设置页“外观”新增“灵动视效”开关，启用后侧边栏高亮、页面切换、弹窗、toast、工具页和分类页切换会使用更明显但仍克制的动效。

### Changed

- 应用会记住上次停留的主页面，普通启动和更新重启都会尽量回到原页面；低耗后台的前端缓存、主窗口 WebView 和小组件空闲释放统一缩短到 3 分钟，追踪继续保留。
- 数据页减少常规进入时的可见 loading，应用趋势拆成更轻的渲染路径，搜索和热力图悬浮提示响应更稳。
- 历史时间线弹窗可在居中日期切换器中前后切换日期，并同步外层历史页日期；网页时间线改用域名作为主行标题，减少标题变化造成的重复分组。

### Fixed

- 修复自定义分类保存后重新进入分类页可能显示为 `category_...` 新分类的问题，并保守恢复可唯一匹配的截断分类引用。Refs [#32](https://github.com/Ceceliaee/patina/issues/32)
- 修复网页时间线标题详情与外层行时长可能不一致的问题，包括短标题片段、无标题网页和同域名多标题合并场景。
- 修复历史时间线弹窗切换日期或应用 / 网页模式时高度可能跳动，以及设置页本机目录和设置快照刷新后状态可能滞留的问题。

### Removed

### Internal

- 持久化写入从前端直写收口到 Rust command 与事务 / 维护服务边界，降低设置、分类、备份和运行时状态写入分散风险。
- 启动预热、后台资源释放、运行时诊断和 updater 状态流补充边界与回归测试，约束长期资源增长。
- 灵动视效使用共享 motion token / CSS 体系，并移除 `framer-motion` 运行时依赖。
- 新增质量 typecheck、热点和 Rust boundary 检查，并归档本轮质量、资源和动效执行计划。
- Verify 与 Publish Release 工作流拆分质量门、构建、GitHub Release 和 R2 镜像 job，失败重跑时可只重跑对应环节。
- Patina Web Sync 扩展源码与发布流程迁出到独立公开 companion 仓库，Patina 主应用发布链不再打包浏览器扩展附件。

## [1.8.1] - 2026-06-30

Release: 新增 Firefox 系网页同步扩展，并改进分类管理、数据/历史响应和资源占用。
App note: 新增 Firefox 系网页同步扩展，分类管理和数据回看更顺手。
App note en: Adds Firefox-family web sync, with smoother classification and Data/History views.

### Added

- 新增 Firefox 系 Patina Web Sync 扩展，并允许 Firefox、Zen、Floorp、Iceweasel 前台窗口写入网页活动；正式发布使用 Mozilla `unlisted` 签名 `.xpi` 自分发。Refs [#29](https://github.com/Ceceliaee/patina/issues/29)
- 分类页支持重命名自定义分类、同名合并，并新增独立“已排除”筛选，管理应用和网页规则更清楚。

### Changed

- Chromium 系网页同步白名单改为明确候选集，并补充 Thorium、Cent Browser、Catsxp 与新版 360 极速浏览器 X。
- 数据页和历史页优化读模型、预热和图标加载，减少打开页面、切换视图和查看长时间范围时的等待。
- 工具运行时、追踪暂停状态和图标 / favicon 缓存改为更按需的唤醒与复用，降低后台资源占用。

### Fixed

- 修复 Windows 可执行名大小写不一致时，应用图标可能缺失或重复加载的问题。
- 设置页网页同步说明细化 Chromium / Firefox 系安装步骤，并稳定本机目录加载前的禁用按钮占位。

### Removed

### Internal

- 发布检查和 GitHub Release workflow 现在校验两套浏览器扩展，发布 Chromium zip，并签名上传 Firefox `.xpi`。
- 更新中英文 README 与页面截图，跟随当前 Dashboard、History、Data、Classification、Settings、Tools 和 About 界面。

## [1.8.0] - 2026-06-24

Release: 新增历史时间轴缩放、网页同步向导和本机目录管理，并打磨核心页面文案与布局。
App note: 新增时间轴缩放、网页同步向导和本机目录管理，核心页面更清晰。
App note en: Adds timeline zoom, web sync guidance, and local directory management, with clearer core pages.

### Added

- 历史页新增独立时间轴缩放弹窗，首装默认 `24h`，之后记住上次选择的缩放倍率，并支持 `24h / 12h / 8h / 4h / 1h` 离散缩放、同一时段展开和时间窗口平移，便于细看短会话与高频切换。Refs [#6](https://github.com/Ceceliaee/patina/issues/6)
- 设置页新增网页同步向导和本机目录管理，可引导完成 Patina Web Sync 配置，并查看、打开、迁移或清理安装目录、数据目录和 WebView 缓存。Refs [#6](https://github.com/Ceceliaee/patina/issues/6), [#20](https://github.com/Ceceliaee/patina/issues/20)

### Changed

- 核心页面文案、设置说明和 Quiet Pro 卡片间距进一步统一；数据趋势和应用趋势进入页面时预先稳定图表尺寸，减少首次打开时的跳动。
- 托盘右键菜单简化为打开主界面、暂停或恢复追踪、退出应用，追踪项会根据当前状态动态显示。
- 时间线显示分钟改为历史页时间线弹窗内的局部控制，设置页不再暴露全局最短时长设置。Refs [#6](https://github.com/Ceceliaee/patina/issues/6)

### Fixed

- 修复网页同步关闭时，历史页当日分布无法保留“分类”视图的问题，并稳定重复触发时的全局提示复用。

### Removed

- Chromium 扩展发布 zip 不再附带单独的中英文使用说明文件；网页同步配置说明统一由 Patina 设置页承载。

### Internal

- 修复发布准备 workflow 的 tag checkout 校验路径，避免 release 前验证取错引用。
- 按当前构建产物重整 bundle budget 检查，分别约束初始 JS+CSS、懒加载 JS、页面 chunk、支持 chunk 与文案来源归因，降低后续体积增长时的定位成本。
- 拆分 History、Data、App Mapping、Settings 文案、浏览器 smoke 测试、备份归档和工具仓储等高热点模块，并新增代码质量热点报告，降低后续维护和回归验证成本。
- Chromium 扩展 README 改为项目维护说明，并恢复中文项目 README；发布打包脚本只校验和打包扩展运行文件。

## [1.7.0] - 2026-06-18

Release: 新增可选网页记录，并改进分类、历史回看和数据热力图。
App note: 新增网页记录，并改进分类、历史回看和数据热力图。
App note en: Adds optional web activity recording and improves classification, History, and Data heatmaps.

### Added

- 新增可选网页记录第一版：可通过 Chrome / Chromium 插件把前台网页的域名、标题与时间写入 Patina，历史页支持网页排行与网页时间线详情。Refs [#6](https://github.com/Ceceliaee/patina/issues/6)
- 新增网页记录设置、浏览器插件 token 鉴权与 Chrome MV3 插件源码；网页记录仅保存域名、标题与 favicon。

### Changed

- “应用”页面调整为“分类”，并增加“应用 / 网页”切换，用于分别整理应用和网页域名的分类、颜色与记录规则。
- 历史页时间线、当日活动图和数据页热力图改用更一致的 Quiet Pro 控件与悬浮提示样式；数据页活动热力图新增“每日 / 每周”切换，每周视图按周总量显示柱高，每日视图在近一年范围隐藏未来日期格子，固定年份范围仍保留完整年份网格。

### Fixed

- 修复历史页时间线短会话合并后的跨度、分钟显示、24:00 终点和悬浮窗尖角对齐问题；合并后少于 30 秒的时间段不再显示在时间线上。
- 修复当日活动和趋势悬浮提示中亚秒级时长显示为 `<1s`、英文界面历史页时间跨度使用 AM / PM 的问题，现在统一显示为 `0m` 和 24 小时制。

### Removed

- 移除设置页的本机状态读取入口、旧通用本机接口配置与相关兼容路径；网页同步改为独立 HTTP 桥接。

### Internal

- 收口 GitHub Actions 发布 workflow：版本文件和 changelog 由发布准备提交承担，Actions 只从已有 tag 校验、构建和发布，避免自动生成 release commit。
- 新增 `web_activity_segments` SQLite 迁移、网页活动 Rust engine、备份恢复清理覆盖、本机接口浏览器角色隔离，以及网页历史和分类回归测试。
- 补充历史时间线、时间格式、数据热力图、当日活动与应用过滤的回归测试。

## [1.6.0] - 2026-06-13

Release: 结束旧 Time Tracker 兼容窗口，并改进历史回看、应用搜索与追踪稳定性。
App note: 1.5.2 版本前的用户请先安装 1.5.2 完成本地数据迁移；本版优化历史回看、应用搜索与关于页体验。
App note en: Pre-1.5.2 users: install 1.5.2 first to migrate local data. Improves History review, app search, and About.

### Added

- 历史页新增横向时间轴，可按应用或分类快速扫描当天活动分布，并打开弹窗查看合并后的时间线片段。Refs [#6](https://github.com/Ceceliaee/patina/issues/6)

### Changed

- 清理版本只使用 Patina 当前身份、`%APPDATA%\Patina` 和 `patina.db`；已经升级到 `1.5.2` 并成功启动过的用户，本地计时数据无需额外操作。
- WebDAV 远程备份现在只使用当前 Patina credential target 和当前 Patina index 格式；已保存的 `/TimeTracker` 会被当作普通显式远端目录值，不再自动改写成 `/Patina`。
- 历史页调整为弹窗时间线列表、左侧当日摘要与当日活动、右侧当日分布的回看结构；新增总活跃时长、活跃跨度和高峰时段，并记住“应用 / 分类”显示模式。Refs [#8](https://github.com/Ceceliaee/patina/issues/8)
- 应用页搜索框现在可同时搜索应用和分类名称，方便筛出某个分类下记录过的软件并继续整理或改名。Refs [#6](https://github.com/Ceceliaee/patina/issues/6)
- 追踪健康状态改为读取轻量运行时快照，并避免前端健康轮询重叠，降低后台健康检查对长期追踪的额外压力。
- 关于页统一 GitHub Star、问题反馈和赞助入口的图标与颜色；更新面板的赞助入口改为打开应用内赞助弹窗。
- Patina 自身进程现在会作为可记录应用保留，并统一显示为 Patina，避免被旧身份过滤规则当作系统噪音。

### Fixed

- 修复历史页横向时间轴未按“活动保持时间”合并短空档两侧同一应用或分类分段的问题。
- 修复数据页趋势图进入页面时可能闪动，以及应用趋势搜索无匹配或清空搜索后列表高度与选中状态可能不稳定的问题。
- 修复小时活动分类堆叠柱图 tooltip 可能遮挡图表或随高度变化漂移的问题。
- 修复会话读模型可能让目标时间范围外的会话进入编译流程，影响历史或数据统计边界的问题。
- 修复工具页软件提醒允许输入未记录软件并创建无效规则的问题。
- 修复 Windows 上按 `Win+D` 显示桌面后，Patina 主窗口可能无法从任务栏或托盘重新打开的问题。Refs [#18](https://github.com/Ceceliaee/patina/issues/18)

### Removed

- 移除旧 `com.timetracker*` identifier 识别、旧 `%APPDATA%\com.timetracker\timetracker.db` 自动迁移、旧迁移状态文件写入和旧目录/WebView 兼容清理入口；清理版本不再从迁移前版本直接自动迁移本地数据库。
- 移除旧 WebDAV credential target fallback、旧 `TimeTrackerBackup` 本地备份恢复兼容、旧 `Time Tracker` 远程备份 index 合并和 `/TimeTracker` 自动归一到 `/Patina` 的兼容逻辑。
- 移除旧 Time Tracker 安装器 hook、旧 autostart 清理入口，以及前端 `time-tracker:*` 本地偏好 key 迁移逻辑。

### Internal

- 完成旧身份兼容清理版本的版本号、发布说明和长期版本文档同步。
- 将工具备份恢复读写逻辑从 Tools repository 拆出到独立模块，并补充 History timeline、追踪健康轮询和工具提醒表单回归测试。
- 收紧 bundle budget 检查和 Vite 依赖扫描入口，避免构建产物被误识别为额外入口并提升发布前质量门槛稳定性。
- 更新中英文 README 与长期文档，补齐工具页在当前信息架构中的位置、兼容清理边界和发布准备口径。
- 发布脚本将应用内更新说明长度上限调整为中文 `60` 字、英文 `120` 字，方便在迁移提醒场景下保留必要上下文。

## [1.5.2] - 2026-06-10

Release: 将底层应用身份与本地数据目录迁移到 Patina。
App note: 本地数据会自动迁移到 Patina 目录。
App note en: Local data now migrates automatically to Patina folders.

### Added

- 暂无。

### Changed

- 底层应用身份与用户可见数据目录统一迁移到 Patina；新数据写入 `%APPDATA%\Patina`，数据库文件名改为 `patina.db`。
- WebView2 数据根目录改为 `%LOCALAPPDATA%\Patina`，实际运行缓存为 `%LOCALAPPDATA%\Patina\EBWebView`，避免继续生成反向域名命名的用户可见目录。
- 旧 `Time Tracker` 本地备份格式和旧 WebDAV 远程备份入口在迁移窗口内继续兼容；恢复后会按 Patina 身份继续保存。

### Fixed

- 从旧 `%APPDATA%\com.timetracker\timetracker.db` 自动迁移到 `%APPDATA%\Patina\patina.db`，迁移成功并验证通过后会清理已知旧数据文件和旧 WebView cache。
- 旧 WebDAV 凭据会在读取成功后迁移到新的 Patina 凭据目标，避免远程备份设置在升级后丢失。

### Removed

- 暂无。

### Internal

- 为 D+10 清理版本保留旧身份兼容代码的退出边界；迁移窗口结束后将移除旧身份、旧数据库名、旧备份 identity 和旧 credential target 的兼容入口。

## [1.5.1] - 2026-06-10

Release: 修复更名后旧 Time Tracker 自启动仍可能启动 1.4.3 的问题。
App note: 修复旧版本自启动问题。
App note en: Fixes legacy Time Tracker autostart after the rename.

### Added

- 暂无。

### Changed

- 新安装包主程序名从 `patina.exe` 调整为 `Patina.exe`，开始菜单目录固定为 `Patina`。

### Fixed

- 修复 `Time Tracker` 更名为 `Patina` 后旧安装目录、旧快捷方式和旧开机自启入口仍可能启动 1.4.3 的问题；新安装包会清理旧入口，运行时也会移除旧自启动注册值。

### Removed

- 暂无。

### Internal

- 暂无。

## [1.5.0] - 2026-06-09

Release: 产品更名为 Patina，并新增轻量时间工具页面。
App note: 软件已更名为 Patina，并新增提醒、计时器和番茄钟工具。
App note en: The app is now Patina and adds reminders, timers, and Pomodoro tools.

### Added

- 新增 `Tools / 工具` 页面，提供提醒、正/倒计时和番茄钟三个轻量主动时间工具；工具状态可通过侧边栏低噪音入口返回。Refs [#14](https://github.com/Ceceliaee/patina/issues/14)

### Changed

- 产品显示名、仓库、发布标题、安装包名称和应用内链接从 `Time Tracker` 更新为 `Patina`，同时保留原 Tauri identifier 与 `timetracker.db`，保证旧版本升级连续性。
- WebDAV 固定远端目录从 `/TimeTracker` 更新为 `/Patina`；旧远端备份会并入恢复列表，避免升级后看不到历史远端备份。
- 工具到期提醒改为用户主动启动后的固定反馈；设置页和全局设置 schema 不再承载工具偏好，具体工具时长与操作留在 Tools 页面。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 新增工具页 SQLite 表、Rust runtime/IPC、前端 runtime gateway、备份恢复覆盖和 Tools smoke 验证，并将首包 bundle 预算校准到新入口后的实际范围。
- 更新发布脚本、GitHub Actions、README、issue 模板和长期文档中的 Patina 命名规则。

## [1.4.3] - 2026-06-07

Release: 新增低耗后台模式，降低空闲界面资源占用。
App note: 新增低耗后台，并优化挂件与后台资源占用。
App note en: Added low-footprint background mode.

### Added

- 设置页“常驻”新增“低耗后台”开关。开启后，关闭到托盘并后台闲置时会释放主界面内存，托盘和后台记录继续保留；重新打开主界面时会重新加载。

### Changed

- 挂件隐藏后会在后台闲置时释放挂件窗口资源，减少不使用挂件时的 WebView 占用。
- 挂件图标改为按需读取并缓存，减少挂件界面接收的重复图标数据。
- 优化 Windows 前台窗口和图标查询路径，减少长期运行时的重复系统查询与资源占用。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 新增开发诊断接口，用于观察 WebView 数量、线程数、句柄数和进程内存等资源状态。
- Windows 前台窗口、图标、句柄、GDI 与 COM 资源查询补充 RAII guard 和缓存统计，降低后续资源回归风险。
- 浏览器 UI smoke 首屏等待在 CI 中更稳，减少冷启动导致的误失败。
- 归档资源性能、WebView 内存与低耗后台执行方案。

## [1.4.2] - 2026-06-06

Release: 提高长时间运行稳定性，减少前台探测卡住造成的异常占用。
App note: 提高长期计时稳定性。
App note en: Improved long-run tracking stability.

### Added

- 暂无。

### Changed

- 应用在后台停留较久后返回浏览类页面时会回到今天页，减少长时间挂起后继续展示旧页面状态的困惑。
- 启动预热与页面缓存释放更稳定，减少长时间运行时不必要的后台资源占用。

### Fixed

- 修复前台窗口探测超时后仍可能持续创建后台探测任务的问题，降低线程、句柄和内存异常增长风险。Refs [#15](https://github.com/Ceceliaee/time-tracking/issues/15)
- 前台探测卡住时改为有界恢复与缓存 fallback，短暂异常静默恢复，长期不可恢复时复用现有红色状态灯提示异常，避免把未知前台时间错误记入旧应用。Refs [#13](https://github.com/Ceceliaee/time-tracking/issues/13)、[#15](https://github.com/Ceceliaee/time-tracking/issues/15)

### Removed

- 暂无。

### Internal

- 补充前台探测运行时诊断字段、widget hard degraded 显示测试，以及完整 `check:full` 发布验证。
- 归档前台探测自恢复执行方案。

## [1.4.1] - 2026-06-04

Release: 改进数据页首屏响应与后台缓存释放。
App note: 改进数据页打开体验与后台缓存释放。
App note en: Improved Data page opening and background cache release.

### Added

- 暂无。

### Changed

- Data 页在前台打开时会预热首屏所需的趋势与热力图快照，并复用轻量首屏缓存，让常规进入 Data 页时不再显示可见 loading。

### Fixed

- 限制 Data 页趋势快照与热力图会话缓存规模，并在应用进入后台一段时间后释放 Data 重型缓存，降低长时间运行后的资源增长风险。Refs [#13](https://github.com/Ceceliaee/time-tracking/issues/13)
- 修复更新状态订阅在组件卸载后才完成注册时可能未及时释放监听的问题。

### Removed

- 暂无。

### Internal

- Data 首屏缓存以字段校验和缓存重建为准，不引入版本化兼容迁移路径。
- 归档 Data 前台预热与无可见 loading 执行计划。

## [1.4.0] - 2026-06-04

Release: 新增 WebDAV 远程备份，并改进自动更新备用链路。
App note: 新增 WebDAV 远程备份。
App note en: Added WebDAV remote backups.

### Added

- 新增 WebDAV 远程备份目标，可将结构化备份上传到用户自己的 WebDAV 存储，并从远端备份下载、预览后恢复。Refs [#5](https://github.com/Ceceliaee/time-tracking/issues/5)

### Changed

- 改进应用内更新链路，保留 GitHub Releases 作为主更新源，并支持 R2 备用更新镜像，降低 GitHub 链路偶发失败对自动更新的影响。Refs [#12](https://github.com/Ceceliaee/time-tracking/issues/12)

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 暂无。

## [1.3.0] - 2026-06-01

Release: 新增本机接口与数据页历史范围选择，方便本地集成和回看更长时间段。
App note: 新增本机接口和历史范围选择。
App note en: Added local status endpoint and custom history ranges.

### Added

- 数据页活动趋势与应用趋势的中间范围标签现在可以打开日历弹层，选择自然周、自然月、自然年或任意自定义历史区间（[#6](https://github.com/Ceceliaee/time-tracking/issues/6)）。
- 设置页当时新增默认关闭的同机集成端点；该能力已在后续版本移除（[#4](https://github.com/Ceceliaee/time-tracking/issues/4)）。

### Changed

- 数据页保留近 7 天、近 30 天和近一年的快捷切换；应用特殊范围后，任一外侧箭头可快速恢复近 7 天（[#6](https://github.com/Ceceliaee/time-tracking/issues/6)）。

### Fixed

- 修复少数窗口切换场景下，活动计时可能无法及时更新的问题。

### Removed

- 暂无。

### Internal

- 数据页趋势与热力图改用最小聚合 DTO，并在相同日期区间之间复用趋势快照；长区间查询不再额外读取 `session_title_samples` 标题详情或 History 时间线字段。
- tracking runtime 启动新会话时会在同一 SQLite 事务内封口旧 active session 及其标题样本，避免触发单一 active session 唯一索引冲突。

## [1.2.0] - 2026-05-31

Release: 增强活动回看与应用分类控制，新增按小时查看分类构成和从数据页直达历史详情。
App note: 增强活动回看与分类控制。
App note en: Improved activity review and app classification control.

### Added

- 支持从数据页双击活动热力图、日粒度活动趋势和应用趋势中的日期，直接打开对应日期的历史详情（[#8](https://github.com/Ceceliaee/time-tracking/issues/8)）。

### Changed

- Dashboard“今日活动”和 History“当日活动”支持切换分类分层小时柱，便于查看每小时活动构成；所选模式会在页面之间同步，并在重新打开应用后保留（[#3](https://github.com/Ceceliaee/time-tracking/issues/3)、[#6](https://github.com/Ceceliaee/time-tracking/issues/6)）。
- 应用分类改为由用户手动确认；升级时会保留历史记录中已有应用的旧版自动分类结果，此后新出现且未手动分类的应用统一进入“未分类”，不再持续通过内置映射或关键字规则自动归类（[#6](https://github.com/Ceceliaee/time-tracking/issues/6)）。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 增加一次性分类兼容桥接，升级时原子保存历史应用分类和完成标记，兼容窗口结束后可独立移除。
- 补充分类迁移、设置持久化、主题初始化、数据热力图交互和小时分类分层的回归验证。

## [1.1.3] - 2026-05-30

Release: 提高长期运行稳定性，降低 Windows 音频和窗口探测导致异常占用的风险。
App note: 提高长期计时稳定性。
App note en: Improved long-run tracking stability.

### Added

- 暂无。

### Changed

- 将音频与系统媒体持续参与探测改为后台快照源，主计时循环只读取最近快照，减少 Windows API 卡顿对普通计时的影响。

### Fixed

- 降低 Explorer shell surface 和失败图标提取反复触发高成本窗口图标 fallback 的风险。
- 降低 tracking runtime 高频 settings 读取与 heartbeat/sample timestamp 写入对长期运行的压力。

### Removed

- 暂无。

### Internal

- 新增 `AudioSnapshot`、音频 probe 状态和 stale snapshot 语义，区分无音频、探测不可用和快照过期。
- 为音频 probe 增加防重入保护，避免 Windows Core Audio 调用超时后继续叠加后台 blocking 任务。
- 本地 release 构建使用独立应用身份和配置，便于和正式安装版并行验证。
- 归档 issue #2 Windows tracking 稳定性执行方案。

## [1.1.2] - 2026-05-25

Release: 降低前台窗口采样开销，减少特定 Windows 场景下 CPU 异常占用风险。
App note: 降低 CPU 异常占用风险。
App note en: Reduced CPU spike risk.

### Added

- 暂无。

### Changed

- 暂无。

### Fixed

- 降低前台窗口采样中进程路径查询的 CPU 成本，避免每秒固定扫描全量进程列表，减少特定 Windows 场景下 CPU 异常占用的风险（[#2](https://github.com/Ceceliaee/time-tracking/issues/2)）。

### Removed

- 暂无。

### Internal

- 补充 Windows 前台进程详情解析测试，覆盖路径提取、主路径优先和 snapshot fallback 行为。

## [1.1.1] - 2026-05-25

Release: 修复中文自定义分类在重新加载后显示为编码乱码的问题。
App note: 修复中文分类乱码。
App note en: Fixed Chinese category garbling.

### Added

- 暂无。

### Changed

- 暂无。

### Fixed

- 修复中文自定义分类应用到软件后，重新加载应用映射时可能变成 `%25...` 编码乱码并重复生成乱码分类的问题（[#1](https://github.com/Ceceliaee/time-tracking/issues/1)）。

### Removed

- 暂无。

### Internal

- 补充中文自定义分类编码归一化回归测试，覆盖旧的重复编码分类自动恢复为规范分类 ID。

## [1.1.0] - 2026-05-24

Release: 新增历史窗口标题明细，让切换网页、文件和文档时的活动回看更可信。
App note: 新增历史标题明细。
App note en: Added history title details.

### Added

- 历史页活动详情新增窗口标题明细，可查看同一会话内网页、文件或文档标题的时间片段。

### Changed

- 标题记录开关关闭后不再继续保存该应用新的窗口标题样本，重新开启后从后续可见标题继续记录。
- 备份文件会包含窗口标题明细，恢复新备份后可保留历史活动详情中的标题列表。
- 备份恢复说明补充窗口标题明细范围，恢复前可更清楚判断备份内容。

### Fixed

- 修复历史详情中重复标题可能被拉成跨越中间其他标题的大时间段的问题。
- 清理历史记录和清空窗口标题时同步清理标题采样数据，避免残留不可见明细。
- 修复合并恢复新备份时标题样本可能无法对齐实际恢复后会话的问题。

### Removed

- 暂无。

### Internal

- 新增 `session_title_samples` SQLite 表、旧库直升修复与回填、Rust 写侧 repository 和前端 read model 测试覆盖。
- 增加高标题样本量 History read model 性能基准，覆盖 `4900` 段会话与 `19600` 条标题样本。

## [1.0.1] - 2026-05-23

Release: 改进追踪设置中活动保持时间的说明，让无操作停止计时与短暂切屏返回的行为更清楚。
App note: 改进追踪设置文案。
App note en: Improved tracking settings copy.

### Added

- 暂无。

### Changed

- 将追踪设置中的“合并间隔”改为“活动保持时间”，并更新中英文说明，避免误解为只影响时间线合并。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 暂无。

## [1.0.0] - 2026-05-21

Release: 确立 1.0 稳定版本线，完成发布验证与本地桌面主路径 smoke。
App note: 进入 1.0 稳定版本线。
App note en: Time Tracker is now on the 1.0 stable line.

### Added

- 暂无。

### Changed

- 正式进入 1.0 稳定版本线，后续版本按标准 SemVer 管理。
- 完成 v0.8.1 发布演练与发布后 smoke，确认主路径、更新入口与数据安全流程可用。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 归档 v0.8.1 发布后 smoke 清单，作为 1.0.0 发布决策依据。

## [0.8.1] - 2026-05-21

Release: 收窄旧启动预热与测试辅助边界，提升发布前工程验证一致性。
App note: 提升内部质量与发布验证稳定性。
App note en: Improved internal quality and release verification stability.

### Added

- 暂无。

### Changed

- 暂无。

### Fixed

- 暂无。

### Internal

- 清理旧启动预热入口、重复 pause-sync 规则与测试专用共享层 helper，收窄生产代码边界并同步验证脚本。

## [0.8.0] - 2026-05-21

Release: 提升托盘打开后的首次切页流畅度，并修复托盘与挂件的轻微闪烁问题。
App note: 提升托盘打开后的切页流畅度，并减少托盘和挂件闪烁。
App note en: Smoother tray opening and first view switching.

### Added

- 启动后会在后台分步预热 History、Data、App Mapping、Settings 和 About 的页面代码与默认首屏数据，让开机自启动后再从托盘打开时更接近热启动体验。
- Data 页会预热默认 7 天数据和最近一年热力图缓存，减少首次进入数据页时的整页加载感。

### Changed

- 非首页页面的懒加载资源改为统一的后台 warm-up 队列管理，避免分散的预热 effect 互相错开或重复。
- About 页会复用已预热的设置 bootstrap 信息，减少首次进入关于页时的加载状态。
- README 增加主界面、历史、数据、应用映射、设置和关于页面截图，方便首次了解产品界面。

### Fixed

- 修复托盘左键打开主界面时可能闪出菜单小卡片的问题。
- 移除桌面挂件展开区域的额外阴影，减少挂件附近出现矩形阴影的观感问题。
- 修复页面 chunk 已经加载但首次点击仍可能短暂显示整页加载的问题。

### Removed

- 暂无。

### Internal

- 新增启动 warm-up 服务、预加载状态测试和真实浏览器 smoke 验收，覆盖后台预热后切页不显示 app 级 loading 的场景。
- 归档 lazy view 预加载和启动后台 warm-up 的执行计划。
## [0.7.4] - 2026-05-20

Release: 提升设置保存可靠性，并收窄挂件权限与应用安全边界。

App note: 提升设置保存可靠性与安全边界。
App note en: Improved settings reliability and security boundaries.

### Added

- 暂无。

### Changed

- 微调应用图标资源，保持安装包、窗口和系统展示场景中的图标一致。
- 收窄桌面挂件权限，减少挂件窗口可访问的数据库写入能力。
- 明确生产版本的内容安全策略，减少未评审的运行时默认安全例外。

### Fixed

- 提升设置保存可靠性，多项设置会通过后端事务一次性保存，避免部分写入成功、部分失败的中间状态。
- 修复挂件图标读取路径过宽的问题，让挂件通过更窄的后端读取接口获取图标。
- 修复界面语言同步在渲染阶段产生副作用的问题。
- 清理数据页构建时的误导性拆包警告。

### Removed

- 暂无。

### Internal

- 增加架构守护检查，防止挂件权限、图标读取边界和文案同步副作用回退。
- 归档架构与工程质量 9.0+ 执行记录。

## [0.7.3] - 2026-05-20

Release: 修复更新说明语言、应用记录噪音和任务管理器图标显示。

App note: 修复更新说明、应用过滤和图标显示。
App note en: Fixed update notes, app filtering, and icon display.

### Added

- 暂无。

### Changed

- 应用图标增加浅色底板，改善 Windows 任务管理器等小尺寸场景下的可读性。

### Fixed

- 修复应用内更新说明在中文界面仍可能显示英文的问题。
- 屏蔽火绒升级程序 `hrupdate.exe`，避免它继续进入追踪和应用映射候选。
- 修复 Data 页三个分析面板标题左边距不一致的问题。

### Removed

- 暂无。

### Internal

- 补充发布说明生成和进程过滤的回归测试。

## [0.7.2] - 2026-05-20

Release: 修复数据页加载、热力图与应用趋势显示问题。

App note: 修复数据页加载与显示。
App note en: Fixed Data page loading and display.

### Added

- 暂无。

### Changed

- Data 页会在启动后空闲时预加载页面代码，并减少加载态渲染节点，让首次进入和范围切换更轻。
- 活动趋势、活动热力图和应用趋势在加载中保留稳定尺寸，减少容器大小变化和整页闪动。

### Fixed

- 修复数据页切换时间范围或首次加载时曲线、热力图和容器可能闪动的问题。
- 修复应用趋势中同一应用可能重复显示，以及删除应用记录后数据页仍显示旧缓存的问题。
- 修复活动热力图近一年和年份视图中未来日期、非所属年份日期仍显示格子的问题。
- 修复更新通道生成说明时可能混入另一种语言内容的问题。

### Removed

- 暂无。

### Internal

- 补充数据页读模型和发布说明生成的回归测试覆盖。

## [0.7.1] - 2026-05-17

Release: 修复英文界面更新说明仍显示中文的问题。

App note: 修复英文更新说明显示。
App note en: Fixed English release notes.

### Added

- 暂无。

### Changed

- 更新通道的应用内说明改为包含中英文短说明，后续版本会按当前界面语言显示对应内容。

### Fixed

- 修复英文界面的更新弹窗仍直接显示中文发布说明的问题。

### Removed

- 暂无。

### Internal

- 发布脚本支持 `App note en:` 字段，并在 `latest.json` 中写入可本地化的更新说明。

## [0.7.0] - 2026-05-17

Release: 改进应用映射搜索、备份恢复确认和今日概览体验。

App note: 改进应用映射与备份恢复。
App note en: Improved app mapping and backup restore.

### Added

- 应用映射新增搜索框，可按应用名称或可执行文件名快速筛选候选应用。

### Changed

- 备份恢复会先在弹窗中选择替换或合并策略，再执行恢复，降低误操作风险。
- 今日页标题区改为更安静的概览说明，小时活动卡片和宽屏布局更贴近 Quiet Pro。
- Data 页会自动选中默认应用趋势，减少进入页面后的空状态。
- 自定义分类名称限制为更短的标签，分类和颜色重置改为图标动作。

### Fixed

- 修复应用映射编辑中默认分类和名称可能受到已保存覆盖项影响的问题。
- 修复重置单个应用覆盖后，名称草稿和编辑状态可能残留的问题。

### Removed

- 暂无。

### Internal

- 补充分离默认应用映射与用户覆盖映射的接口和测试覆盖。

## [0.6.8] - 2026-05-17

Release: 修复历史浮层与系统进程过滤，完善旧库升级保护。

App note: 修复历史浮层和系统进程过滤。

### Added

- 暂无。

### Changed

- 首装默认将时间线最短时长调整为 5 分钟，和历史页默认展示粒度保持一致。

### Fixed

- 修复历史时间线详情浮层在列表内滚动时会关闭、内容滚动到底部后消失，以及悬停提示样式不符合 Quiet Pro 且可能超出应用边界的问题。
- 修复 Quiet Select 和历史详情按钮在靠近底部时只能向下展开的问题；空间不足时会自动向上展开，按钮初始方向保持向右。
- 修复应用识别列表中紧贴品牌或产品名的更新、安装、卸载辅助进程未被通用过滤的问题，并隐藏更多 Windows 核心进程与 Microsoft 后台组件。
- 修复旧版 SQLite 数据库直接升级到当前压缩基线时，`sessions` 表缺少 `continuity_group_start_time` 列会导致启动或写入失败的问题；升级前会自动补列、回填历史会话并保留单一 active session 约束。

### Removed

- 暂无。

### Internal

- 扩展前端与 Rust 架构边界门禁，覆盖 `app / features / shared / platform` 方向规则、raw 协议命名扩散，以及 Rust 入口层、domain、platform 的轻量边界检查。
- 将 tracking domain 中的进程过滤、持续参与身份识别与状态解析拆到明确 owner 模块，`tracking.rs` 保留为薄聚合出口。

## [0.6.7] - 2026-05-16

Release: 完成过渡兼容代码清理，收紧备份恢复入口并压缩 SQLite 迁移基线。

App note: 完成内部兼容清理，保留当前数据结构。

### Added

- 暂无。

### Changed

- 备份恢复只接受当前结构化 `.zip` 备份格式，旧 `.json`、`.ttbackup` 和旧 zip 内 `backup.json` 不再作为恢复入口。
- 备份预览状态改为“是否可恢复”的语义，避免继续暴露过渡期的兼容性命名。

### Fixed

- 暂无。

### Removed

- 移除旧应用分类值、旧设置值和旧备份格式的过渡读取逻辑。

### Internal

- SQLite 迁移压缩为当前 schema 基线，并在启动时仅对已完成 `0.6.6` 升级的数据库归一化 `_sqlx_migrations` 历史。

## [0.6.6] - 2026-05-15

Release: 将旧数据升级入口合并到 0.6.6，保留 0.6.4 直接升级保护。

App note: 保留旧数据升级保护。

### Added

- 暂无。

### Changed

- 将实际过渡升级入口后移到 `0.6.6`，继续保留旧应用分类、旧设置值、旧备份格式和 SQLite 迁移历史的升级保护。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 明确 `0.6.5` 已发布但不作为实际用户升级门禁，后续完全简并工作推迟到 `0.6.7`。

## [0.6.5] - 2026-05-15

Release: 保留旧数据升级入口，归一旧设置和应用分类，并统一新备份格式。

App note: 保留旧数据升级，并导出新备份。

### Added

- 暂无。

### Changed

- 旧应用分类 override 和旧设置值会在读取后归一写回当前格式，为下一版移除兼容代码做准备。
- 备份导出统一使用当前结构化 `.zip` 格式；旧 `.json`、`.ttbackup` 和旧 zip 内 `backup.json` 仍可作为过渡导入格式读取。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 删除应用分类 feature 下的历史转发壳，调用方直接使用 `shared/classification/*` 的真实 owner。
- 保留 0.6.4 SQLite migration repair 与 no-op migration，避免已安装版本升级时数据库启动失败。

## [0.6.4] - 2026-05-15

Release: 修复文件资源管理器与桌面识别，并补充中文 README 与基础 i18n 结构。

App note: 修复桌面与资源管理器追踪。

### Added

- 新增简体中文 README，并在中英文 README 之间提供语言切换入口。

### Changed

- README 重新整理为更清晰的产品介绍、下载入口、功能预览和源码运行说明。
- 界面文案与格式化工具改为轻量 i18n 结构，便于后续维护中英文内容。
- CMD、PowerShell、Windows Terminal 等终端默认按开发工具统计。
- 文件资源管理器的默认名称和分类更贴近实际使用场景。

### Fixed

- 修复点击桌面背景可能被记录为文件资源管理器的问题。
- 修复文件资源管理器窗口与桌面 Shell 共用 `explorer.exe` 后难以区分的问题。
- 修复浏览器 smoke 测试中应用图标资源缺失导致的 404。

### Removed

- 移除未使用的 Vite 默认图标资源。

### Internal

- 补充前台窗口类、应用映射和默认名称的回归测试，覆盖桌面 Shell 与资源管理器边界。

## [0.6.3] - 2026-05-14

Release: 改进设置保存、更新失败提示与长期运行稳定性。

App note: 改进设置保存语义与更新失败提示。

### Added

- 暂无。

### Changed

- 主题配色弹窗的“确认”现在只保存当前浅色或深色配色，不再连带保存打开弹窗前的其他未保存设置。
- 关闭“开机自启动”时，“启动时最小化”会保留原选择并以禁用状态展示，避免误以为设置被自动关闭。
- 检查更新失败时，提示会说明当前网络可能无法连接 GitHub，并引导稍后重试或手动下载。

### Fixed

- 修复确认主题配色后可能清除语言预览、导致界面跳回已保存语言的问题。
- 修复更新失败详情直接显示底层请求错误和 GitHub URL 的问题，避免把技术日志暴露给普通用户。

### Removed

- 暂无。

### Internal

- 收口 Rust tracking runtime 的数据访问边界，减少核心行为层对 SQLite 实现细节的直接依赖。
- 将 `shared` 到 `platform/persistence` 的 session 读模型兼容壳退役，并补充架构边界检查。
- 拆分 Quiet Pro 样式入口与主题选项 owner，降低 `App.css` 与设置外观面板的长期维护成本。
- 将 Rust clippy 与真实浏览器 UI smoke 纳入完整验证门槛，并归档本轮架构与工程质量执行记录。

## [0.6.2] - 2026-05-13

Release: 将更新清单迁移到 GitHub Release 附件，并停用独立 updates 分支。
App note: 更新通道迁移至 Release 附件。
### Added

- 暂无。
### Changed

- 更新通道改为从 GitHub Release 附件读取 `latest.json`，不再依赖独立的 `updates` 分支。
- 发布流程会把 `latest.json` 与安装包一起上传到 GitHub Release，后续发布链路更集中。
### Fixed

- 暂无。
### Removed

- 移除发布流程中强推 `updates` 分支的步骤。
### Internal

- 暂无。
## [0.6.1] - 2026-05-13

Release: 优化历史时间线的活动摘要与窗口标题详情查看。
App note: 优化历史时间线详情。
### Added

- 暂无。
### Changed

- 历史时间线默认显示更简洁的应用活动摘要，避免长窗口标题挤占列表空间。
- 活动详情改为浮层展开，可查看同一应用下不同窗口标题及各自的起止时间。
- 数据安全区的备份操作文案从“导出”调整为“备份”，表达更贴近实际用途。
### Fixed

- 暂无。
### Removed

- 暂无。
### Internal

- 为时间线标题明细补充读模型测试，确保合并后的标题仍保留首尾时间。
## [0.6.0] - 2026-05-12

Release: 新增界面语言切换，并优化全局文案表达。
App note: 新增界面语言切换。
### Added

- 设置页「外观」新增语言设置，支持中文与 English 切换，并可在保存前即时预览。
- 新增英文界面文案，主窗口、设置页、更新弹窗、toast、确认框和侧边挂件会随语言设置更新。
### Changed

- 全局界面文案收敛到统一 copy 结构，中文表达更短、更贴近软件界面，并便于后续继续翻译。
- 外观区配色按钮的字号和字重与相邻分段控件对齐，减少英文界面下的视觉突兀。
### Fixed

- 修复部分侧边栏、日历星期、热力图星期、分类标签和挂件状态文案在切换语言后仍可能停留在旧语言的问题。
### Removed

- 暂无。
### Internal

- 补充语言设置持久化、copy key 对齐、settings 归一化和 UI smoke 覆盖，确保中英文文案结构一致。
## [0.5.1] - 2026-05-11

Release: 优化主题配色与预览体验，并修复挂件主题同步。

App note: 优化主题配色与预览。

### Added

- 暂无。

### Changed

- 浅色主题列表调整为默认、Absolutely、Catppuccin、Everforest、GitHub、Gruvbox、Linear、Notion、One、Proof、Raycast、Rose Pine、Solarized、Vercel、VS Code Plus 和 Xcode。
- 深色主题列表调整为默认、Absolutely、Ayu、Catppuccin、Dracula、Everforest、GitHub、Gruvbox、Linear、Lobster、Material、Matrix、Monokai、Night Owl、Nord、Notion、One、Oscurange、Raycast、Rose Pine、Sentry、Solarized、Temple、Tokyo Night、Vercel、VS Code Plus 和 Xcode。
- 主题配色统一按 Quiet Pro token 转译，减轻浅色主题的内容底色，并增强浅色主题线框可见性。

### Fixed

- 修复侧边挂件在主窗口保存主题后不会跟随更新的问题。
- 修复主题选择弹窗中点取消不会撤回临时预览的问题。

### Removed

- 暂无。

### Internal

- 为设置保存后的多窗口主题同步补充运行时通知，并更新设置归一化测试覆盖。

## [0.5.0] - 2026-05-10

Release: 新增浅色、深色和跟随系统的外观设置，并支持分别选择主题配色。

App note: 新增外观模式与主题配色设置。

### Added

- 设置页新增外观区域，可在浅色、深色和跟随系统之间切换。
- 浅色和深色模式现在可以分别选择配色方案，并在保存前即时预览。

### Changed

- 主窗口和侧边挂件会使用同一套已保存的外观设置，图表、控件和页面 chrome 会随主题同步调整。
- 数据页的热力图图例和应用趋势选中状态调整了排列顺序，在紧凑空间中更稳定。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 外观设置已纳入应用设置持久化、默认值配置、设置补丁生成和回归测试覆盖。

## [0.4.5] - 2026-05-09

Release: 在数据页补充按应用查看趋势的能力，并优化全屏数据布局。

App note: 数据页新增应用趋势查看。

### Added

- 数据页新增应用趋势区域，可按应用查看总时长、平均时长、活跃天数、峰值日和趋势曲线。
- 应用趋势支持搜索应用、显示应用图标，并可独立切换近 7 天、近 30 天和近一年范围。

### Changed

- 数据页全屏布局调整为活跃趋势、活跃热力图和应用趋势并列组织，减少关键图表之间的跳转。
- 应用趋势近一年视图按月份聚合，并将平均指标改为月均。

### Fixed

- 暂无。

### Removed

- 暂无。

### Internal

- 明确发布版本选择规则，并补充应用趋势读模型测试。

## [0.4.4] - 2026-05-08

Release: 增强今日、历史和数据分析视图，并改进设置默认值、应用映射过滤与发布验证。

App note: 改进今日、历史和数据分析体验。

### Added

- 新增独立“数据”侧边栏页面，集中展示活跃趋势、长期活跃热力图、区间总时长和平均时长。
- 新增独立“关于”侧边栏入口，版本、更新与反馈信息不再混在其他页面里。
- 历史页日期按钮现在可以打开 Quiet Pro 风格日历，直接选择要查看的日期。
- 首页专注分布新增“比昨天增加 / 减少”轻提示，并用上升 / 下降图标辅助识别今日变化。

### Changed

- 首页“概览”改名为“今天”，专注分布、应用排行和今日能量脉冲重新按小窗口与全屏场景整理布局。
- 数据页活跃趋势支持近 7 天、近 30 天和近一年切换，右侧总时长与平均时长卡片会跟随当前范围同步更新。
- 近一年趋势改为按最近 12 个自然月聚合，近 30 天趋势按日期自适应展示，避免坐标过密或重复月份。
- 长期活跃热力图改为 GitHub 式日历热力图，支持近一年和可用年份切换，并使用更克制的 Quiet Pro 图例与提示。
- 首次安装默认启用“最小化到挂件”和“关闭到托盘”，新用户打开后的窗口行为更符合当前默认推荐。
- 设置页与应用映射页的未保存、已更新和已保存状态提示改为更一致的 Quiet Pro 表达。
- 历史页和数据页的图表文案、时间格式与坐标刻度更统一，悬浮提示不再混用英文 `hours`。

### Fixed

- 过滤安装、卸载和临时更新类 `.tmp` 进程，避免它们进入应用映射候选，同时保留 Geek Uninstaller 等真实工具程序。
- 修复数据页切换范围或进入页面时趋势图、热力图和指标卡短暂闪动、占位高度变化或旧数据残留的问题。
- 修复数据页全屏时右侧指标卡与左侧趋势图高度不齐、热力图过空、纵轴刻度过密的问题。
- 修复首页、历史页和数据页部分图表在不同窗口尺寸下文字过小、间距不稳或内容不居中的问题。

### Removed

- 暂无。

### Internal

- 将数据页趋势与热力图读模型收口到 `features/data`，并补齐数据读模型测试和 UI smoke 验证。
- 增强架构边界、bundle budget、发布脚本和发布校验，发布准备时会更早发现版本、changelog 与边界问题。

## [0.4.3] - 2026-04-30

Release: 统一主窗口为 Quiet Pro 自定义标题栏，并修复窗口边角和默认高度体验。
App note: 改进主窗口标题栏与边角显示。
### Changed

- 主窗口改用 Quiet Pro 自定义标题栏，窗口控制按钮与应用标识保持在同一套桌面外壳中。
- 默认窗口高度补偿标题栏占用空间，打开后的主内容区尺寸更接近上一版安装体验。
- Quiet Pro 图标按钮、内联操作和重置操作统一使用克制 tooltip 与更稳定的悬停反馈。
### Fixed

- 修复自定义标题栏启用后窗口边角可能出现多层尖角、底色不一致或最大化圆角残留的问题。
- 修复标题栏左侧显示通用时钟图标而不是应用图标的问题。
### Internal

- 新增前端窗口控制 gateway，并补齐 Tauri 主窗口控制 capability，保持最小化、最大化、拖拽和关闭行为走统一边界。

## [0.4.2] - 2026-04-29

Release: 修复侧边挂件的拖拽、悬停和最小化恢复问题，让挂件位置与状态更稳定。
App note: 修复侧边挂件拖拽与悬停稳定性。
### Added

- 暂无。
### Changed

- 侧边挂件调整为状态圆与胶囊操作区两段式展示，收起、悬停和展开状态更清晰。
- 收起状态支持短按展开、长按拖拽，展开后仅响应挂件按钮操作。
### Fixed

- 修复挂件拖拽松手后吸边、半圆收回和首次悬停状态可能不同步的问题。
- 修复主窗口最小化后挂件可能以悬停态出现、跑到错误位置或留下不可点击残影的问题。
- 修复挂件展开时操作区或状态圆被裁切、错位和闪入闪出的问题。
### Removed

- 暂无。
### Internal

- 收紧主窗口与挂件窗口生命周期、运行时状态和持久化边界，并补齐交互回归测试。

## [0.4.1] - 2026-04-25

Release: 修复设置与应用映射保存的数据库写入稳定性，并让音频参与状态刷新更及时。
App note: 修复保存稳定性，并改进音频追踪刷新。
### Added

- 暂无。
### Changed

- 音频、会议和浏览器媒体参与状态现在会在窗口未切换时及时刷新主界面、挂件和相关统计，减少状态滞后。
- 持续参与判断统一为音频信号口径，浏览器音频活动可纳入保护，短暂信号抖动使用更一致的宽限窗口。
### Fixed

- 修复应用映射、分类颜色和自定义分类批量保存时可能遇到 SQLite 连接锁定或半保存的问题。
- 修复设置保存和数据库写入在临时锁定或连接池关闭后缺少恢复重试的问题。
- 修复暂停/恢复追踪入口调用错误命令名导致按钮可能失效的问题。
### Removed

- 暂无。
### Internal

- 收紧 raw 协议字段与前端业务模型边界，新增命名边界检查，并把 IPC / SQLite raw DTO 映射留在 platform 或明确 read model 边界。

## [0.4.0] - 2026-04-21

Release: 新增最小化侧边挂件，并改进更新安装后的恢复体验与保存可靠性。
App note: 新增最小化挂件，并改进更新重启后的恢复体验。
### Added

- 新增“最小化到挂件”模式：主窗口最小化后可显示吸附在屏幕左右侧的侧边挂件，并记住上次停靠侧与垂直位置。
- 新增挂件状态展示与快捷操作，可直接查看当前追踪状态、恢复主界面，以及在挂件中暂停或恢复追踪。
### Changed

- “启动时最小化”现在会遵守当前最小化行为；当最小化方式设为挂件时，自启动后会直接进入挂件，而不是沿用旧的托盘式收起逻辑。
- 最小化行为设置正式收敛为“任务栏 / 挂件”，关闭到托盘仍保持独立语义，不再与最小化行为混用。
### Fixed

- 修复更新安装后应用重启时不能稳定恢复主界面与上次所在页面的问题，减少更新完成后的断点感。
- 修复更新下载尚未返回字节进度时，进度条仍被当作确定进度展示的问题，改为明确的不确定进度反馈。
- 修复分类映射和设置页在多项保存中途失败时可能出现部分生效的问题，避免留下半保存状态。
### Removed

- 暂无。
### Internal

- 继续收口 AppShell、挂件窗口和页面状态编排的 owner，补齐挂件交互、设置交互和分类映射交互的自动化测试。
- 为持久化批量写入补上事务与串行写入语义，并为读模型和启动链路补齐可复用 benchmark 与默认质量门槛。

## [0.3.3] - 2026-04-20

Release: 改进视频与会议场景的持续参与判定，减少浏览器音频误记，并提升短暂信号波动时的追踪稳定性。
App note: 改进视频/会议追踪稳定性，减少误记。
### Added

- 暂无。
### Changed

- 调整视频与会议场景的持续参与策略，在短暂信号抖动时增加更稳妥的宽限与防抖处理，同时按场景区分不同保护强度。
- 收紧浏览器类媒体判定口径，只有明确的视频播放信号才会进入视频类持续参与保护，减少普通音频页面被当作视频追踪的情况。
### Fixed

- 修复视频仍在播放但媒体信号短暂波动时过早掉出持续参与的问题，降低会议和长视频场景的漏记概率。
- 修复浏览器仅有音频会话时被过宽识别为视频持续参与的问题，减少误记和异常延长。
- 修复 tracking 运行时主文件职责过度集中的问题，将持续参与状态机与 session 超时封口规则拆为独立模块，降低后续修改时的回归风险。
### Removed

- 暂无。
### Internal

- 将 settings 持久化与运行时读取能力收回真实 owner，并补齐对应状态层测试与 Rust 自动化校验，统一 release 校验口径。

## [0.3.2] - 2026-04-19

Release: 收起重复更新进度展示，修正下载前的进度反馈，并补齐默认验证门槛与架构收口。
App note: 修正更新进度展示，并补齐默认验证门槛。
### Added

- 新增面向 PR 的默认校验 workflow，自动执行前端质量门槛和 Rust `cargo check`。
### Changed

- 应用映射页和设置页将页面状态编排收回到各自 feature hook，页面组件回到以组合和渲染为主的壳层。
- 应用分类的稳定映射、归一化和分类色 owner 收口到 `shared/classification/*`，供 Dashboard、History、AppShell 和 Classification 统一复用。
### Fixed

- 修复更新弹窗打开时，设置页仍重复显示下载进度条的问题。
- 修复更新下载刚开始但尚未获得字节进度时，进度条被错误渲染为满蓝条且文案反馈不清晰的问题。
- 修复默认前端验证门槛未覆盖更新视图模型测试，以及 Node `strip-types` 测试链路下分类共享模块导入不一致导致的回归风险。
### Removed

- 移除 `shared/lib/appClassificationFacade.ts` 和 `shared/lib/historyReadModelService.ts` 这类 `shared -> features` 的历史兼容壳。
### Internal

- 将 `npm run check` 扩展为 `tracking lifecycle + replay + update view model + build`，并同步回写长期文档与发布校验口径。
## [0.3.1] - 2026-04-19

Release: 修复托盘退出后无法重新打开，并隔离开发版与正式版数据。

App note: 修复托盘退出重开问题，并隔离开发版与正式版数据。

### Added

- 暂无。

### Changed

- 暂无。

### Fixed

- 修复在启用托盘驻留的正式版中，通过托盘菜单“退出应用”后窗口关闭仍会被“关闭到托盘”逻辑拦截，导致进程未真正退出、再次启动无法重新打开的问题。
- 修复本地开发版、本地工作区构建产物与安装后的正式版共用应用上下文的问题，避免相互影响数据库、备份目录与 WebView 本地数据。

### Removed

- 暂无。

### Internal

- 为本地工作区运行的 Tauri 二进制补充独立 `local` 配置，并将版本同步脚本与 GitHub Actions 发布流程扩展到新的配置文件。

## [0.3.0] - 2026-04-19

Release: 改进时间连续性统计，并把应用内更新失败时的错误提示和手动下载兜底做得更清楚。
App note: 改进时间连续性统计，并优化更新失败时的手动下载兜底。
### Added

- 为更新面板和更新弹窗补充更明确的下载进度展示，以及更新失败后的手动下载入口。

### Changed

- 调整时间连续性与有效时长的编译规则，让 History、Dashboard 和相关统计在短暂切换、返回与持续参与场景下更一致。
- 调整应用内更新体验，让检查、下载、安装三个阶段的状态、文案和下一步动作更明确。

### Fixed

- 修复自动更新失败时难以判断是“无法检查更新”还是“无法下载安装包”的问题，并补上对应的手动下载路径。
- 修复更新对话框与设置页更新面板在失败状态下文案不一致、缺少明确动作入口的问题。
- 改善 tracking 主链在连续参与、启动收口和运行时刷新场景下的稳定性，减少有效时长与可见时间线不一致的情况。

### Removed

- 暂无。

### Internal

- 继续收口 tracking 相关的 Rust 边界，补充 `active_session`、`continuity` 等更明确的运行时模块，并把 Windows 媒体与音频能力从更混杂的位置拆分出来。
- 继续按前端 `app / features / shared / platform` 与 Rust `app / commands / platform / engine / domain / data` 的长期方向推进 owner-first 收口。
- 为 tracking 连续性、运行时刷新、有效时长编译与更新视图模型补充回归测试，提升主链行为调整后的验证覆盖。
- 同步整理发布工作流默认值、版本同步脚本、工程质量文档与本轮执行计划归档，保持发布、验证与长期规则的一致性。
## [0.2.3] - 2026-04-15

Release: 修复开机自动检测更新、重复启动托盘图标，并改善四页首次进入的加载与启动稳定性。
App note: 修复自动检测更新、重复启动托盘和首进加载。
### Added

- 暂无。
### Changed

- 应用启动后会预热首页、历史、设置和应用页缓存，首次进入时优先回显缓存，再在后台静默刷新。
- 更新流程改为更清晰的两段式体验，下载完成后停留在“已下载”状态，再由用户确认安装。
### Fixed

- 修复开机后静默自动检测更新容易因初始化时序或网络未就绪而漏检的问题，并改为仅在成功检查后记录当天已检查。
- 修复正式版已在运行时，再次通过快捷方式或直接双击 `exe` 启动会生成多个托盘图标的问题。
- 改善启动与开机自启场景下的初始化稳定性，避免后台任务等待 SQLite 连接池过久导致启动异常。
### Removed

- 暂无。
### Internal

- 新增按应用标识隔离的单实例约束，保持正式版与开发版各自单实例且可并存运行。
- 将 Dashboard、History、Settings 和 App Mapping 的首屏缓存收口到各自 feature/service 边界，由壳层统一触发启动预热。
## [0.2.2] - 2026-04-13

Release: 改善页面切换稳定性，并过滤 `openwith.exe` 这类系统噪音记录。

App note: 改善切页动效，并过滤系统噪音记录。

### Added

- 暂无。

### Changed

- 收紧主页面切换时的入场方式，减少切页时的二段位移感。

### Fixed

- 修复 `openwith.exe` 被当作普通应用进入追踪与分类主路径的问题。

### Removed

- 暂无。

### Internal

- 为系统噪音进程过滤补充 `openwith.exe` 的 runtime 单测，并补齐默认系统映射兜底。

## [0.2.1] - 2026-04-13

Release: 改善共享弹窗、提示和颜色浮层的出现稳定性，并收紧侧边栏更新入口的尺寸与交互反馈。

App note: 改善弹窗与提示动效，并优化更新入口样式。

### Added

- 暂无。

### Changed

- 收紧侧边栏“更新”入口的尺寸、字号、居中对齐与悬停反馈，降低对主导航的视觉干扰。

### Fixed

- 修复多类共享弹窗与提示出现时的二段感，避免确认弹窗和保存后提示看起来像“弹两遍”或轻微位移。
- 修复颜色选择浮层打开后再次定位造成的轻微挪动问题，提升出现时的稳定性。

### Removed

- 暂无。

### Internal

- 将共享对话框与提示统一收口到更稳定的 portal / 入场实现，减少受页面局部布局影响的情况。

## [0.2.0] - 2026-04-13

Release: 新增应用内更新检查与静默更新提示，并将挂机判定和时间流合并设置拆成独立规则。

App note: 新增应用内更新检查，并拆分挂机与时间流合并设置。

### Added

- 新增设置页“关于”区块中的更新状态、检查更新入口和发现新版本后的确认弹窗。
- 新增启动后每日一次的静默更新检查；检查失败或没有新版本时不打扰用户。
- 新增侧边栏低干扰更新入口，仅在发现可用更新或已下载更新时显示。

### Changed

- 将“自动挂机判定”和“时间流合并窗口”拆成两个独立设置，分别控制无操作截断和切回同一应用后的时间流合并。
- 时间流合并窗口最大值调整为 5 分钟。
- 未保存设置时切换页面的确认操作改为“保存”，支持保存后继续切换。

### Fixed

- 修正检查更新按钮直接弹出状态弹窗的问题，改为在设置页内展示检查状态，仅在确实发现更新时显示确认弹窗。
- 改善更新弹窗文案与按钮位置，使“稍后 / 立即更新”更符合一次明确确认。

### Internal

- 接入 Tauri updater 底层能力，并补齐 Rust command、runtime state、前端 gateway、hook 和更新视图模型测试。
- 新增 GitHub Actions 自动发布流程，支持输入版本号后自动同步版本、打 tag、构建安装包、创建 GitHub Release 并生成 `latest.json`。
- 新增 Tauri updater signing key，并将公钥写入 Tauri 配置；私钥保存在本地 `.secrets/tauri/` 并通过 GitHub Secrets 提供给 Actions。
- 将 `CHANGELOG.md` 调整为 Release 文案唯一来源，新增 `Release:` 与 `App note:` 字段供 GitHub Release 和应用内更新弹窗复用。

## [0.1.0] - 2026-04-12

Release: 初始发布，支持自动记录前台应用使用时间，并提供今日总览、历史视图和应用映射工作台。

App note: 初始发布，新增时间追踪、今日总览和历史视图。

### Added

- 初步完成本地优先的 Windows 桌面时间追踪工作流，支持自动前台应用追踪、今日概览、历史视图与应用分类管理。
- 新增应用映射工作台，支持应用重命名、分类覆盖、颜色覆盖、统计开关、标题记录开关、恢复默认与历史删除。
- 新增设置页显式保存 / 取消流程，补齐应用内切页未保存提示。
- 新增本地备份导出与恢复能力，以及历史保留期清理能力。

### Changed

- 统一到 Quiet Pro 界面体系，并继续收口前后端架构边界。
- 应用映射与设置页改为更稳定的显式提交流程，减少自动持久化带来的误操作。

### Fixed

- 修复多处 App Mapping 编辑、保存、未保存提示与局部刷新问题，避免截图软件或实时 tracking 刷新误触发整页重载。
- 修复分类控制、颜色选择器、行内控件和 Quiet Pro 收口过程中的多处 UI 对齐、遮挡、编码与交互问题。
- 改善 AFK、锁屏、睡眠边界以及 runtime 健康链路下的会话稳定性与统计可信度。
- 修复首页与历史页在冷启动、重装后偶发未及时应用最新应用映射的问题，确保自定义名称、分类与颜色覆盖能够稳定生效。
- 修复首页统计中偶发回退到旧应用名或落入“未分类”的情况，统一页面加载时的分类映射刷新链路。

### Internal

- 首次建立正式 GitHub Release 基线，并同步引入长期版本、changelog 与发布规范。
- 建立长期架构目标文档与 Quiet Pro 规范文档，后续重构和 UI 扩展已有稳定依据。
- 前端主路径已统一收口到 Quiet Pro 组件体系，包含对话框、下拉、开关、颜色入口、分段筛选、行内轻操作、图表 tooltip 与 toast。
- 前端边界进一步收紧到 `app / features / shared / lib` 的目标方向，多个 legacy service 与历史壳层已退场。
- Rust 侧继续推进 `app / engine / data / domain` 分层，tracking runtime、settings repository、sqlite pool 等边界已明显收口。
- 为版本发布新增长期版本与 GitHub Release 规范，后续版本管理不再依赖一次性说明。
- 调整前端读模型加载边界，将分类运行时刷新编排收回 `app/services`，保持 `shared` 层聚焦稳定共享只读能力。
