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

历史迁移背景与上一轮收口记录保留在：

- [`archive/architecture-target.md`](./archive/architecture-target.md)
- [`archive/architecture-migration-checklist.md`](./archive/architecture-migration-checklist.md)

---

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

### 3.2 运行时写侧归 Rust，界面与读模型归前端

Rust 拥有运行时主链和写侧副作用；前端拥有 UI、交互编排和读模型组织。

### 3.3 平台细节必须显式收口

与 Tauri、SQLite、本地桌面环境、Windows API 打交道的能力必须有明确边界，不应散落在页面、壳层或临时 util 中。

### 3.4 共享层只承接稳定共享能力

`shared/*` 不是“多个地方都可能会用”的暂存区，只容纳稳定、低上下文依赖、跨 feature 的能力。

### 3.5 入口层保持薄

前端 `app/*`、Rust `lib.rs` 与 `commands/*` 都属于高吸力层。它们可以编排，但不应沉淀厚业务实现。

### 3.6 渐进重构优先于大爆炸

允许在真实任务中顺手推进一小步边界收敛，但不为了“目录更整齐”做无收益搬迁。

### 3.7 例外必须显式且尽量变薄

稳定期允许存在少量兼容壳、转发层或历史适配层，但前提是：

- 它确实在服务兼容或平滑迁移
- 它不承接新的厚逻辑
- 它有明确 owner
- 它不会重新把边界变模糊

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

### 4.3 前端本地 SQLite 通道

前端当前保留受控的本地 SQLite 读访问，用于：

- settings 读取
- classification 读取
- history / dashboard 读模型查询

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

### 4.4 浏览器扩展伴生边界

`Patina Web Sync` 浏览器扩展是 `Patina` 的外部 companion，不属于主仓库内的前端 feature、Rust runtime 或发布产物。

边界规则如下：

- `Patina` 拥有本机 HTTP 接收端、token 校验、网页活动写入、备份恢复、清理历史、History / Classification 读模型和 Settings 配置说明
- `Patina Web Sync` 独立仓库拥有 Chromium / Firefox 扩展源码、manifest 版本、商店素材、Firefox AMO 签名和扩展 release asset
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

- `update`

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

### 6.8 Rust 兼容与演进规则

Rust 侧允许为了稳定演进保留少量入口协调或兼容封装，但规则是：

- 新增核心逻辑优先进入 `engine / domain / data`
- `app/*` 只保留装配与 runtime 协调，不吸收厚业务
- `commands/*` 只保留 IPC 边界适配，不吸收流程编排
- 如果某段逻辑未来还会继续增长，优先先给它一个真实 owner，而不是暂挂在入口层

---

## 7. 新增代码决策顺序

新增代码时，先不要问“放哪里最方便”，而是按下面顺序判断 owner。

### 7.1 前端 owner 判断顺序

1. 它是不是某个 feature 私有的 UI、状态或服务？
2. 如果不是，它是不是稳定的跨 feature 共享能力？
3. 如果不是，它是不是前端与外部环境打交道的边界适配？
4. 如果不是，它是不是应用壳层或跨 feature 编排？

默认映射：

- feature 私有能力：进 `features/*`
- 稳定共享能力：进 `shared/*`
- 外部环境适配：进 `platform/*`
- 壳层 / 编排：进 `app/*`

### 7.2 Rust owner 判断顺序

1. 它是不是 Tauri 命令入口或参数映射？
2. 如果不是，它是不是应用装配或 runtime 协调？
3. 如果不是，它是不是平台 API 细节？
4. 如果不是，它是不是核心行为流程？
5. 如果不是，它是不是领域语义或稳定契约？
6. 如果不是，它是不是数据边界与仓储实现？

默认映射：

- 命令入口：进 `commands/*`
- 装配 / 协调：进 `app/*`
- 平台细节：进 `platform/*`
- 核心行为：进 `engine/*`
- 领域语义：进 `domain/*`
- 数据细节：进 `data/*`

---

## 8. 新增代码落点规则

### 8.1 前端

- 页面私有 UI：进对应 `features/*/components`
- 页面私有状态编排：进对应 `features/*/hooks`
- 页面私有服务与读模型入口：进对应 `features/*/services`
- 应用壳层、启动链路、跨 feature 协调：进 `app/*`
- settings 页面保存、cleanup、backup、restore 等页面私有流程：进 `features/settings/*`
- 应用启动读取当前设置、tracker health 读取与 `min_session_secs` 这类应用级偏好协调：进 `app/services/*` 对 `platform/persistence/*` 的薄封装
- 原始 settings persistence adapter：进 `platform/persistence/*`，不进 `shared/*`
- 共享组件、共享类型、共享纯函数：进 `shared/*`
- Tauri / SQLite / 本地桌面环境适配：优先进 `platform/*`

