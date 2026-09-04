# 架构规范

## 1. 文档定位

本文件定义 `Patina` 当前阶段的长期架构基线。

它不是迁移记录、执行清单或某一轮重构计划，而是以后新增代码、调整边界、评估结构风险时都应默认遵循的母规则。

本文件主要回答 5 件事：

- 这套系统当前稳定的长期结构是什么
- 前端与 Rust 各层分别负责什么、不负责什么
- 前后端、运行时、SQLite、IPC 的所有权如何划分
- 新增代码默认应该落在哪一层
- 什么行为属于架构回流或越界

如果一次性执行单、临时修复方案或局部实现习惯与本文件冲突，以本文件为准。

## 2. 系统现实

`Patina` 不是普通 Web 应用，而是一个：

- `Tauri v2` 桌面应用
- `Rust + React + TypeScript` 双栈工程
- 本地优先、SQLite 驱动的数据产品
- 强依赖 Windows 前台窗口、图标、锁屏、休眠等平台能力的时间追踪工具

这意味着长期架构设计优先服务于：

- 稳定运行时
- 清晰所有权
- 可验证行为
- 渐进演进
- 对本地数据与平台细节的可控性

而不是服务于：

- 目录表面整齐
- 一次性“大重构完成感”
- 为抽象而抽象的分层模板

---

## 3. 架构原则

### 3.1 所有权优先于方便修改

代码应该落在真正拥有该能力的层，而不是“当前最顺手改”的层。

### 3.2 运行时写侧和持久化派生状态归 Rust，界面读模型归前端

Rust 拥有运行时主链、写侧副作用，以及需要跨启动维护一致性的持久化派生状态；前端拥有 UI、交互编排和页面读模型组织。前端可以组合页面视图，但不应为了页面方便长期装载全部事实并在 WebView 内维护第二份持久化索引。

### 3.3 平台细节必须显式收口

与 Tauri、SQLite、本地桌面环境、Windows API 打交道的能力必须有明确边界，不应散落在页面、壳层或临时 util 中。

### 3.4 共享层只承接稳定共享能力

`shared/*` 不是“多个地方都可能会用”的暂存区，只容纳稳定、低上下文依赖、跨 feature 的能力。

### 3.5 入口层保持薄

前端 `app/*`、Rust `lib.rs` 与 `commands/*` 都属于高吸力层。它们可以编排，但不应沉淀厚业务实现。

### 3.6 渐进重构优先于大爆炸

允许在真实任务中顺手推进一小步边界收敛，但不为了“目录更整齐”做无收益搬迁。

### 3.7 例外必须显式且尽量变薄

长期默认是一个能力只有一个当前实现和一个真实 owner。完成替换时，应迁移调用方并删除被替代实现；不得为了降低眼前改动量，长期并排保留“旧实现 + 新实现”。

源码名称必须表达业务语义或边界差异，不表达实现的新旧顺序：

- 不使用 `fooV2`、`foo_v3`、`NewFoo`、`NextFoo`、`FooLatest` 等函数、类型、模块、service 或 command 名称
- 不用 `LegacyFoo`、`CompatFoo` 把临时兼容逻辑伪装成长期 owner；确实读取旧格式时，名称必须指向具体边界，例如冻结的备份格式 reader，并附带退出条件
- 两种行为确实需要同时存在时，按领域语义命名，例如按来源、策略、格式或能力区分，而不是按 `V1 / V2` 区分
- 版本号只用于真正被版本化的外部或持久化事实，例如发布版本、协议版本、备份格式、数据库 schema 和 migration；不得用这些必要版本事实为普通实现并行化提供借口

默认不新增兼容壳、转发层或历史适配层。只有已发布数据、外部协议、跨版本升级或仍在支持窗口内的真实调用方要求兼容时，才允许例外存在，并且必须满足：

