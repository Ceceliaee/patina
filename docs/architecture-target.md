# 架构目标文档

## 1. 文档定位

本文件是本项目的长期架构说明文档。

它回答的不是“目录怎么摆更整齐”，而是下面这些更长期的问题：

- 现在这套代码的真实结构是什么
- 当前最主要的架构压力来自哪里
- 未来目标架构应该收敛成什么样
- 以后新增代码默认应该落在哪一层
- 渐进重构时，优先应该收口哪些边界

如果某份一次性执行单与本文件冲突，以本文件的长期方向为准。

---

## 2. 这次更新后的核心判断

本项目已经不再处于“先搭骨架”的阶段，而是进入了“骨架基本存在，继续收口职责”的阶段。

当前最重要的变化有 3 个：

- 前端的 `feature-first` 骨架已经基本成立，但运行时适配、共享读模型、遗留基础设施仍然交织。
- Rust 侧的层级已经拉开，但 `tracking` 核心链路仍然偏厚，`domain` 仍偏轻。
- 前后端之间实际上已经形成了“Rust 运行时 + 前端本地读写 + Tauri IPC”三条协作通道，长期必须把这三条通道的边界讲清楚。

也就是说，当前的长期架构问题已经不是“有没有目标结构”，而是：

- 如何让新增代码不再回流到遗留层
- 如何把运行时边界、数据边界、共享边界继续拉清楚
- 如何在不做大爆炸重构的前提下，持续把代码推向更稳定的结构

---

## 3. 系统现实

本项目不是普通 Web 后台，而是一个：

- `Tauri v2` 桌面应用
- `Rust + React + TypeScript` 双栈工程
- 本地优先、SQLite 驱动的数据产品
- 强依赖 Windows 前台窗口、图标、锁屏、休眠等平台能力的时间追踪工具

这意味着长期架构设计要优先服务于：

- 稳定运行时
- 清晰边界
- 可回归行为
- 渐进迁移
- 对本地数据与平台细节的可控性

而不是追求一次性重排目录或套用抽象层级模板。

---

## 4. 当前架构体检

### 4.1 前端现状

当前前端已经明显收敛到下面这个现实形态：

```text
src/
  app/
  features/
    classification/
    dashboard/
    history/
    settings/
    update/
  shared/
  lib/
  types/
```

它已经具备这些积极信号：

- `app / features / shared` 主骨架已经建立
- 页面级 UI 已经基本按 feature 组织
- 共享组件、共享 hooks、共享类型已经开始稳定
- settings / history / dashboard / classification 的主落点已经比较清楚
- `update` 已经作为一个支持型 feature 出现，而不再散落为页面局部逻辑

但当前前端也存在 5 个明确压力点：

#### 4.1.1 `app/` 仍承担较重的跨 feature 编排

`app/` 目前不仅承担壳层、启动和全局 provider，还承担了：

- 视图切换
- 脏状态协调
- toast / dialog 编排
- 预热缓存
- 更新入口协调
- 活动窗口与 tracker 健康状态同步

这说明 `app/` 方向是对的，但仍需要继续向“壳层与运行时编排”收敛，而不是继续长成新的全局业务层。

#### 4.1.2 前端还没有一个明确的 `platform` 落点

当前与 Tauri / 本地运行时 / 本地存储打交道的能力散落在：

- `app/services/*Runtime*`
- `shared/lib/*Adapter*`
- `src/lib/db.ts`
- `src/lib/settings-store.ts`
- `src/lib/classification-store.ts`

这意味着“平台适配”“持久化细节”“共享只读能力”还没有被完全区分开。

#### 4.1.3 `shared/lib/*` 同时承接了多种角色

当前 `shared/lib/*` 中同时存在：

- 共享 facade
- 读模型组装
- persistence adapter
- runtime adapter
- 文本清洗和展示辅助

这层已经有价值，但如果不继续收敛，很容易再次变成“新的过渡桶”。

#### 4.1.4 `src/lib/*` 仍是遗留基础设施带

当前 `src/lib/*` 中仍保留了较多历史核心能力，例如：

- `ProcessMapper`
- `classification-store`
- `settings-store`
- `db`
- `config/*`