### 8.2 Rust

- Tauri 命令入口：进 `commands/*`
- 应用装配与 runtime 协调：进 `app/*`
- 平台 API 细节：进 `platform/*`
- 核心行为流程：进 `engine/*`
- 领域模型与语义：进 `domain/*`
- sqlite 与仓储：进 `data/*`
- 持续参与识别相关的状态机、信号融合、identity 归一与诊断快照：继续按 `platform/windows/* -> domain/tracking.rs / domain/tracking/* -> engine/tracking/sustained_participation.rs / runtime.rs` 的 owner 链收口，不回流到 `commands/*`、`lib.rs` 或前端本地规则

不确定时，优先放在最小作用域，而不是优先抽公共层。

---

## 9. 禁止事项

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

## 10. 当前重点防守区

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

## 11. 如何判断架构在健康落地

当下面这些现象稳定存在时，可以认为架构在健康落地：

- 新增前端代码默认落在 `app / features / shared / platform`
- 新增 Rust 核心逻辑默认进入 `engine / domain / data`
- 页面组件不再自然碰基础设施
- 平台适配不再散落在多个层级
- `commands/*` 与 `lib.rs` 没有重新变厚
- `shared/*` 没有新增明显的过渡职责
- `domain/tracking.rs` 这类领域聚合出口保持薄，稳定语义继续拆入明确 owner 的 `domain/tracking/*` 子模块
- 前端与 Rust 的高吸力层边界有轻量自动化门禁覆盖，而不是只依赖人工记忆
- 新问题默认先判断 owner，再实现
- 关键路径变更可以通过固定验证快速回归

---

## 12. 最低验证门槛

稳定期不是要求每次都做最重验证，而是要求对关键边界变化至少做与风险匹配的最小验证。

默认规则：

- 改动页面展示、读模型、分类映射、tracking 前端边界时，至少运行当前仓库已有的前端验证链
- 改动运行时主链、IPC 契约、Rust 核心行为时，至少运行能覆盖该链路的现有验证，而不是只看类型通过
- 只改文档时，不要求运行构建或测试，但不能让文档与仓库现状失真

当前仓库里，前端关键路径变更的默认最小验证可参考：

- `npm run check`
- `npm run check:frontend`

结构性改动、Rust 边界改动或发布前复核默认继续使用：

- `npm run check:full`

边界门禁的当前入口包括：

- `npm run check:types`
- `npm run check:architecture`
- `npm run check:naming`
- `npm run check:hotspots`
- `npm run check:rust-boundaries`

如果某次结构性改动无法通过这些最小验证之一，应优先解释风险或补验证，而不是直接跳过。

---

## 13. 与其他长期文档的关系

本文件回答“代码结构应该如何长期收敛”。

它与其他长期文档的关系如下：

- 与 [`product-principles-and-scope.md`](./product-principles-and-scope.md) 互补：产品原则决定“什么值得做”，本文件决定“代码应该怎么承接”。
- 与 [`roadmap-and-prioritization.md`](./roadmap-and-prioritization.md) 互补：路线图决定“什么先做”，本文件决定“做的时候落在哪一层”。
- 与 [`quiet-pro-component-guidelines.md`](./quiet-pro-component-guidelines.md) 互补：Quiet Pro 约束视觉与组件边界，本文件约束代码与所有权边界。
- 与 [`issue-fix-boundary-guardrails.md`](./issue-fix-boundary-guardrails.md) 互补：边界守则决定具体问题如何分流，本文件提供分流时依赖的长期结构基线。
- 与 [`versioning-and-release-policy.md`](./versioning-and-release-policy.md) 互补：发布规范决定什么样的变更可以形成正式版本，本文件决定这些变更如何稳定落地。

---

## 14. 给 Codex 与后续协作者的执行约束

- 按本文件方向收敛，但不要做一次性全仓库重构
- 优先在当前任务真正触及的区域里推进一小步
- 新增前端外部环境适配时，优先判断是否应落到 `platform/*`
- 新增 Rust 核心逻辑时，优先判断是否应落到 `engine / domain / data`
- 如果某次任务涉及边界归属不清，先按 [`issue-fix-boundary-guardrails.md`](./issue-fix-boundary-guardrails.md) 做分流，再决定是否直接实现
- 如果需要历史迁移背景或上一轮收口记录，再回看归档架构文档，而不是把本文件重新写回迁移清单
- 如果某次任务需要引入兼容壳或临时例外，必须优先证明它不会成为新的长期落点