- 它确实在服务兼容或平滑迁移
- 它不承接新的厚逻辑
- 它有明确 owner
- 它有可验证的退出条件和删除时机
- 它不会重新把边界变模糊，也不会形成 `V1 -> V2 -> V3` 转发链

如果一个“临时例外”开始承接新功能，它就不再是例外，而是在制造新的遗留层。

---

## 4. 系统边界与所有权

当前系统存在 3 条明确协作通道，以及 1 条外部伴生扩展边界：

### 4.1 Rust 运行时通道

Rust 负责：

- 前台窗口采样
- session 生命周期
- 锁屏 / 休眠 / AFK 等时序处理
- updater / tray / autostart 等桌面行为

这条通道是产品最关键的运行时主链。

### 4.2 Tauri IPC 通道

前端通过 command / event 与 Rust 协作，用于：

- 获取活动窗口与 tracker 状态
- 同步运行时事件
- 修改桌面行为
- 调用更新与备份能力

IPC 契约应保持稳定、可解析、可测试。

Tauri application command 采用显式、默认拒绝的窗口授权模型：

- `src-tauri/build.rs` 中的 application command manifest 是命令分类入口；新增 custom command 必须先归入 main-only 或 Widget allowlist，未分类即构建门失败。
- `src-tauri/permissions/window-commands.toml` 和 `src-tauri/capabilities/{default,widget}.json` 只授予精确命令，不使用 application command 通配符或 default allow-all。
- main window 与 Widget 分别使用独立 permission set；Widget 只读取专用 bootstrap/icon/placement/tracker 快照并执行必要窗口操作，不获得 plugin SQL load/select/execute。
- 删除、恢复、密钥、存储迁移和更新安装等敏感 command 即使 capability 配错，也必须在 Rust handler 内根据真实 `WebviewWindow` label 做 caller guard；前端按钮不是安全边界。
- 存储迁移编排归 `data/storage_migration.rs`，真实路径身份与无破坏写探针归 `data/storage_path_safety.rs`，staging/替换/旧数据清理的 reparse-safe 删除策略归 `data/storage_migration_cleanup.rs`；三者均默认拒绝无法确认的路径，破坏性清理前必须重新比较数据根和 WebView 根的交叉真实身份。
- manifest、permission sets、capabilities、前端调用和 Rust `invoke_handler` 注册必须由静态 checker 保持一致，并由真实 main/Widget runtime denial matrix 证明边界没有只停留在配置文本。

### 4.3 本地数据读取通道

前端当前保留受控的本地 SQLite 读访问，用于：

- settings 读取
- History 精确会话、标题样本和仍未迁出的局部明细读取

跨启动、可重建的活动派生状态由 Rust `data/activity_read_model/*` 持有：

- `recorded_app_catalog` 提供完整应用目录、搜索和 keyset 分页
- `activity_hourly_effective` 提供 Dashboard、History 汇总区和 Data 所需的有效活动聚合
- revision、state 与 dirty 表和事实写入处于同一 SQLite 事务边界
- 后台维护可以分批重建；状态不可信、范围脏或存在活动会话时，读取在同一快照内按范围回退到事实
- History 精确时间线不由小时汇总伪造，仍读取事实和标题样本
- 数据库覆盖恢复后先让派生状态失效，再由后台幂等重建

前端通过 `platform/persistence/activityReadModelGateway.ts` 调用 typed Rust command，并继续在 feature service 内应用用户分类、别名和页面展示规则；这些可编辑规则不固化进活动汇总表。

这条通道不是默认自由边界，而是显式受控边界。规则如下：