这说明 `src/lib/*` 仍是前端最主要的遗留压力来源。它不是错误目录，但它必须继续缩小，而不是继续接收新职责。

#### 4.1.5 类型边界尚未完全收敛

当前类型分散在：

- `features/*/types.ts`
- `shared/types/*`
- `src/types/*`
- 部分 `lib/*`

这在迁移阶段可以接受，但长期上需要继续收口为：

- feature 私有类型回 feature
- 跨 feature 契约回 `shared/types`
- 暂未归位的历史类型逐步退出根层 `src/types`

---

### 4.2 Rust 现状

当前 Rust 源码已经基本形成下面这个现实骨架：

```text
src-tauri/src/
  main.rs
  lib.rs
  app/
  commands/
  platform/
    windows/
  engine/
  data/
    repositories/
  domain/
```

它已经具备这些积极信号：

- `app / commands / platform / engine / data / domain` 主层级已经建立
- `commands/*` 整体仍然比过去更薄
- `platform/windows/*` 已经隔离了不少 Windows 细节
- `data/*` 已经形成了清晰的仓储与 migration 落点
- `domain/*` 已经不再完全空心

但当前 Rust 仍有 4 个关键压力点：

#### 4.2.1 `lib.rs` 仍然承担较重的总装配责任

当前 `lib.rs` 中仍集中着：

- Tauri builder 装配
- plugin 注册
- runtime state 注册
- invoke handler 汇总
- setup 链路接入

这本身不一定错误，但长期需要避免继续把更多业务流程塞回 `lib.rs`。

#### 4.2.2 `app/runtime.rs` 仍然偏厚

它当前同时承担了：

- autostart 协调
- tray 初始化
- desktop behavior 同步
- updater 启动检查
- tracking runtime 守护与拉起

这说明 `app/` 已经在承担真正的应用装配职责，但还需要继续避免变成“第二个业务中心”。

#### 4.2.3 `engine/tracking_runtime.rs` 仍然是最重的核心模块

当前 tracking runtime 里仍然混合了多种职责：

- 前台窗口轮询
- session 切换规则
- 看门狗逻辑
- 启动自愈
- 图标/元数据提取
- 事件发射
- 大量 tracking 规则与测试

这说明 `engine/` 是对的，但 tracking engine 还需要继续纵向拆分，而不是让核心逻辑长期停留在单个超厚文件里。

#### 4.2.4 `domain/` 仍偏 DTO 化

当前 `domain/*` 里已经有：

- tracking 相关载荷和身份类型
- settings 解析
- backup / update 相关模型

但长期上它不能只承担“放共享 struct 的地方”，还要逐步承接：

- 领域名词
- 不变量
- 状态转换语义
- 跨层稳定契约

---

### 4.3 前后端协作现状

当前系统实际上同时存在 3 条协作通道：

#### 4.3.1 Rust 运行时通道

Rust 负责：

- 前台窗口采样
- session 生命周期
- 锁屏/休眠等平台边界
- updater / tray / autostart 等桌面行为

这是产品最关键的运行时主链。

#### 4.3.2 Tauri IPC 通道

前端通过 command / event 与 Rust 协作，用于：

- 获取活动窗口
- 同步 tracker 事件
- 设置桌面行为
- 更新与备份能力

这条通道已经存在，但前端侧仍缺少统一的 `platform` 落点来组织这些 gateway。

#### 4.3.3 前端本地 SQLite 通道

前端当前仍通过 `@tauri-apps/plugin-sql` 直接访问本地 SQLite，用于：

- settings 读写
- classification 读写
- history/dashboard 读模型查询

这条通道在本地优先桌面应用里并不是天然错误，但它必须被明确定义为“什么可以直连、什么必须走 Rust”的架构规则，而不是继续模糊存在。

---

## 5. 长期目标架构

### 5.1 前端目标骨架

前端长期目标不再只是 `app / features / shared / lib`，而是进一步明确为：

```text
src/
  app/
  features/
    dashboard/
    history/
    classification/
    settings/
    update/
  shared/
  platform/
```

其中：

- `app/`：应用壳层、启动链路、全局 provider、跨 feature 编排
- `features/`：产品能力单元，既包括页面型 feature，也包括支持型 feature
- `shared/`：稳定的跨 feature UI、纯函数、共享类型、共享只读模型
- `platform/`：与 Tauri、事件、命令、SQLite、本地桌面环境打交道的前端边界层