- 页面组件不能直接写 SQL
- feature 不能直接跳过边界访问底层 DB
- SQLite 访问应通过 `platform/persistence/*` 暴露的明确出口
- `src/platform/persistence/sqlite.ts` 只暴露读连接；前端生产代码不应再调用 `execute` / `executeWrite` / `executeWriteBatch`
- settings、classification、backup settings、数据清理与类似写侧操作默认通过 typed Rust command 完成
- main window capability 不应包含 `sql:allow-execute`
- settings 原始读取、tracker health 时间戳与类似本地持久化适配，默认归 `platform/persistence/*`
- `app/services/*` 只保留应用启动、运行时同步或全局偏好写入所需的薄协调，不从 `features/settings/*` 借基础能力
- `features/settings/*` 只保留 settings 页面的保存、cleanup、backup、restore 与外链打开等 feature 私有流程
- 涉及运行时写侧、数据写侧和平台副作用的操作，优先迁往 Rust command
- 需要持久化、跨页面复用或保证事实/派生一致性的读索引，默认由 Rust data owner 维护并经 typed command 读取
- 页面特有的格式化、分类映射、图表组合和精确时间线几何继续留在对应 feature read model

备份与恢复沿用同一 owner 规则：

- SQLite 快照容器、manifest、摘要、格式识别和恢复编排归 `data/backup/*`
- 数据库文件切换、WAL checkpoint、pool 重开和中断恢复归 `data/sqlite_pool/*`
- 合并去重由各数据域 repository 持有，不能把表级 SQL 上提到 command、app 或前端
- `commands/backup.rs` 与 `app/backup.rs` 只承担参数边界和恢复后的薄协调
- 冻结的旧格式 reader 是带丢弃窗口的兼容壳，不得成为新增数据域的长期 owner
- 自动备份的时间声明、重试与调和决策归备份专用 `engine/backup_scheduler.rs`；目标执行、运行账本和保留策略分别归 `data/scheduled_backup.rs` 与其 repository，不为未来定时导出提前建立通用任务框架
- WebDAV 自动备份只有在本地快照校验、不可覆盖上传、远端全量回读校验和索引发布全部完成后才可记为成功；旧自动对象必须在新备份成立后，凭精确路径、来源、目标身份与 ETag 等所有权证据清理，证据不足时保留对象并记录警告
- WebDAV 地址、用户名和远端目录可作为非秘密配置持久化；密码不得进入 SQLite、事件载荷、远端索引或日志。唯一允许返回密码的 IPC 是 main window 用户明确点击“显示密码”触发的 `cmd_reveal_webdav_backup_secret`：handler 必须执行真实窗口 caller guard，前端不得在打开弹窗时预取，隐藏或关闭弹窗后必须清除已读取的明文预览；Widget 和其他窗口不得获得该命令
- 自动导出的日历周期、到期槽位、补跑与重试决策归导出专用 `engine/export_scheduler.rs`；配置与运行账本归 `data/repositories/scheduled_export.rs`，文件生成、格式校验、不可覆盖发布和崩溃对账归 `data/scheduled_export.rs`，不得与自动备份合并成通用任务框架
- `app/scheduled_task_runtime.rs` 只共享目录选择、唤醒/轮询和状态事件发送这些无业务语义的运行机制；备份与导出的 state 类型、锁边界、错误分类、调度策略和数据动作必须继续分离

### 4.4 浏览器扩展伴生边界

`Patina Web Sync` 浏览器扩展是 `Patina` 的外部 companion，不属于主仓库内的前端 feature、Rust runtime 或发布产物。

边界规则如下：

- `Patina` 拥有本机 HTTP 接收端、token 校验、网页活动写入、备份恢复、清理历史、History / Classification 读模型和 Settings 配置说明
- `Patina Web Sync` 独立仓库拥有 Chromium / Firefox 扩展源码、manifest 版本、商店素材、三店提交、AMO 公开 listed XPI 和扩展 release asset
- 两者通过 [`web-activity-protocol.md`](./web-activity-protocol.md) 定义的本机协议协作
- 不把浏览器扩展源码、构建脚本或商店发布流程重新放回 `Patina` 主仓库
- 不为了扩展分发把 `Patina` 主应用发布流程重新绑定到扩展版本号

### 4.5 命名与跨层协议

命名规范优先服务边界清晰，而不是追求所有层表面一致。

Rust 侧继续遵守 Rust 习惯：

- 文件名、模块名、函数名、变量名、struct 字段使用 `snake_case`
- 类型、struct、enum、trait 使用 `PascalCase`
- 常量使用 `SCREAMING_SNAKE_CASE`
- 多词 Rust 文件名使用 `_`，例如 `loop_state.rs`；单词文件名不强行加 `_`，例如 `support.rs`

前端业务模型继续遵守 TypeScript / React 习惯：

- React 组件文件使用 `PascalCase.tsx`
- hook 文件和函数使用 `useXxx.ts` / `useXxx`
- service、gateway、helper 文件使用 `lowerCamelCase.ts`
- 类型和 interface 使用 `PascalCase`
- 普通变量、函数、props 与前端模型字段使用 `camelCase`
- 常量使用 `SCREAMING_SNAKE_CASE`

协议和数据边界不为了前端命名偏好破坏兼容：

- Tauri command 名称保持既有 `snake_case`
- Tauri command 参数在 invoke 边界按现状处理，不做无收益重命名
- Tauri event 名称保持既有 `kebab-case`
- tracking data changed reason 保持既有 `kebab-case`
- SQLite 表名、字段名与持久化 key 保持 `snake_case`
- serde 输出默认允许 Rust / 数据协议侧的 `snake_case`

Raw DTO 只能停留在明确边界：

- `src/platform/**` 可以定义 `RawXxxDto`、`RawXxxSnapshot` 或局部 raw row，并负责映射为前端模型
- `src/features/*/services/*ReadModel.ts` 只允许在 read model 内部短暂承接数据库 raw row，不允许继续向组件、hook 或 view model 扩散
- `src-tauri/**` 继续使用 Rust 与协议侧命名
- 测试 raw payload fixture 必须让 raw 意图清楚，优先使用 `Raw` 前缀或直接验证 raw parser

前端业务层默认不承载 raw DTO：

- `src/app/**`、`src/features/*/components/**`、`src/features/*/hooks/**`、`src/features/*/services/*ViewModel.ts` 不应读取 IPC 或 SQLite raw 字段
- `src/shared/types/**` 默认承载前端模型，不作为协议转储层
- `src/shared/lib/**` 的通用业务函数入参和返回值默认使用前端模型字段
- 例外必须有明确 owner，要么留在允许目录，要么类型名带 `Raw` 并保持变薄

---

## 5. 前端长期结构

当前前端长期结构为：

```text
src/
  app/
  features/
    about/
    classification/
    data/
    dashboard/
    destination/
    history/
    settings/
    tools/
    update/
  shared/
  platform/
```

`src/styles/` 是 CSS-only 的 Quiet Pro 样式资产区，由 `src/App.css` 作为单入口汇总导入；它不承接 TypeScript 业务代码、平台适配或跨层逻辑，因此不视为新的前端 owner 层。

前端终局结构中不再保留：

- 根层 `src/lib/`
- 根层 `src/types/`

### 5.1 `app/`

`app/*` 负责：

- 应用入口与壳层
- 启动 bootstrap
- 全局 provider
- 页面切换与全局对话框
- 跨 feature 运行时编排

`app/*` 不负责：

- feature 私有规则
- feature 私有格式化
- 直接写 SQL
- 平台网关实现
- 持续膨胀成新的全局业务中心

### 5.2 `features/`

`features/*` 负责产品能力闭环。

每个 feature 可以按真实需要拥有自己的局部目录或类型文件：

- `components/`
- `hooks/`
- `services/`
- `types.ts`

这些不是必须配齐的固定四件套。只有当该 feature 确实有对应 UI、状态编排、服务逻辑或共享类型时才创建；像 `about` 这类轻量页面只保留 `components/` 是合理的。

页面型 feature 当前包括：