这里的关键变化是：

- 不再让平台适配散落在 `app`、`shared/lib`、`src/lib`
- 不再让 `src/lib` 同时扮演“基础设施”“共享逻辑”“临时收纳箱”三种角色
- 前端终局架构里不再保留 `src/lib/`，它只在迁移阶段作为遗留过渡区存在

---

### 5.2 Rust 目标骨架

Rust 长期目标骨架保持为：

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

但更新后的重点不再是“有没有这些目录”，而是：

- `engine/` 是否真正承接产品核心行为
- `domain/` 是否真正承接领域语义
- `data/` 是否真正拦住数据细节回流
- `commands/` 是否持续保持薄
- `app/` 是否保持装配与 runtime 协调身份

长期上，tracking 相关代码更理想的形态应继续演进为：

```text
engine/
  tracking/
    runtime.rs
    lifecycle.rs
    transition.rs
    watchdog.rs
    metadata.rs
  updater/
```

这不是要求立刻拆目录，而是明确：单个超厚 tracking runtime 文件不是最终状态。

---

### 5.3 前后端契约目标

长期上，前后端协作应明确为：

- Rust 拥有运行时与写侧主链
- 前端拥有 UI、交互编排、读模型组织
- IPC 契约保持稳定、可解析、可测试
- 直接 SQLite 访问被收敛到显式边界，而不是散落在任意页面逻辑中

更具体地说：

- 涉及运行时状态改变、平台能力调用、桌面行为变更的操作，优先走 Rust command / event
- 涉及本地只读查询、读模型汇总、轻量本地设置读取的历史路径，可以阶段性保留，但应逐步收敛到 `platform/` 明确出口
- 双端共享的载荷契约优先放在稳定的共享类型层中维护，而不是各自随手定义

---

## 6. 分层职责定义

### 6.1 前端 `app/`

`app/` 负责：

- 应用入口与壳层
- 启动 bootstrap
- 全局 provider
- 页面切换与全局对话框
- 跨 feature 运行时协调

`app/` 不负责：

- feature 私有规则
- feature 私有格式化
- 直接写 SQL
- 共享通用组件
- 持续膨胀成新的全局 service 层

---

### 6.2 前端 `features/`

`features/*` 负责产品能力闭环。

这里的 feature 可以是两种：

- 页面型 feature：`dashboard`、`history`、`classification`、`settings`
- 支持型 feature：`update`

每个 feature 优先拥有自己的：

- `components/`
- `services/`
- `hooks/`
- `types.ts`

但不强求形式对称，真正重要的是职责闭环。

---

### 6.3 前端 `shared/`

`shared/` 只放稳定的跨 feature 能力，例如：

- Quiet Pro 组件原型
- 共享 hooks
- 共享类型
- 纯展示格式化
- 不依赖单一 feature 上下文的只读模型能力

`shared/` 不能继续变成：

- 新的 runtime adapter 桶
- 新的 persistence adapter 桶
- 新的“多个地方可能会用”的杂项目录

判断是否该进 `shared`，至少满足：

- 已脱离某个 feature
- 语义稳定
- 不依赖页面局部状态
- 不直接承担平台细节

---

### 6.4 前端 `platform/`

这是这次更新新增明确化的一层。

`platform/` 负责前端侧的外部边界适配，例如：

- runtime gateway（当前底层实现可基于 Tauri command / event）
- persistence gateway（如 SQLite 访问入口）
- 本地文件/备份/更新适配
- 桌面运行时能力的前端包装

`platform/` 下的子目录应优先按能力边界命名，例如：

- `runtime/`
- `persistence/`
- `desktop/`

而不是优先按技术名命名，例如 `tauri/`、`sqlite/`。

长期目标不是立刻把所有文件搬进去，而是以后凡是“面向外部环境”的前端能力，都应优先思考是不是属于 `platform/`，而不是继续分散在：

- `app/services`
- `shared/lib`
- `src/lib`

---

### 6.5 前端 `lib/`

`src/lib/` 的当前定位是：