- `dashboard`
- `history`
- `data`
- `classification`
- `settings`
- `tools`
- `about`

支持型 feature 当前包括：

- `destination`
- `update`

`destination` 拥有跨 Dashboard、History 与 Data 的应用/网页对象详情能力，包括详情目标契约、打开状态、读模型、时间轴视口、用户偏好和弹窗 UI。来源页面只能构造公开的 `DestinationDetailTarget` 并调用公开 launcher；不得直接读取 `destination/services/*`，也不得复制一套页面私有详情弹窗。

时间线列表、时间轴概括和对象详情消费有效片段，显示组的起止跨度不参与有效用时计算。详情先限定对象；视窗裁剪使用组内真实片段，短间隔归组不补空档、不吞穿插对象。应用保留上游明确的持续参与连续性。网页在相同浏览器客户端、浏览器类型、可执行文件和域名集合内按区间并集计量，独立来源累计；前端既有网页 compiler 与 Rust data 聚合遵守同一来源政策，原始记录不改写。

History 时间轴的分钟主要对象色块负责概括，分轨与图例累计使用完整有效片段。最短时长筛选只改变可见组，不影响总览。时间线和详情的筛选各自支持0～10分钟，0不过滤有效组；各自默认值、存储键及紧凑用时格式保持独立。显示文本的逐行取整不承担总量对账。

### 5.3 `shared/`

`shared/*` 只放稳定的跨 feature 能力，例如：

- Quiet Pro 组件原型
- 共享 hooks
- 共享类型
- 纯展示格式化
- 低上下文依赖的共享只读模型能力

判断一个能力是否应该进入 `shared/*`，至少满足：

- 已脱离单一 feature
- 语义稳定
- 不依赖页面局部状态
- 不直接承担平台细节

`shared/*` 不应成为：

- 新的 runtime adapter 桶
- 新的 persistence adapter 桶
- 新的兼容层垃圾桶

当前仓库中保留 `shared/lib/*` 这一历史子目录形态，但它的含义应理解为：

- 当前稳定共享逻辑的具体存放位置
- 不是新的“临时公共能力桶”
- 不是平台适配或持久化实现的默认落点

### 5.4 `platform/`

`platform/*` 是前端外部环境边界层，负责：

- runtime gateway
- persistence gateway
- 备份 / 更新适配
- 桌面运行时能力包装

子目录优先按能力边界命名，例如：

- `runtime/`
- `persistence/`
- `desktop/`
- `backup/`
- `storage/`

而不是优先按技术名命名。

新增前端外部环境适配默认优先进入 `platform/*`。

当前仓库中存在少量历史例外（例如 `platform/tauri/` 这类技术名目录痕迹）时，应理解为迁移遗留或占位痕迹，而不是新的命名先例；后续不应继续扩张这类目录。

### 5.5 前端兼容壳规则

前端允许保留少量兼容壳，例如：

- 为旧调用方保留的薄转发入口
- 逐步迁移中的服务形状兼容层

但这些兼容壳必须满足：

- 自身不新增 feature 私有规则
- 自身不直接承担平台实现
- 优先做转发、组合、类型兼容
- 一旦真实 owner 已清晰，新逻辑直接落到真实 owner，而不是继续堆在兼容壳上

---

## 6. Rust 长期结构

当前 Rust 长期结构为：

```text
src-tauri/src/
  main.rs
  lib.rs
  app/
  commands/
  platform/
  engine/
  domain/
  data/
```

### 6.1 `main.rs` 与 `lib.rs`

它们负责应用入口与总装配。

允许承担：

- context 获取
- builder 组装
- plugin 注册
- invoke handler 汇总
- setup 链路接入

不应承担：

- 厚业务逻辑
- 仓储实现
- 平台细节
- 核心 tracking 规则

### 6.2 `app/`

`app/*` 负责：

- Tauri 应用装配
- runtime state
- tray / window 生命周期协调
- 应用级启动链路

`app/*` 不负责：

- 仓储细节
- SQLite pool 获取或 SQL 事务
- `data::repositories::*` 直连
- 厚领域判断
- 第二套业务中心

### 6.3 `commands/`

`commands/*` 只做：

- `#[tauri::command]` 入口
- 参数接收
- DTO 映射
- 转发到 `app / engine / data`

`commands/*` 不做：

- 大段业务判断
- 复杂时序编排
- 平台 API 细节
- 仓储实现细节

### 6.4 `platform/`

`platform/*` 负责：

- Windows API 细节
- 前台窗口、图标、电源事件等平台能力
- 系统 wall clock 等外部环境事实；领域决策需要确定性时应接收注入时间，而不是在 domain 内直接读取时钟
- 未来其他平台的隔离落点

目标是：

- 隔离平台实现
- 避免平台细节泄漏到 `engine`
- 避免平台语义污染 `domain`

### 6.5 `engine/`

`engine/*` 是产品核心行为层，负责：

- tracking 主链
- session 生命周期与时序
- watchdog / self-heal / updater 等核心流程
- 与平台事件、数据边界对接的行为编排

tracking 相关逻辑应继续在：

```text
engine/tracking/
  runtime.rs
  transition.rs
  active_session.rs
  continuity.rs
  session_timeout.rs
  sustained_participation.rs
  watchdog.rs
  startup.rs
  metadata.rs
  runtime/
    loop_state.rs
    power_lifecycle.rs
    support.rs
    window_polling.rs
```

这一结构中演进，而不是回流到单个超厚文件或入口层。
`runtime.rs` 保持主循环编排；持续参与、连续性、封口、轮询、电源生命周期等细节优先留在相邻 owner 模块内。

`engine/tracking` 统一决定应用的有效活动区间，协调转换、暂停、排除、电源、watchdog 和恢复边界。转换失败不得推进已提交状态；失效资格必须先反映到快照，旧采样、请求和持续参与状态不得跨停止边界复用。中断恢复使用最后成功采样，普通心跳不证明活动；证据缺失或无效时以会话起点结束，不补记停机时间。

`engine/web_activity` 根据原生追踪资格处理网页观察，跨仓契约见 [Web Activity 协议](./web-activity-protocol.md)。详情只消费有效事实；轻量工具由自己的 owner 决定时间语义。

### 6.6 `domain/`

`domain/*` 负责：

- 领域名词
- 共享实体
- 值对象
- 不变量
- 状态转换语义
- 跨层稳定契约

它不应只是：

- DTO 仓库
- 临时 struct 存放点

### 6.7 `data/`

`data/*` 负责：

- sqlite pool
- migrations
- repositories
- backup / restore 数据读写
- 数据边界与仓储实现

它必须持续拦住这些细节回流到：

- `commands/*`
- `app/*`
- `engine/*`

`data/repositories/web_activity` 维护网页事实及其原生会话关联 `web_activity_native_sessions`，不推测关联旧历史。原生结束与关联网页裁剪、网页停用与当前网页结束，均须原子提交并更新修订。删除原生记录只清除关联，网页历史仍由其清理入口管理。

备份恢复使用归档自身的采样和观察证据结束开放活动，并映射会话身份；不得借用目标库心跳延长归档记录，也不得复用恢复前的活动资格。

### 6.8 Rust 兼容与演进规则

Rust 侧允许为了稳定演进保留少量入口协调或兼容封装，但规则是：

- 新增核心逻辑优先进入 `engine / domain / data`
- `app/*` 只保留装配与 runtime 协调，不吸收厚业务
- `commands/*` 只保留 IPC 边界适配，不吸收流程编排
- 如果某段逻辑未来还会继续增长，优先先给它一个真实 owner，而不是暂挂在入口层

### 6.9 运行身份与持久化隔离