- 历史遗留基础设施
- 尚未迁出的兼容层
- 需要被持续压缩的过渡区

它不是前端长期正式层。

长期终局是：

- 前端不再有 `src/lib/`
- 其中现有职责被分流到 `app / features / shared / platform`

因此：

- 新增代码默认不应再进入 `src/lib/*`
- 只有在明确属于“暂时无法归位的历史底层能力”时，才允许继续停留
- 每次触及 `src/lib/*` 时，优先考虑是否能顺手向 `features / shared / platform` 迁一小步

---

### 6.6 Rust `app/`

Rust `app/` 负责：

- Tauri 应用装配
- runtime state
- tray / window 生命周期协调
- 应用级启动链路

它不负责：

- 持久化细节
- 复杂业务判断
- 仓储中转
- 第二套业务入口

---

### 6.7 Rust `commands/`

Rust `commands/*` 只做：

- `#[tauri::command]` 入口
- 参数接收
- DTO 映射
- 调用 `app / engine / data`

不做：

- 大段业务判断
- 复杂时序编排
- 平台 API 细节
- 仓储实现细节

命令变厚时，默认不是接受它，而是把厚度迁出。

---

### 6.8 Rust `engine/`

`engine/` 是产品核心行为层，长期上要成为：

- tracking 主链
- session 生命周期与时序
- reducer / stats / watchdog / self-heal 等核心流程
- 与平台事件、数据边界对接的行为编排层

凡是属于“产品核心行为”的代码，长期都更应该向 `engine/*` 收口，而不是回流到：

- `lib.rs`
- `app/*`
- `commands/*`

---

### 6.9 Rust `domain/`

`domain/` 长期上应承接：

- 领域名词
- 共享实体
- 值对象
- 状态与转换语义
- 跨层稳定契约

它不应只是：

- type 仓库
- DTO 存放点
- “哪里都不太合适时先放着”的目录

---

### 6.10 Rust `data/`

`data/` 负责：

- sqlite pool
- migrations
- repositories
- backup / restore 数据读写
- 数据边界与仓储实现

长期上它必须继续拦住这些细节回流到：

- `commands/*`
- `app/*`
- `engine/*`

---

### 6.11 Rust `platform/`

`platform/` 负责：

- Windows API 细节
- 前台窗口、图标、电源事件等能力
- 将来其他平台的隔离落点

它必须做到：

- 隔离平台实现
- 避免平台细节泄漏到 `engine`
- 避免平台语义污染 `domain`

---

## 7. 数据与所有权规则

本项目长期上采用下面这条原则：

### 7.1 Rust 拥有运行时写侧主链

这些能力的主所有者是 Rust：

- 活动窗口采样
- session 生成、封口、恢复
- 锁屏/休眠/AFK 等时序处理
- updater / tray / autostart

### 7.2 前端拥有界面与读模型组织

这些能力的主所有者是前端：

- 页面状态
- 交互编排
- 读模型格式化与展示
- Quiet Pro 组件系统

### 7.3 前端直接 SQLite 访问是“受控边界”，不是自由默认

当前前端直连 SQLite 的现实可以暂时存在，但以后要遵守：

- 页面组件不能直接写 SQL
- feature 不能直接跳过边界访问底层 DB
- 直接 SQLite 访问应收敛到明确的适配器出口
- 涉及运行时写侧和平台副作用的操作，优先迁往 Rust command

---

## 8. 后续 4 个长期优先级

### 8.1 前端优先级一：把平台适配从散点收敛到 `platform/`

这是当前前端最值得新增的清晰边界。

优先收口对象包括：

- Tauri command / event gateway
- backup / update adapter
- SQLite adapter
- 桌面运行时适配

---

### 8.2 前端优先级二：推动 `src/lib/*` 走向清零

这依然是最明确的遗留收口任务。

重点不是一次性硬删目录，而是：

- 新代码不再流入
- 触及时迁一小步
- 能归位到 `features / shared / platform / app` 的，就不要继续堆在根层
- 持续把目录里的职责迁空，直到它可以被删除

---

### 8.3 Rust 优先级一：继续拆分 `engine/tracking_runtime.rs`

这是当前 Rust 架构里最显眼的收口目标。

长期上应逐步把其中的：