安装版、日常开发版和隔离验证版可以同时运行，但必须是不同的运行身份，而不是共享同一身份后再靠调用纪律避让：

- 正式安装版使用 `com.ceceliaee.patina` 与 `Patina` 数据目录。
- `npm run tauri dev` 必须自动合并 `src-tauri/tauri.dev.conf.json`，使用 `com.ceceliaee.patina.dev`、`Patina Dev` 数据目录和独立单实例作用域。
- 本地 release 验证需要独立身份时使用 `src-tauri/tauri.local.conf.json`，不得把普通 debug 构建指向正式版数据。
- `platform/app_paths.rs` 是运行身份到数据、缓存路径映射的唯一 owner；调用方不得自行拼接正式版、开发版目录。
- debug 构建若仍携带正式版身份，必须在接触数据 anchor、SQLite、备份或 WebView 持久化之前失败关闭；只有显式提供绝对隔离根目录的自动化测试可例外。
- 正式构建与安装包仍使用默认生产配置。开发入口的保护不得改变 `tauri build`、发布签名或安装版升级路径。

这条边界的目的不是禁止共存，而是保证共存时迁移、设置、备份、单实例锁与 WebView 状态互不污染。数据库 migration 只负责同一运行身份内的版本升级，不能承担开发版与安装版之间的并发兼容。

---

## 7. 新增代码 owner 与落点

新增代码先判断真实 owner，再选择最小作用域；不能先选一个方便目录，再为其补理由。

| 问题 | 前端落点 |
| --- | --- |
| 某个 feature 私有的 UI、状态、hook、service 或读模型 | `features/*` 下对应 owner |
| 稳定、低上下文依赖且跨 feature 的类型、纯函数或组件 | `shared/*` |
| Tauri、SQLite、本地桌面环境等外部适配 | `platform/*` |
| 应用启动、壳层或跨 feature 编排 | `app/*` |

| 问题 | Rust 落点 |
| --- | --- |
| Tauri 命令入口与参数映射 | `commands/*`，保持薄 |
| 应用装配、生命周期或 runtime 协调 | `app/*` |
| Windows、系统 API 与其他平台事实 | `platform/*` |
| 核心行为流程 | `engine/*` |
| 领域语义与稳定契约 | `domain/*` |
| SQLite、仓储、migration 与数据边界 | `data/*` |

补充边界：

- settings 页面私有保存、清理、备份与恢复流程归 `features/settings/*`；应用启动读取偏好和 tracker health 协调归 `app/services/*`；原始 persistence adapter 归 `platform/persistence/*`。
- 持续参与识别按 `platform/windows/* -> domain/tracking* -> engine/tracking/*` 的 owner 链收口，不回流到 `commands/*`、`lib.rs` 或前端本地规则。
- 不能明确证明共享时，先留在 feature 或最小 owner；不能明确证明平台边界时，不进入 `platform/*`。

## 8. 禁止事项

- 不为了目录整齐做大规模无收益迁移
- 不恢复根层 `src/lib/*`
- 不恢复根层 `src/types/*`
- 不让 `shared/*` 重新变成跨层垃圾桶
- 不让 `platform/*` 变成万能目录
- 不让页面组件直接依赖 DB 或平台细节
- 不让 `app/*` 长成新的全局业务中心
- 不让 `commands/*` 回胖成业务中心
- 不让 `engine/*` 重新收缩为单个超厚文件
- 不把“文件位置看起来对了”误判为“职责已经收口”

---

## 9. 当前重点防守区

当前稳定期最需要防止回流的高风险区域包括：

- 前端 `app/*`
- 前端 `shared/*`，尤其是 `shared/lib/*`
- 前端 `platform/*`
- Rust `lib.rs`
- Rust `app/*`
- Rust `commands/*`

这些区域不是不能改，而是默认应带着更强的警惕心修改：

- 先确认 owner
- 先确认是不是在吸收本不属于它的逻辑
- 先确认有没有把真实 owner 延后

如果一个改动会让这些高吸力层明显变厚，应优先暂停并重新判断边界。

---

## 10. 如何判断架构在健康落地

当下面这些现象稳定存在时，可以认为架构在健康落地：

- 新增前端代码默认落在 `app / features / shared / platform`
- 新增 Rust 核心逻辑默认进入 `engine / domain / data`
- 页面组件不再自然碰基础设施
- 平台适配不再散落在多个层级
- `commands/*` 与 `lib.rs` 没有重新变厚
- `engine/*` 通过显式数据端口隔离持久化，并只调用 `platform/*` 暴露的窄平台能力；原始 Windows API 实现不得进入 engine，跨 owner 的数据实现与生命周期由 `app/*` 组合
- `platform/*` 只报告外部环境事实或实现显式端口，不反向调用应用层
- `shared/*` 没有新增明显的过渡职责
- `domain/tracking.rs` 这类领域聚合出口保持薄，稳定语义继续拆入明确 owner 的 `domain/tracking/*` 子模块
- 前端与 Rust 的高吸力层边界有轻量自动化门禁覆盖，而不是只依赖人工记忆
- 新问题默认先判断 owner，再实现
- 关键路径变更可以通过固定验证快速回归

---

## 11. 最低验证门槛

验证强度按改动风险选择：前端与文档默认入口是 `npm run check`；Rust、结构边界或发布级复核使用 `npm run check:full`。`package.json` 是命令组合与叶子执行图的唯一 owner，本文不复制该清单；具体风险追加规则见 [`engineering-quality.md`](./engineering-quality.md)。

边界门禁必须覆盖静态与动态 import、重导出、直接 IPC 调用和剥离测试模块后的 Rust 生产依赖。例外只能是精确、可审计且有自测的局部例外，不能使用目录级通配豁免。真实 runtime、IPC 注册或 capability 变更还需要真实 Tauri runtime smoke，静态一致性不能代替运行时证据。

## 12. 与其他长期文档的关系

本文件回答“代码结构应该如何长期收敛”。

它与其他长期文档的关系如下：

- 与 [`product-principles-and-scope.md`](./product-principles-and-scope.md) 互补：产品原则决定“什么值得做”，本文件决定“代码应该怎么承接”。
- 与 [`roadmap-and-prioritization.md`](./roadmap-and-prioritization.md) 互补：路线图决定“什么先做”，本文件决定“做的时候落在哪一层”。
- 与 [`quiet-pro-component-guidelines.md`](./quiet-pro-component-guidelines.md) 互补：Quiet Pro 约束视觉与组件边界，本文件约束代码与所有权边界。
- 与 [`issue-fix-boundary-guardrails.md`](./issue-fix-boundary-guardrails.md) 互补：边界守则决定具体问题如何分流，本文件提供分流时依赖的长期结构基线。
- 与 [`versioning-and-release-policy.md`](./versioning-and-release-policy.md) 互补：发布规范决定什么样的变更可以形成正式版本，本文件决定这些变更如何稳定落地。
- 与 [`localization.md`](./localization.md) 互补：本文件确定 owner 边界，本地化文档定义仓库级消息契约和贡献流程。

### 本地化 owner 边界

本地化的人工源、生成边界、前端与 Rust runtime owner 统一由 [`localization.md`](./localization.md) 定义。架构层只要求 locale 作为显示派生和缓存的显式输入，语言无关 read model 不携带本地化字符串，generated 文件不成为人工 owner。

## 13. 执行约束

- 按本文件方向在当前任务触及的范围内渐进收敛，不做一次性全仓库重构。
- owner 不清时先按 [`issue-fix-boundary-guardrails.md`](./issue-fix-boundary-guardrails.md) 分流。
- 兼容壳或临时例外必须证明真实兼容边界、owner 和退出条件，不能成为新的长期落点。