- 生命周期规则
- transition 规则
- watchdog
- startup self-heal
- metadata / icon 处理

拆成更清晰的 engine 子模块。

---

### 8.4 Rust 优先级二：继续充实 `domain/`

这不是为了多建几个文件，而是为了让：

- tracking 规则
- settings 语义
- update / backup 契约

拥有更稳定的领域表达，而不是长期散落在 command、engine、repository 的细节中。

---

## 9. 新增代码落点规则

以后新增代码时，默认按下面规则判断：

### 前端

- 页面私有 UI：进对应 `features/*/components`
- 页面私有状态编排：进对应 `features/*/hooks`
- 页面私有服务与读模型入口：进对应 `features/*/services`
- 应用壳层、启动链路、跨 feature 协调：进 `app/*`
- 共享组件、共享类型、共享纯函数：进 `shared/*`
- Tauri / SQLite / 本地桌面环境适配：优先进 `platform/*`
- 无法立刻归位的历史底层能力：仅在迁移阶段暂留 `src/lib/*`

### Rust

- Tauri 命令入口：进 `commands/*`
- 应用装配与 runtime 协调：进 `app/*`
- 平台 API 细节：进 `platform/*`
- 核心行为流程：进 `engine/*`
- 领域模型与语义：进 `domain/*`
- sqlite 与仓储：进 `data/*`

不确定时，优先放在最小作用域，而不是优先抽公共层。

---

## 10. 禁止事项

- 不为了目录整齐做大规模无收益迁移
- 不让 `src/lib/*` 继续成为默认新代码入口
- 不让 `shared/*` 重新变成新的跨层垃圾桶
- 不让 `app/*` 长成新的全局业务中心
- 不让页面组件直接依赖 DB 或平台细节
- 不让 `commands/*` 回胖成业务中心
- 不让 `engine/*` 长期停留为单个超厚文件
- 不把“目录存在”误判为“职责已经收口”

---

## 11. 如何判断长期方向正在落地

当下面这些现象越来越稳定时，可以认为长期方向正在健康落地：

- 新增前端代码默认落在 `app / features / shared / platform`
- `src/lib/*` 不再自然膨胀
- `src/lib/*` 持续减少并最终可以整体删除
- 平台适配不再散落在多个层级
- 页面组件默认不再直接碰基础设施
- Rust 新增业务逻辑默认进入 `engine / domain / data`
- `commands/*` 与 `lib.rs` 没有重新变厚
- tracking engine 被持续拆细，而不是继续在单文件中累积
- 重大功能开发不再需要先做一轮全局边界清理

---

## 12. 给 Codex 的执行约束

- 按本文件方向收敛，但不要做一次性全仓库重构
- 优先在当前任务真正触及的区域里推进一小步
- 如果某次任务会新增前端外部环境适配，优先考虑是否该落到 `platform/*`
- 如果某次任务触及 `src/lib/*`，优先判断能否顺手迁到更明确的 owner 层
- 如果某次任务触及 tracking 核心链路，优先考虑是否应向 `engine/*` 拆分
- 如果某次任务涉及边界归属不清，先按 [`issue-fix-boundary-guardrails.md`](./issue-fix-boundary-guardrails.md) 做分流，再决定是否直接实现
> 维护期注记（2026-04-16）
>
> 本文件最初包含一轮迁移期的“架构体检 + 目标收敛”描述。自 2026-04-16 起，下列事项已经完成并应视为当前长期基线：
> - 前端 `platform/` 已建立，`src/lib/` 与根层 `src/types/` 已退出。
> - Rust `tracking` engine 已完成 `engine/tracking/*` 多模块拆分。
> - Rust `domain/` 已承接 `tracking / settings / backup / update` 的稳定语义契约。
> - Rust `lib.rs`、`commands/*` 与 `app/runtime.rs` 已完成一轮瘦身。
>
> 因此，下文 4.x、8.x、11.x 中仍以“待迁移 / 待拆分 / 待退出”表述的段落，应视为迁移期历史背景，而不是当前执行清单。当前执行基线以本注记、[`AGENTS.md`](../AGENTS.md)、[`architecture-migration-checklist.md`](./architecture-migration-checklist.md) 的已完成状态，以及仓库现状为准。
