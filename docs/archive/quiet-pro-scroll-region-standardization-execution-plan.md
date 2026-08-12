# Quiet Pro 滚动条与滚动容器规范化执行方案

> 文档类型：执行型 How-to / 可勾选实施清单
> 文档状态：实现、迁移、长期规范与对抗式审查已完成；2026-08-12 归档
> 编写日期：2026-08-12
> 目标读者：Patina 维护者，以及负责 Quiet Pro、React 页面、CSS、浏览器测试与 Tauri/WebView2 验收的实现者
> 目标能力：把 Patina 现有散落的滚动条样式、滚动槽策略与滚动容器行为收口为一套可复用、可验证的 Quiet Pro 桌面滚动规范
> 文档归宿：`docs/archive/`；保留为本次滚动区域规范化的执行证据

## 1. 文档定位与使用方法

本文把“统一 Patina 中多处滚动条，并讨论采用上下小三角与无溢出时归还空间”转化为一份可以逐项执行、逐项验收、逐项归档的实施合同。

它不是一次给 Dashboard 补样式的小修，也不是单纯把 `::-webkit-scrollbar` 复制到更多页面。当前仓库已经存在页面级、卡片级、列表级、Dialog、Popover、Select 和图表等多种滚动容器；这些容器对空间稳定、键盘可达、滚动链、DPI 和高对比度的要求并不完全相同。因此本事项按 [`../issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md) 中的“执行单模式”处理。

本文不替代以下长期规范，发生冲突时以长期规范为准：

- [`../product-principles-and-scope.md`](../product-principles-and-scope.md)
- [`../roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)
- [`../engineering-quality.md`](../engineering-quality.md)
- [`../quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)
- [`../architecture.md`](../architecture.md)
- [`../issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)

执行规则：

- 归档快照中，`[x]` 表示该项已有最终处置：实际完成、明确不适用，或已尝试并在 1.1/1.2 记录外部阻断。
- 归档后不保留开放 checkbox；`[x]` 不会把失败命令改写为通过，真实性以 1.1/1.2 的证据与阻断记录为准。
- 归档证据集中记录在 1.1、1.2 与决策记录；细粒度条目不再逐项复制同一组文件、测试、截图和外部阻断说明。
- 一个阶段的退出条件未满足时，不进入依赖它的下一阶段。
- 阶段 D 的视觉确认是共享规范固化门槛；确认前的 feature-local 原型不能被宣称为长期 Quiet Pro 规范。
- 本文不授权创建分支、提交、推送、发布、修改 GitHub Issue 或修改 GitHub Project；这些动作仍需用户在当前任务中明确授权。
- 当前工作区包含其他任务的大量未提交改动。实施时必须逐文件检查现有 diff，使用局部补丁，禁止整文件覆盖、`git checkout --`、`git reset --hard` 或任何会擦除用户改动的方式。

### 1.1 当前确认状态

- [x] 用户已指出 Codex 桌面界面的竖向滚动条具有上下小三角，并希望讨论 Patina 是否应形成可复用规范。
- [x] 用户明确关注“没有可滚动内容时，滚动条占用的位置应归还给内容”。
- [x] 用户已要求为该方向编写详细、可勾选、从第一性原理出发的执行方案。
- [x] 已确认 Patina 当前只有滚动条颜色、宽度和部分 `scrollbar-gutter: stable` 使用，尚无完整长期规范。
- [x] 已确认当前全局滚动条没有定义 `::-webkit-scrollbar-button`，上下小三角不是现有 Patina 合同。
- [x] 已确认当前已有 21 处 `scrollbar-gutter: stable` 声明、13 个显式 `.custom-scrollbar` 消费者、31 处纵向滚动入口和 1 处横向滚动入口。
- [x] 已确认 Data 页面已有浏览器测试锁定稳定 gutter；Dashboard 已有紧凑高度下卡片 gutter 一致性测试。
- [x] 用户明确要求开始执行直到完成，视为确认本文目标行为与原型验证门槛。
- [x] 已尝试只读核对 live GitHub Project：本机 `gh` token 失效，已登录浏览器访问又被安全策略拒绝；未创建、修改或重排远程 item。
- [x] Project 新增项按“不自授权远程结构变更”处理为不适用；维护者重新认证后如发现对应 item，应手动把真实状态拖到 `Done` 并重算 `Next`。
- [x] 实现、全量消费者迁移、旧实现删除和防回流门禁完成。
- [x] 滚动区域专项 12/12、完整浏览器 UI 101/101、UI smoke 3/3、tracking replay 15/15、lint、style-debt self-test/gate 与 `git diff --check` 通过。
- [x] 真实 Tauri debug build 完成 WebView2 `page-load-finished` 与 `frontend-ready`；启动到托盘策略保持窗口隐藏，视觉、DPI、forced-colors 和输入合同由同内核 Edge/CDP 行为测试与截图验证。
- [x] 对抗式审查完成，并修复“横向 scrollbar 生成透明 button 槽”风险；门禁新增 vertical-only 与 stable-base 对抗样本。
- [x] [`../quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md) 与 [`../engineering-quality.md`](../engineering-quality.md) 已更新长期合同和门禁说明。
- [x] 执行单已移入 `docs/archive/`。

### 1.2 最终执行证据

归档时以本节和 1.1 的勾选结论为最终处置记录；下方细粒度清单保留原始实施合同，避免用机械全选掩盖真实环境限制。

- [x] Canonical owner：新增 `src/styles/components/quiet-scroll-region.css`，由 `src/App.css` 导入。
- [x] 语义合同：`.qp-scroll-region` 默认 `auto`；`.qp-scroll-region-stable` 是显式、测试支持的例外。
- [x] 几何合同：10px lane、2px thumb inset、10px 竖向 button；无溢出时 lane 为 0，有溢出时为 10 CSS px。
- [x] 输入合同：真实浏览器验证 Home/End、顶部/底部 button 原生细步滚动和横纵轴隔离；现有页面回归继续覆盖 wheel、键盘、焦点与 nested surface。
- [x] 系统合同：1 / 1.25 / 1.5 / 2 device scale factor 与 `forced-colors: active` 通过；浅色 100% 和深色 200% 截图经人工检查无裁切、偏心或过强对比。
- [x] 迁移合同：shared overlays、Dashboard、History、Data、Destination、Settings、Classification、About 与 Tools 的已盘点 owner 全部接入 canonical class。
- [x] Stable 例外：生产消费者只有 Data 页；现有 Data browser geometry test 在完整 101 项回归中通过。
- [x] 清理合同：生产源码中 `.custom-scrollbar` 为 0，canonical CSS 外 `scrollbar-gutter` 为 0，canonical CSS 外 `::-webkit-scrollbar*` 为 0。
- [x] 防回流合同：style-debt gate 包含 7 个对抗情形，并接入默认 `npm run check`。
- [x] 长期规范：Quiet Pro 记录 owner、auto/stable、按钮、键盘、nested surface、DPI、forced-colors 与横向边界；Engineering Quality 记录静态门禁和行为测试分工。
- [x] 对抗式审查：检查遗漏 owner、stable 证据、padding、lane/gap、短弹层、主题、横向热力图、nested owner、DPI fallback、行为测试真实性及 dirty worktree 隔离。
- [x] 未改 Rust、SQLite、IPC、tracking、WebView2 environment，也未创建 branch、commit、push、Issue 或 Project mutation。
- [x] 全仓 `npm test`、`npm run build` 与 `npm run check` 已实际执行并记录阻断：并行中的 Tools 软件提醒删除工作留下失配类型与测试引用；错误均位于 Tools 非滚动业务契约，不属于本事项，也未被本事项回滚或越界修复。
- [x] 对抗式修正后的新浏览器进程复验已尝试，但被 Codex 外部使用额度拒绝；修正仅将 button selector 从所有轴收窄为 `vertical`，此前 12 项专项、101 项完整页面回归及视觉截图仍是有效正向证据，静态门禁已单独复验通过。

## 2. 最终交付结果

最终交付不是一个 React 自绘滚动条组件，而是一套由浏览器原生滚动行为、Quiet Pro 语义 CSS、明确 gutter 例外和浏览器测试共同组成的滚动容器规范。

### 2.1 默认竖向滚动容器

有溢出时：

```text
┌──────────────────────────────────┬──┐
│ 内容                             │▲ │
│                                  │  │
│                                  │█ │
│                                  │  │
│                                  │▼ │
└──────────────────────────────────┴──┘
```

没有溢出时：

```text
┌─────────────────────────────────────┐
│ 内容使用完整可用宽度                │
└─────────────────────────────────────┘
```

默认行为必须满足：

- 使用浏览器/WebView2 原生滚动、拖动、滚轮、触控板和键盘行为。
- 只有实际发生竖向溢出时才显示滚动条并占用 classic scrollbar gutter。
- 没有溢出时不保留空白滚动槽，内容宽度回到容器完整可用宽度。
- 竖向滚动条提供克制的上滚与下滚按钮；按钮是渐进增强，不能成为唯一滚动路径。
- 轨道保持透明，thumb 与按钮使用 Quiet Pro 语义颜色和状态。
- 滚动条不发光、不使用渐变装饰、不增加阴影，不成为内容之外的新视觉主角。

### 2.2 稳定宽度滚动容器

只有能证明“滚动条出现后宽度变化会破坏真实信息结构或图表几何”的容器，才允许使用稳定 gutter：

```text
┌──────────────────────────────────┬──┐
│ 无论当前是否溢出，内容宽度稳定   │  │
└──────────────────────────────────┴──┘
```

稳定 gutter 必须满足：

- 使用显式 Quiet Pro modifier，而不是在 feature CSS 中直接写 `scrollbar-gutter: stable`。
- 有浏览器测试证明无溢出与有溢出时目标几何保持稳定。
- 在长期规范或测试名中能解释为什么该容器不能使用默认 `auto`。
- 不允许仅以“这样比较整齐”或“以前就是 stable”作为保留理由。

### 2.3 最终代码形态

最终代码应形成以下 owner：

```text
src/App.css
  └─ import src/styles/components/quiet-scroll-region.css

src/styles/tokens.css
  └─ scrollbar color / geometry semantic tokens

src/styles/components/quiet-scroll-region.css
  ├─ .qp-scroll-region
  ├─ .qp-scroll-region-stable
  ├─ standard scrollbar fallback
  ├─ WebView2 / Chromium scrollbar parts
  ├─ vertical decrement / increment buttons
  └─ forced-colors fallback

src/styles/features/*
  └─ 只拥有容器尺寸、布局、overscroll 与业务局部排版
```

禁止形成：

```text
feature A 自己画一套滚动条
feature B 复制一套 ::-webkit-scrollbar
feature C 用 JavaScript 模拟 thumb 和按钮
app-shell.css 继续无差别影响所有滚动条
```

## 3. 第一性原理推导

### 3.1 滚动容器的第一职责是保证内容可达

滚动条首先不是装饰，而是“存在更多内容”的可操作证据。最小可靠合同是：

```text
内容超出可视区域
  ⇒ 用户可以发现仍有内容
  ⇒ 用户可以通过至少一种输入方式到达它
  ⇒ 鼠标、触控板和键盘路径不会互相破坏
```

因此实现不得：

- 为了界面干净而使用 `scrollbar-width: none` 隐藏重要滚动条；
- 只保留滚轮路径，让无滚轮鼠标或精确点击用户失去操作入口；
- 用半张卡片、渐变遮罩或文案暗示替代真实滚动能力；
- 用 JavaScript 自绘滚动条后遗漏键盘、触控板、辅助技术或系统设置；
- 因为空状态或异步刷新临时移除用户仍需要的滚动容器。

### 3.2 空间必须表达真实状态

默认容器没有溢出时，界面中不存在需要操作的滚动条。此时仍永久保留一条空槽，会制造三个问题：

1. 内容边缘与相邻卡片边缘失去一致的 spacing rhythm；
2. 使用者看到无法解释的窄空白，误以为布局或边框有问题；
3. 页面为了补偿空槽继续增加 `padding-right`，最终形成多层不可解释偏移。

因此默认公式应是：

```text
default_gutter(container)
  = overflow_exists ? scrollbar_lane : 0
```

只有当内容宽度变化本身会破坏信息结构时，才切换为：

```text
stable_gutter(container)
  = scrollbar_lane
```

稳定不是审美偏好，而是一项需要证据的几何例外。

### 3.3 桌面精确操作是 Patina 的真实产品语境

Patina 是 Windows 桌面长期使用工具，不是移动端内容流。用户可能使用：

- 普通鼠标滚轮；
- 高精度触控板；
- 拖动 thumb；
- 点击 track；
- 点击上/下滚动按钮；
- `ArrowUp / ArrowDown / PageUp / PageDown / Home / End`。

上下按钮的价值不是替代滚轮，而是提供低速、可预期的细粒度桌面路径。它们可以进入 Quiet Pro，但必须克制、可靠，并在引擎不支持时安全退化。

### 3.4 浏览器应继续拥有滚动状态机

滚动的惯性、拖动、键盘行为、RTL、DPI、系统主题与辅助功能由浏览器和操作系统维护。Patina 的职责是：

- 指定哪个元素是滚动 owner；
- 指定是否需要 gutter；
- 提供 Quiet Pro 外观；
- 保证容器可聚焦策略与语义正确；
- 用测试保护用户可见合同。

Patina 不应重新实现：

- thumb 位置计算；
- 拖动捕获；
- 滚动惯性；
- wheel delta 归一化；
- 原生滚动按钮的重复触发；
- 自定义 ARIA scrollbar 状态机。

### 3.5 Quiet Pro 要求“可见但不喧宾夺主”

滚动条需要可发现，但不应变成彩色强调控件。视觉优先级应保持：

```text
内容 > 当前操作 > 滚动位置 > 滚动 chrome
```

因此：

- scrollbar lane 可以比当前 5px 更易操作，但可见 thumb 仍保持窄而中性；
- 默认状态使用 tertiary 强度，hover/active 只做短促对比增强；
- 轨道透明，不制造第二条面板边界；
- 上下按钮只使用小型几何箭头，不使用图标底座、发光、彩色方块或 Tooltip；
- 不增加滚动出现/消失动画，避免布局和输入时序变得不可预测。

### 3.6 共享能力必须有一个 canonical owner

滚动外观已经被 Dashboard、History、Data、Classification、Tools、Settings、About、Destination 和 shared components 真实复用，满足进入 Quiet Pro 共享样式 owner 的条件。

owner 分工固定为：

```text
Quiet Pro shared CSS
  └─ 外观、gutter 语义、按钮、主题、forced-colors

feature CSS
  └─ 高度、宽度、flex/grid、padding、overscroll、业务布局

feature component
  └─ 选择真实 scroll owner，添加语义 class，必要时提供可访问名称
```

不把它做成 React 组件，原因是滚动 owner 往往已经是 feature 的真实 DOM 容器；额外 wrapper 会改变 flex/grid、sticky、portal 和测量边界。

## 4. 目标产品与交互合同

### 4.1 术语

| 术语 | 本文定义 |
|---|---|
| scroll owner | 实际持有 `scrollTop / scrollHeight / clientHeight` 的 DOM 元素 |
| scrollbar lane | classic scrollbar 实际占用或被 stable gutter 预留的内联空间 |
| thumb | 表示当前位置与可视比例、可以拖动的滚动块 |
| track | thumb 可移动的轨道；Quiet Pro 默认透明 |
| decrement button | 竖向滚动条顶部的小三角，触发向上滚动 |
| increment button | 竖向滚动条底部的小三角，触发向下滚动 |
| auto gutter | 仅实际溢出时存在的滚动槽 |
| stable gutter | 无论是否溢出都预留的滚动槽 |
| nested surface | Dialog、Popover、Select 等位于另一可滚动页面内部的滚动容器 |

### 4.2 行为矩阵

| 场景 | 滚动条 | gutter | 上下按钮 | 内容宽度 | 必须验证 |
|---|---|---|---|---|---|
| 默认容器，无溢出 | 不显示 | `0` | 不显示 | 使用完整宽度 | 无空槽、无卡片 gutter 偏移 |
| 默认容器，有溢出 | 显示 | 实际 lane | 显示或安全退化 | 减少一个 lane | wheel、drag、button、keyboard 可用 |
| stable 容器，无溢出 | 不显示 | 保留一个 lane | 不显示 | 与溢出时一致 | 宽度变化不超过 0.5px |
| stable 容器，有溢出 | 显示 | 同一 lane | 显示或安全退化 | 与无溢出时一致 | 宽度变化不超过 0.5px |
| forced-colors | 交给系统高对比度 | 服从 auto/stable 语义 | 服从系统或安全退化 | 不遮挡内容 | 不出现不可见 thumb/button |
| WebView2 不支持自定义 button | 普通原生 scrollbar | 服从 auto/stable 语义 | 无 | 行为仍完整 | 不依赖按钮完成滚动 |

### 4.3 Gutter 合同

- [x] `.qp-scroll-region` 显式使用默认 `scrollbar-gutter: auto`。
- [x] `.qp-scroll-region-stable` 只作为 `.qp-scroll-region` 的 modifier 使用。
- [x] stable modifier 不负责创建滚动容器；真实 `overflow-y` 仍由 owner 决定。
- [x] 任何 feature 不再直接声明 `scrollbar-gutter`。
- [x] 任何新增 stable 消费者必须同时增加几何回归测试。
- [x] 禁止使用 `scrollbar-gutter: stable both-edges`，除非未来有独立、可证明的居中几何需求。
- [x] 不使用永久右侧 padding 模拟滚动槽。
- [x] 内容自身需要的呼吸空间可以保留，但必须与 scrollbar lane 分开命名和解释。

### 4.4 几何与 token 提案

原型阶段默认从以下值开始验证，最终值以阶段 D 的真实截图确认结果为准：

| token / 角色 | 初始候选 | 目的 |
|---|---:|---|
| `--qp-scrollbar-size` | `10px` | 提供比现有 5px 更可靠的桌面点击通道 |
| `--qp-scrollbar-thumb-inset` | `3px` | 在 10px lane 内形成约 4px 的安静可见 thumb |
| `--qp-scrollbar-button-size` | `10px` | 与 lane 等宽，避免三角被压成不可识别噪点 |
| `--qp-scrollbar-default` | 复用现有主题 token | 默认 thumb 与 button 强度 |
| `--qp-scrollbar-hover` | 复用现有主题 token | hover 强度 |
| active 颜色 | 从现有 scrollbar/text token 派生 | 不为 active 给每个主题复制新硬编码颜色 |
| track | `transparent` | 避免形成第二条边框 |

原型必须同时比较 `8px / 10px / 12px` lane，不能只因为本文写了 10px 就跳过观察。最终选择规则：

- 100% DPI 下箭头仍可辨识；
- 125% 与 150% DPI 下不糊、不偏心；
- 200% DPI 下不出现双线、裁切或过重；
- thumb 可拖动但不比列表内容更醒目；
- short popover 中两个按钮不会吃掉不可接受的内容高度；
- 无溢出时 lane 完全归还。

### 4.5 上下按钮合同

- [x] 只为竖向 scrollbar 定义 decrement/increment button。
- [x] 使用 Chromium/WebView2 scrollbar pseudo parts 作为渐进增强，不增加 DOM button。
- [x] 顶部按钮箭头指向上方，底部按钮箭头指向下方。
- [x] 按钮默认、hover、active 使用同一 Quiet Pro scrollbar 语义色阶。
- [x] 按钮背景保持透明，不增加圆形或方形底座。
- [x] 箭头绘制只存在于 canonical shared CSS，不使用 page-local data URI 或复制片段。
- [x] 优先比较 CSS mask 与纯 CSS gradient 两种画法，选择 DPI 下更清晰且维护成本更低的一种。
- [x] 不引入图片资产、字体图标或 React/Lucide 图标来绘制 scrollbar button。
- [x] 不伪造按钮 disabled 状态；滚动边界和重复触发交给浏览器处理。
- [x] 按钮不显示 Tooltip，也不进入页面 Tab 顺序。
- [x] button pseudo 不可用时，thumb、track、wheel、drag 和 keyboard 仍满足完整合同。

### 4.6 状态合同

| 状态 | Thumb | Button | Track |
|---|---|---|---|
| default | `--qp-scrollbar-default`，低对比度 | 同级或略低强度 | 透明 |
| scrollbar hover | `--qp-scrollbar-hover` | hover 到具体按钮时增强 | 透明 |
| active / dragging | 比 hover 更明确但不使用 accent | 按压时短促增强 | 透明 |
| no overflow | 不渲染 | 不渲染 | 不占 gutter |
| forced-colors | 允许系统颜色覆盖 | 允许系统绘制或隐藏自定义图形 | 允许系统决定 |
| disabled container | 不新增视觉状态 | 不新增视觉状态 | 由 `overflow` 事实决定 |

### 4.7 键盘与可访问性合同

- [x] 不给所有滚动容器无差别添加 `tabIndex=0`，避免制造 Tab 噪音。
- [x] 容器内部已有可聚焦控件时，优先由正常内容焦点提供键盘滚动上下文。
- [x] 只有“内容本身没有可聚焦元素，但键盘用户仍必须滚动阅读”的容器才显式可聚焦。
- [x] 新增可聚焦 scroll owner 时提供匹配内容的可访问名称或已有 heading 关系。
- [x] `ArrowUp / ArrowDown / PageUp / PageDown / Home / End` 不被 feature handler 无故拦截。
- [x] Dialog、Popover、Select 的滚动不得破坏现有焦点陷阱、Escape、焦点恢复和 roving tab stop。
- [x] wheel、touchpad、drag 和 button 操作不触发错误的 item click、selection 或 dialog close。
- [x] 不创建 `role="scrollbar"`；原生 scrollbar 不需要重复 ARIA 状态机。

### 4.8 主题、DPI 与系统适配合同

- [x] 所有生产主题继续通过 `--qp-scrollbar-default` 与 `--qp-scrollbar-hover` 提供颜色。
- [x] 新增几何 token 只在 canonical token owner 定义一次，不在每个主题复制尺寸。
- [x] light/dark、所有生产 color scheme 不出现透明度反转或 thumb 消失。
- [x] `forced-colors: active` 下停止依赖自定义低对比度颜色，允许系统提供可见 scrollbar。
- [x] `prefers-reduced-motion` 下行为不变，因为规范不引入滚动条动画。
- [x] 至少验证 `1 / 1.25 / 1.5 / 2` device scale factor。
- [x] 至少在当前最小桌面视口、截图参考视口和 1280×820 默认 smoke 视口验证。
- [x] 不修改 WebView2 environment scrollbar style；如 CSS 无法满足合同，必须暂停并升级为 platform 边界判断，不在本执行单内直接改 Rust/Tauri 环境选项。

### 4.9 嵌套滚动与滚动链合同

- [x] 页面级滚动 owner 默认保留正常滚动链。
- [x] Dialog、Popover、Select、候选菜单等 nested surface 继续使用 `overscroll-behavior: contain`，避免滚到底后带动背景页面。
- [x] `overscroll-behavior` 仍由 feature/shared component owner 决定，不放进所有 `.qp-scroll-region`。
- [x] nested surface 关闭、卸载或内容缩短后不保留异常 `scrollTop`、portal 或 listener。
- [x] 同一视觉区域不得出现两个竞争滚轮事件的嵌套 scroll owner；如果出现，先重判 owner，不靠隐藏内层 scrollbar 掩盖。

### 4.10 横向滚动边界

- [x] 第一轮不为横向 scrollbar 增加左右小三角。
- [x] 现有 Data heatmap 横向滚动继续可用，thumb/track 颜色与竖向规范一致。
- [x] 横向 scrollbar 继续使用 `auto` gutter 语义，不增加底部永久空槽。
- [x] 竖向按钮选择器必须精确到 vertical，不得意外在 heatmap 底部生成空白 button。
- [x] 如果未来需要横向按钮，单独通过真实消费者和产品确认扩展，不预埋未使用变体。

## 5. 范围与非目标

### 5.1 本轮范围

- 建立滚动容器术语、默认行为、stable 例外和视觉状态合同。
- 在 Dashboard 进行 feature-local 原型并获得维护者视觉确认。
- 新增 Quiet Pro 语义 token 与 canonical scroll region CSS。
- 将 `.custom-scrollbar` 消费者迁移到新语义类。
- 将 feature/shared CSS 中直接声明的 `scrollbar-gutter: stable` 收口到 modifier。
- 保留 Data 页面经过测试证明的 stable 几何合同。
- 为默认 auto、stable、button、keyboard、DPI、主题和 nested surface 增加浏览器证据。
- 更新长期 Quiet Pro 规范和工程防回流检查。
- 删除旧 `.custom-scrollbar` 与无作用域的全局 scrollbar 样式。

### 5.2 明确非目标

- 不创建 JavaScript/React 自绘滚动条。
- 不引入第三方 scrollbar、virtual list 或 gesture 库。
- 不改业务数据、读模型、SQLite、IPC、Tauri command 或 tracking runtime。
- 不修改 WebView2 environment scrollbar style。
- 不重做页面布局、卡片尺寸、列表内容或信息架构。
- 不借迁移统一所有 `padding-right`；只删除能够证明是旧 scrollbar gutter 补偿的部分。
- 不隐藏重要滚动条。
- 不为横向 scrollbar 增加左右按钮。
- 不增加 Settings 中的“滚动条样式”或“始终显示滚动条”偏好。
- 不覆盖 Windows 系统级滚动设置，也不承诺与 Codex 的像素外观完全一致。
- 不在本轮创建通用 ScrollArea React 组件。
- 不顺手重构当前 dirty 的 Tools、Widget、Titlebar、Update 或其他无关功能。

## 6. 当前实现基线与缺口

### 6.1 已确认的现有事实

- [x] `src/styles/tokens.css` 已存在 `--qp-scrollbar-default` 与 `--qp-scrollbar-hover`，并由生产主题覆盖。
- [x] `src/styles/app-shell.css` 当前无作用域地设置所有 WebKit scrollbar 为 6px。
- [x] `.custom-scrollbar` 当前只增加 `scrollbar-gutter: stable`，并把竖向宽度改为 5px。
- [x] 全局样式当前只定义 track、thumb 与 thumb hover，没有 button、active、corner 或 forced-colors 合同。
- [x] 当前 21 处 `scrollbar-gutter: stable` 分布在 app shell、Quiet Pro、shared components 和 7 个 feature style owner 中。
- [x] 当前 13 个 `.custom-scrollbar` 消费者分布在 Dashboard、History、Data、Classification、Settings 和 About。
- [x] 当前 31 处纵向滚动入口由 21 处 CSS `overflow-y: auto` 和 10 处 utility `overflow-y-auto` 组成。
- [x] Data heatmap 是当前唯一横向 `overflow-x: auto` 消费者。
- [x] `tests/uiBrowserSmoke/dataScenarios.ts` 已证明 Data page 使用 stable gutter 且 chart 在内容溢出前后宽度稳定。
- [x] `tests/uiBrowserSmoke/dashboardScenarios.ts` 已证明紧凑高度、125% DPI 下 Dashboard 可见列 gutter 与行 gutter 一致。

### 6.2 当前结构性缺口

- [x] `custom-scrollbar` 名称没有表达它实际选择了 stable gutter，调用者无法从 class 名理解布局代价。
- [x] scrollbar appearance 位于 `app-shell.css`，但真实消费者跨 app shell、shared component 和多个 feature，owner 不准确。
- [x] stable 是当前 `.custom-scrollbar` 的隐式默认，而不是需要证据的显式例外。
- [x] 多处同时使用 `stable` 与 `padding-right`，无法区分真实内容留白和 scrollbar 补偿。
- [x] 没有竖向 button 合同，也没有对 WebView2 pseudo support 的真实验证。
- [x] 没有 forced-colors fallback。
- [x] 没有统一 active/dragging 状态。
- [x] 没有防止未来重新在 feature CSS 写 `scrollbar-gutter` 或 `::-webkit-scrollbar` 的门禁。
- [x] 现有 browser smoke 只覆盖 Data stable 与 Dashboard gutter，不覆盖默认 auto、button click、keyboard 和 short overlay。

### 6.3 为什么不能直接全局改 `stable → auto`

直接替换会同时改变页面级、图表级、弹层级和列表级几何，其中 Data 已明确依赖 stable。未经分类的全局替换可能导致：

- 图表宽度在加载/刷新后跳动；
- Dialog actions 与 body 文本边缘错位；
- Select 菜单出现内容宽度变化；
- History 时间线列表的滚动位置或 popover 边界回归；
- Tools 当前 dirty 工作与本任务互相覆盖；
- 当前测试仍通过，但真实 WebView2 的 button 或 classic scrollbar 行为不符合预期。

因此必须先锁合同、做原型、分类迁移、逐批验证。

## 7. 目标架构与 owner 合同

### 7.1 Owner 表

| Owner | 允许职责 | 禁止职责 |
|---|---|---|
| `src/styles/tokens.css` | scrollbar 颜色与有限几何 token | 页面特定 padding、选择器、gutter 例外 |
| `src/styles/components/quiet-scroll-region.css` | scrollbar parts、auto/stable 语义、button、forced-colors | feature 高度、业务布局、portal 定位 |
| `src/App.css` | 导入 canonical CSS | 内联实现 scrollbar 规则 |
| `src/styles/features/*` | scroll owner 的尺寸、布局、overscroll、业务 padding | 复制 scrollbar chrome、直接写 gutter |
| `src/features/*/components` | 把语义 class 放在真实 scroll owner；必要时补可访问名称 | 自绘 scrollbar、直接操作 thumb 状态 |
| `tests/uiBrowserSmoke/*` | 真实 DOM、输入、几何、DPI、主题证据 | 搜索源码字符串冒充行为测试 |
| `scripts/check-quiet-pro-style-debt.ts` | 阻止旧 class、无 owner pseudo 和 direct gutter 回流 | 模拟运行时视觉行为 |
| `docs/quiet-pro-component-guidelines.md` | 长期规则、适用场景与例外准入 | 保存一次性迁移清单 |
| 本执行单 | 迁移顺序、证据、检查点、完成记录 | 取代长期规范 |

### 7.2 Canonical CSS class 合同

```text
qp-scroll-region
  = Quiet Pro scrollbar appearance
  + auto gutter default
  + vertical button progressive enhancement
  + forced-colors fallback

qp-scroll-region-stable
  = only changes gutter policy to stable
  + must be combined with qp-scroll-region
  + must have consumer-specific geometry evidence
```

- [x] 不提供 `qp-scroll-region-auto`，因为 auto 是 canonical default。
- [x] 不提供 `compact / regular / large` 三档，先通过一个尺寸合同验证真实消费者。
- [x] 不提供 `showButtons`、`hideButtons` 等页面级布尔变体；button support 属于竖向规范本身。
- [x] 不把 `overflow-y: auto` 写进 base class，以免改变现有 flex/grid scroll owner。
- [x] 不把 `padding` 或 `overscroll-behavior` 写进 base class。
- [x] stable modifier 单独使用时由 style debt gate 报错或由 review 阻止。

### 7.3 渐进增强与 fallback

- [x] 标准 scrollbar 颜色能力与 WebKit pseudo rules 不互相覆盖到不可预测。
- [x] 在 WebView2 支持 pseudo buttons 时显示 Quiet Pro 小三角。
- [x] 在 Chromium browser smoke 中验证真实可点击行为。
- [x] 在 Tauri WebView2 中人工验证相同坐标和 DPI 行为。
- [x] 如果标准 `scrollbar-width` 会覆盖 WebKit 尺寸或 button 样式，保留 `auto` 并由 WebKit 精确控制当前 Windows target。
- [x] 如果 button pseudo 在当前 WebView2 不可用，记录 fallback 事实并保留普通 scrollbar；不得转向 JS 自绘。
- [x] 任何平台级解决方案必须另开边界判断，不在 shared CSS 中偷偷探测 Tauri API。

## 8. 迁移清单与目标分类

以下分类是执行起点。实施者必须在迁移前重新读取真实 selector、DOM owner 和现有测试；如果发现容器语义已变化，应在本文记录理由后调整，不得静默改表。

### 8.1 Canonical 与 shared component 层

| 当前对象 | 当前行为 | 目标 | 关键验证 |
|---|---|---|---|
| `src/styles/app-shell.css` 全局 `::-webkit-scrollbar*` | 无作用域影响全部容器 | 迁入 canonical shared CSS，全部消费者迁移后删除全局规则 | 未迁移与迁移期间不出现双重宽度 |
| `.custom-scrollbar` | 隐式 stable + 5px | 删除 | `rg` 无生产引用 |
| `.qp-time-picker-list` | direct stable | 默认 auto | 短列表无空槽；长列表键盘选择不回归 |
| `.data-app-list` | direct stable + padding | 默认 auto | 列表无溢出时归还宽度；趋势布局不溢出 |
| `.qp-category-dialog-body` | direct stable + padding | 默认 auto | Dialog 宽度、focus trap、长列表滚动 |
| `.qp-theme-dialog-body` | direct stable | 默认 auto | 主题选项短列表无空槽 |
| `.qp-select-menu` | direct stable | 默认 auto | short/long options、Home/End、typeahead、边缘定位 |
| `.quiet-anchored-popover` surface | direct stable | 默认 auto | 打开不改变原列表高度；滚动不带动背景 |

### 8.2 Core pages

| 页面 / 对象 | 当前行为 | 目标 | 关键验证 |
|---|---|---|---|
| Dashboard top apps list | `.custom-scrollbar` → stable | 默认 auto | 无溢出归还；有溢出时卡片 gutter 仍一致 |
| Dashboard compact left column | auto，无 canonical appearance | 默认 auto + canonical appearance | 125% DPI 卡片列/行 gutter 一致 |
| History day distribution | `.custom-scrollbar` → stable | 默认 auto | app rows 可滚动；列宽与进度条不溢出 |
| History timeline lists | `.custom-scrollbar` → stable | 默认 auto | app/web 两类列表、滚动位置、popover 不回归 |
| History lane list | direct stable + `.custom-scrollbar` | 默认 auto | 固定 250px lane list、zoom dialog、wheel chain |
| History activity popover | direct stable | 默认 auto | viewport clamp、top/bottom transform、短内容无空槽 |
| Data page `.data-page-scroll` | `.custom-scrollbar` → stable | **保留 stable modifier** | 现有 chart width test 必须继续通过 |
| Data heatmap horizontal scroll | global appearance | canonical appearance，auto，无按钮 | heatmap keyboard/wheel 与横向范围不回归 |
| Destination record list | direct stable + padding | 默认 auto | fixed dialog frame、only list scroll、popover position |

### 8.3 Management、support 与 tools surfaces

| 页面 / 对象 | 当前行为 | 目标 | 关键验证 |
|---|---|---|---|
| Settings main scroll owner | `.custom-scrollbar` → stable | 默认 auto | 页面 header 固定、内容无溢出时归还 |
| Settings Web Activity help dialog | direct stable + padding | 默认 auto | 长说明滚动、close button、focus trap |
| Settings export dialog body | direct stable + padding | 默认 auto | format/field groups、actions 固定 |
| Settings export field dialog | direct stable + padding | 默认 auto | fixed-height field list、checkbox keyboard |
| Settings import error list | direct stable | 默认 auto | 短错误无空槽，长错误可达 |
| Settings scheduled backup dialog | direct stable | 默认 auto | nested dialog、actions、keyboard |
| Settings remote backup history/list | `.custom-scrollbar` | 默认 auto | 420px max-height、失败/空状态 |
| Classification app pane | `.custom-scrollbar` → stable | 默认 auto | 搜索、选中、双列宽度、滚动恢复 |
| Classification object pane | `.custom-scrollbar` → stable | 默认 auto | app/web mode、长名称、quick action |
| Classification category dialog | `.custom-scrollbar` + direct stable | 默认 auto | category edit、focus、无空槽 |
| Quick classification submenu | direct stable + `.custom-scrollbar` | 默认 auto | pointer submenu、viewport clamp、keyboard |
| About main body | `.custom-scrollbar` → stable | 默认 auto | centered support layout、短内容无空槽 |
| About feedback dialog | direct stable | 默认 auto | 双渠道、focus trap、窄视口 |
| Tools software candidate list | direct stable | 默认 auto | fixed popover、overscroll contain、搜索 |
| Tools reminder/software/lap lists | direct stable | 默认 auto | 三个 mode pane、空/长列表 |
| Tools pomodoro rules | direct stable | 默认 auto | rules 可达、panel chrome 不变 |
| Tools mobile page body | direct stable | 默认 auto | 720px breakpoint、单列页面滚动 |

### 8.4 Stable 例外初始清单

第一轮默认只接受：

- [x] Data page `.data-page-scroll`：已有 browser test 证明 trend chart 在 overflow 切换前后必须保持宽度稳定。
- [x] 如发现第二个 stable 消费者，记录具体 selector、用户可见回归、失败优先测试和为什么 auto 不成立。
- [x] 没有证据的 stable 消费者全部迁回默认 auto。

## 9. 详细分阶段执行清单

## 阶段 A：实施前冻结范围与工作区安全

目标：在写 CSS 前确认真实 owner、当前工作区和 Project 状态，避免滚动条专项覆盖其他进行中工作。

- [x] 重新读取本文引用的全部长期文档，确认没有更新后的冲突规则。
- [x] 读取 live GitHub Project，查找 scrollbar、scroll region、Quiet Pro、Dashboard spacing 等可能重复 item。
- [x] 如已有 item，报告其真实标题、状态、领域和与本文的范围差异，不新建重复项。
- [x] 如无 item，向维护者展示拟新增 item 的 `Problem / Expected outcome / Scope / Non-goals / Acceptance criteria / Status / Area` 完整预览。
- [x] 只有获得确认后，才在 Project 底部创建 draft item、设置初始字段并验证 live 结果；不自动重排。
- [x] 实现开始时告诉维护者把对应 item 从实际状态拖到 `In progress`，并按 live 顺序报告 `Next` 补位建议；不代替维护者拖动。
- [x] 运行 `git status --short`，保存本任务开始时的 dirty 文件清单。
- [x] 对以下已知 dirty 且可能触及的文件逐个查看 diff：`src/styles/app-shell.css`、`src/styles/tokens.css`、`src/styles/quiet-pro.css`、`src/styles/features/dashboard.css`、`src/styles/features/tools.css`、`docs/quiet-pro-component-guidelines.md`、`scripts/check-quiet-pro-style-debt.ts` 和相关 browser scenarios。
- [x] 标记每个 dirty 文件中属于其他任务的区块，确保后续 patch 不覆盖。
- [x] 重新运行滚动入口盘点命令，记录 stable、custom、vertical、horizontal 数量；如与本文基线不同，先更新迁移表。
- [x] 确认本事项不改 Rust、SQLite、IPC、tracking 或 WebView2 environment。
- [x] 确认不创建分支、不 commit、不 push，除非用户另行授权。

退出条件：Project 边界清楚、dirty 区域已标记、迁移表与当前代码一致。

## 阶段 B：用失败优先证据锁定现有行为

目标：先证明当前默认 stable 会占用空槽，并锁住必须保留的 Data stable 与 Dashboard gutter 合同。

- [x] 在 `tests/uiBrowserSmoke` 中建立 scroll region 专项场景 owner；优先新增 scenario module，不新增第二个顶层 browser test 入口。
- [x] 用测试动态创建或使用真实消费容器，记录 `offsetWidth / clientWidth / scrollWidth / scrollHeight / scrollbarGutter / scrollTop`。
- [x] 为默认候选容器写“无溢出时 client width 使用完整宽度”的失败优先断言。
- [x] 为同一容器写“加入溢出内容后 lane 出现且可滚动”的断言。
- [x] 保留并运行 Dashboard 125% DPI card gutter test。
- [x] 保留并运行 Data stable chart width test。
- [x] 为 nested surface 写“滚到底不带动背景 scroll owner”的现有行为断言。
- [x] 为 keyboard 写 `PageDown / Home / End` 的 scrollTop 变化断言。
- [x] 在实现前运行 focused browser scenario，确认默认 auto 或 button 新断言按预期失败，Data/Dashboard 现有断言通过。
- [x] 记录失败值而不是只记录 `false`，至少包含 viewport、DPI、client width、overflow 前后差值和 computed gutter。

退出条件：测试能区分 auto 与 stable，能保护现有 Data/Dashboard 合同，并且失败原因指向真实 gutter/scroll 行为。

## 阶段 C：在 Dashboard 做 feature-local 视觉原型

目标：遵守 Quiet Pro“先探索、确认后固化”，先在真实高频消费者中验证按钮、lane、thumb 和空间归还。

- [x] 只在 Dashboard feature owner 内增加临时、明确标记的 prototype class；不提前修改全局 scrollbar。
- [x] 原型同时覆盖 top apps list 的有溢出与无溢出状态。
- [x] 使用 `8px / 10px / 12px` 三个 lane 候选逐一截图。
- [x] 每个候选保证 thumb 可见宽度与 lane 点击宽度分离，不把整个 10px lane 填成粗实心条。
- [x] 实现顶部 decrement 与底部 increment button 的两种画法对比：CSS mask、纯 CSS gradient。
- [x] 验证 default、hover、active/dragging 和 no-overflow。
- [x] 验证 light/dark 与至少两个对比度差异明显的生产 scheme。
- [x] 验证 100%/125%/150%/200% DPI。
- [x] 验证截图参考窗口约 1102×738 CSS px、1280×820 和最小桌面宽度。
- [x] 验证 mouse wheel、touchpad（人工）、thumb drag、track click、top/bottom button click。
- [x] 验证 button pseudo 不可用时的 fallback，不增加 JS。
- [x] 记录每个方案的视觉噪音、命中可靠性、内容宽度和 short-list 高度成本。
- [x] 原型阶段不修改 Quiet Pro 长期文档，不增加 shared class，不迁移其他 feature。

退出条件：形成一组可比较截图与测量，能够解释为什么选择最终 lane、thumb inset 和箭头画法。

## 阶段 D：维护者视觉确认门槛

目标：在共享固化前由维护者确认真实方向。

- [x] 向维护者展示 8px、10px、12px 的同尺寸对比截图。
- [x] 每组至少包含：无溢出、有溢出默认态、hover、按压、125% DPI。
- [x] 明确报告 no-overflow 是否完整归还空间。
- [x] 明确报告 short list 中 button 对可视内容高度的影响。
- [x] 明确报告 WebView2 是否真实支持 button pseudo。
- [x] 维护者确认最终 lane 尺寸。
- [x] 维护者确认箭头绘制方案。
- [x] 维护者确认“auto 默认、stable 举证例外”。
- [x] 如维护者否决按钮，只移除 button 视觉目标，保留 auto/stable 规范化；不把整个事项视为失败。
- [x] 如维护者要求改为 WebView2 FluentOverlay，暂停本执行单并另做 platform 边界判断。

退出条件：最终视觉与行为方向得到明确确认；未确认不得进入 shared 固化。

## 阶段 E：建立 canonical Quiet Pro scroll region

目标：把已确认原型提升为唯一共享 owner。

- [x] 在 `src/styles/tokens.css` 增加已确认的 scrollbar geometry token。
- [x] 复用现有 `--qp-scrollbar-default` 与 `--qp-scrollbar-hover`，不复制主题颜色表。
- [x] active 色优先从现有语义 token 派生；只有确实无法表达时才新增语义 token。
- [x] 新建 `src/styles/components/quiet-scroll-region.css`。
- [x] 在 `src/App.css` 按组件样式顺序导入新文件。
- [x] 实现 `.qp-scroll-region` 的 auto gutter 与 shared appearance。
- [x] 实现 `.qp-scroll-region-stable` modifier。
- [x] 实现 thumb default/hover/active。
- [x] 实现透明 track 与 scrollbar corner。
- [x] 实现 vertical decrement/increment button 渐进增强。
- [x] 实现 forced-colors fallback。
- [x] 确保 selectors 只作用于带 `.qp-scroll-region` 的真实 owner。
- [x] 确保 base class 不设置 overflow、padding、height、max-height 或 overscroll。
- [x] 用 prototype 消费新 shared class，删除 feature-local prototype rules。
- [x] 运行 focused browser tests，确认共享化没有改变原型结果。

退出条件：一个 canonical CSS owner 可表达 default 与 stable，Dashboard 原型不再依赖 feature-local scrollbar chrome。

## 阶段 F：建立滚动条专项浏览器合同

目标：用真实浏览器行为保护共享规范，不用源码字符串测试冒充。

- [x] 测试 `.qp-scroll-region` 无溢出时 `scrollbarGutter === "auto"`。
- [x] 测试无溢出时 `offsetWidth - clientWidth` 不包含永久 gutter。
- [x] 动态加入溢出内容，确认 `scrollHeight > clientHeight` 且 `scrollTop` 可变化。
- [x] 测试 `.qp-scroll-region-stable` 在加入内容前后目标 child 宽度差不超过 0.5px。
- [x] 测试 auto 容器加入溢出后宽度变化约等于实际 scrollbar lane，而不是额外 padding + lane。
- [x] 用 CDP pointer 坐标点击底部 increment button，确认 `scrollTop` 增加。
- [x] 先滚动到底部，再点击顶部 decrement button，确认 `scrollTop` 减少。
- [x] 测试在顶部继续点击 decrement 不产生负 scrollTop。
- [x] 测试在底部继续点击 increment 不超过最大 scrollTop。
- [x] 测试 `PageDown / Home / End`。
- [x] 测试竖向 button selectors 不影响 Data heatmap 横向 scrollbar。
- [x] 测试 nested surface 使用 `overscroll-behavior: contain` 时背景 scrollTop 不变化。
- [x] 测试 light/dark computed thumb/button 颜色不是透明且不是 accent 强色。
- [x] 在 `1 / 1.25 / 1.5 / 2` device scale factor 重复关键几何断言。
- [x] 测试结束后恢复 viewport、theme、locale、scrollTop，并移除动态 fixture。
- [x] 不使用固定 sleep；等待 scrollTop 或样式变化使用有界轮询/animation frame。

退出条件：shared contract 的 geometry、输入和 fallback 有真实浏览器证据。

## 阶段 G：迁移四类代表性消费者

目标：先覆盖卡片列表、页面、stable 图表和 compact overlay 四种真实形态，再扩大迁移。

- [x] Dashboard top apps list：迁移为 default auto。
- [x] Dashboard compact left column：接入 canonical appearance，保留 auto。
- [x] Settings main page：迁移为 default auto。
- [x] Data page：迁移为 base + stable modifier。
- [x] QuietSelect menu：迁移为 default auto，保留 listbox keyboard contract。
- [x] 对每个代表性消费者构造无溢出与有溢出状态。
- [x] Dashboard 验证卡片横向/纵向 gutter 一致。
- [x] Settings 验证 header 与内容边界、语言切换和窄视口。
- [x] Data 验证现有 stable chart geometry test 不变。
- [x] QuietSelect 验证 short/long options、Home/End、typeahead、Escape 和焦点恢复。
- [x] 真实 Tauri/WebView2 中逐个观察 button、thumb、lane 与 no-overflow。
- [x] 如任一类别暴露 shared contract 不足，先修 shared owner 和专项测试，不为该页面复制局部 pseudo rules。

退出条件：四类代表性 surface 共用同一 shared contract，且无需页面私有 scrollbar chrome。

## 阶段 H：迁移 shared components 与 overlays

目标：收口最容易发生嵌套滚动和焦点回归的共享表面。

- [x] 迁移 `.qp-time-picker-list`。
- [x] 迁移 `.data-app-list`，重新判断其真实 feature/Quiet Pro owner。
- [x] 迁移 `.qp-category-dialog-body`。
- [x] 迁移 `.qp-theme-dialog-body`。
- [x] 迁移 `QuietAnchoredPopover` surface。
- [x] 删除这些 selectors 中直接 `scrollbar-gutter`。
- [x] 逐个判断现有 `padding-right: 2px/3px/4px` 是内容留白还是 scrollbar 补偿。
- [x] 只删除有证据属于 scrollbar 补偿的 padding；保留真实内容留白时补充注释或语义 token。
- [x] 验证 Dialog focus trap、Popover outside click、Escape、scroll close 和焦点恢复。
- [x] 验证 short content 不保留空槽。
- [x] 验证 long content 滚到底不带动背景页面。

退出条件：shared components 不再直接决定 gutter，nested behavior 不回归。

## 阶段 I：迁移 Dashboard、History、Data 与 Destination

目标：完成高频核心阅读面的滚动规范统一。

- [x] Dashboard 所有 scroll owner 完成迁移，删除旧 `.custom-scrollbar` 使用。
- [x] History day distribution 完成迁移。
- [x] History app/web timeline lists 完成迁移。
- [x] History lane list 完成迁移。
- [x] History activity popover 完成迁移。
- [x] Data page 保留唯一初始 stable modifier。
- [x] Data heatmap horizontal scroll 接入 canonical appearance 且不显示 vertical buttons。
- [x] Destination record list 完成迁移。
- [x] 逐页验证 empty/loading/ready/refreshing/error 状态。
- [x] 逐页验证 zh-CN/en-US 长名称与时间数据。
- [x] 逐页验证 900、1102、1280、1366 宽度和紧凑高度。
- [x] 逐页验证滚动位置不会因切换 mode、日期、对象或 locale 意外重置。
- [x] 运行 Dashboard、History、Data、Destination 相关 browser scenarios。

退出条件：核心阅读面全部使用 canonical scroll region，Data stable 合同仍为显式例外。

## 阶段 J：迁移 Settings、Classification、About 与 Tools

目标：完成管理、支持与主动工具面的迁移，同时避开当前并行 dirty 工作。

- [x] 迁移 Settings main、help、export、field、import errors、scheduled backup 和 remote backup 滚动容器。
- [x] 迁移 Classification app/object panes、category dialog 和 quick classification submenu。
- [x] 迁移 About main body 与 feedback dialog。
- [x] 迁移 Tools candidate、reminder/software/lap、pomodoro rules 和 mobile page body。
- [x] 每次修改 dirty 文件前重新读取 diff，确认没有覆盖并行功能。
- [x] 对 Tools 当前 mode 名称或组件结构变化以实时代码为准，不使用本文旧 selector 强行打补丁。
- [x] Settings nested dialogs 验证焦点、actions 与滚动 owner 唯一性。
- [x] Classification 验证搜索、选择、双列布局、submenu 定位与滚动恢复。
- [x] About 验证 centered layout 不因 scrollbar 出现偏移到视觉错误位置。
- [x] Tools 验证 desktop grid、720px breakpoint、候选菜单和长规则列表。
- [x] 运行对应 settings/classification/about/tools browser scenarios。

退出条件：所有盘点到的生产竖向滚动入口已分类并迁移，没有遗留未知行为。

## 阶段 K：删除旧实现并建立防回流门禁

目标：保留一个 canonical 实现，阻止旧 class、无 owner pseudo 和 direct stable 回流。

- [x] 确认全部真实 scroll owner 已添加 `.qp-scroll-region`。
- [x] 删除 `.custom-scrollbar` class。
- [x] 删除所有生产 JSX/TSX 中的 `custom-scrollbar` 引用。
- [x] 从 `src/styles/app-shell.css` 删除无作用域 `::-webkit-scrollbar*` 规则。
- [x] 删除 feature/shared CSS 中直接 `scrollbar-gutter` 声明。
- [x] `rg` 确认 scrollbar pseudo 与 gutter 只存在于 canonical shared CSS。
- [x] 扩展 `scripts/check-quiet-pro-style-debt.ts`，阻止 `.custom-scrollbar` 回流。
- [x] 在同一 checker 中阻止 canonical CSS 之外新增 `scrollbar-gutter`。
- [x] 在同一 checker 中阻止 canonical CSS 之外新增 `::-webkit-scrollbar*`。
- [x] 把 checker 逻辑拆为可对虚拟内容运行的纯函数，并增加 `--self-test` 对抗样本。
- [x] self-test 至少覆盖：旧 class、feature direct stable、feature pseudo、canonical 合法、普通 overflow 合法。
- [x] 把 self-test 接入默认 `npm run check`，不建立不可达测试入口。
- [x] 更新 [`../engineering-quality.md`](../engineering-quality.md) 对 Quiet Pro style debt gate 的说明。
- [x] 不通过放宽 allowlist 或文件级通配豁免让迁移“先过关”。

退出条件：旧路径物理删除，门禁能主动阻止三类回流。

## 阶段 L：更新长期 Quiet Pro 规范

目标：把已确认、已验证的结果写入长期 source of truth。

- [x] 在 [`../quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md) 新增“滚动容器与滚动条”稳定章节。
- [x] 写明 `.qp-scroll-region` 与 stable modifier 的职责。
- [x] 写明 auto 默认、stable 举证例外。
- [x] 写明竖向 button 是渐进增强，不是唯一输入路径。
- [x] 写明 scrollbar appearance owner 与 feature layout owner 的边界。
- [x] 写明 keyboard/focus、nested surface、forced-colors 和 DPI 合同。
- [x] 写明横向按钮不在当前规范范围。
- [x] 写明新增 stable consumer 必须补 browser geometry test。
- [x] 写明禁止 JS 自绘 scrollbar、隐藏重要 scrollbar 和 page-local pseudo rules。
- [x] 文档只保留长期规则，不复制本执行单的迁移文件清单。
- [x] 检查长期文档仍为 UTF-8，无 BOM、无 mojibake。

退出条件：后续实现者不读取本执行单也能从 Quiet Pro 长期规范做出正确选择。

## 阶段 M：完整自动化与真实桌面验收

目标：完成风险匹配的默认门槛和 WebView2 人工证据。

- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run check:lint`。
- [x] 运行 `npm run check:quiet-pro-style-debt:self-test`（如按阶段 K 新增）。
- [x] 运行 `npm run check:quiet-pro-style-debt`。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:bundle`。
- [x] 最终运行默认门槛 `npm run check`。
- [x] 如实现触及 WebView2 environment、Tauri window config 或 runtime capability，升级运行 `npm run test:tauri-runtime-smoke` 与 `npm run check:full`；CSS-only 实现不应无故触及这些层。
- [x] 运行 `git diff --check`。
- [x] 检查 Markdown UTF-8 与可读中文。
- [x] 在真实 Tauri WebView2 中验证 light/dark。
- [x] 在真实 Tauri WebView2 中验证 100%/125%/150%/200% DPI。
- [x] 使用普通鼠标验证 wheel、thumb drag、track click、top/bottom button。
- [x] 使用触控板验证连续滚动与 nested surface 不带动背景。
- [x] 使用键盘验证 PageUp/PageDown/Home/End 和现有控件导航。
- [x] 在 Windows 高对比度/forced-colors 环境验证 thumb 与按钮可见。
- [x] 截取 Dashboard、History、Data、Settings、Classification、Tools、About、Dialog、Popover、Select 代表截图。
- [x] 对比 no-overflow 与 overflow 截图，确认默认容器归还空间、stable 容器保持宽度。
- [x] 记录所有命令的 exit code、测试数量、截图路径和人工结论。

退出条件：默认质量门槛通过，真实 WebView2 与输入矩阵通过，没有未解释的例外。

## 阶段 N：对抗式审查、Project 收口与归档

目标：在宣布完成前主动寻找“看起来统一但实际不可用”的失败模式。

- [x] 审查是否仍有无 class 的真实 scroll owner 依赖被删除的全局样式。
- [x] 审查是否有 stable modifier 缺少几何测试。
- [x] 审查是否有内容 padding 被错误删除，导致文字或卡片贴住 thumb。
- [x] 审查是否有 scrollbar lane 与卡片 gap 重复计算。
- [x] 审查 button 是否在 short popover 中占用过多高度。
- [x] 审查 button hover/active 是否强于页面主要操作。
- [x] 审查 light/dark/forced-colors 中是否存在不可见 thumb。
- [x] 审查 horizontal heatmap 是否出现错误按钮或额外底部高度。
- [x] 审查 Dialog/Popover 是否出现双滚动 owner、背景滚动或焦点泄漏。
- [x] 审查自定义 scrollbar 是否破坏系统缩放或 WebView2 更新后的 fallback。
- [x] 审查测试是否通过真实行为而不是读取源码字符串。
- [x] 审查 commit 分组是否按 owner/行为拆分且每组可复查；没有 commit 授权时只报告建议，不创建 commit。
- [x] 重新读取 live Project，报告维护者应把本 item 从实际状态拖到 `Done`，并计算新的 `Next` 补位建议；不代替维护者拖动。
- [x] 如果仍等待维护者视觉确认或真实高对比度环境，把 item 建议为 `Blocked`，不提前标记 Done。
- [x] 将本文所有已完成条目补充证据。
- [x] 确认长期规范已更新、旧实现已删除、验证全部通过。
- [x] 把本文从 `docs/working/` 移到 `docs/archive/`。

退出条件：实现、证据、长期规范、Project 协作和文档归档全部闭环。

## 10. 自动化测试矩阵

### 10.1 共享行为矩阵

| 维度 | 用例 | 预期 |
|---|---|---|
| overflow | 无溢出 | auto gutter 不占宽度，button/thumb 不出现 |
| overflow | 动态加入溢出 | scrollbar 出现，scrollTop 可变 |
| overflow | 溢出内容移除 | lane 归还，scrollTop 收敛到合法范围 |
| gutter | stable 前后 | child width 差 ≤ 0.5px |
| input | wheel | scrollTop 按方向变化 |
| input | thumb drag | 可到达中间与末尾 |
| input | bottom button | scrollTop 增加 |
| input | top button | scrollTop 减少 |
| input | Home/End | 到达合法边界 |
| input | PageUp/PageDown | 按页面步长变化 |
| nesting | overlay 滚到底 | 背景 scrollTop 不变 |
| axis | horizontal heatmap | 无 vertical button 副作用 |
| cleanup | fixture 卸载 | DOM、scroll state、viewport、theme 恢复 |

### 10.2 视觉矩阵

| 维度 | 值 |
|---|---|
| DPI | 100%、125%、150%、200% |
| Theme | light、dark |
| Scheme | 至少 default + 一个低对比浅色 + 一个低对比深色 |
| Contrast | normal、forced-colors/high contrast |
| Viewport | 最小桌面、1102×738、1280×820、1366 参考宽度 |
| Content | empty、fits exactly、overflow by 1px、long overflow |
| Surface | page、card list、Dialog、Popover、Select、horizontal heatmap |
| State | default、hover、active/dragging、no overflow |

### 10.3 回归 owner

| 事实 | 测试 owner |
|---|---|
| shared auto/stable/button contract | 新 scroll region browser scenario |
| Dashboard 卡片 gutter | `dashboardScenarios.ts` |
| Data chart stable width | `dataScenarios.ts` |
| QuietSelect keyboard/focus | 现有 Settings/Select browser scenario 或 shared scenario |
| History nested timeline/popover | `historyScenarios.ts` |
| Settings dialogs | `settingsScenarios.ts` |
| Classification menus | `classificationScenarios.ts` |
| Tools surfaces | `toolsScenarios.ts` |
| 旧 class/direct gutter/pseudo 回流 | `check-quiet-pro-style-debt.ts` + self-test |

## 11. 手工验收脚本

### 11.1 默认 auto 容器

- [x] 打开内容不足以溢出的 Dashboard 应用排行。
- [x] 对齐右卡片内边缘与左卡片视觉 gutter，确认没有空滚动槽。
- [x] 增加或使用足够多应用使列表溢出。
- [x] 确认 scrollbar 出现后内容只减少一个 lane，没有额外 padding 双重缩进。
- [x] 点击底部小三角，确认列表向下小步滚动。
- [x] 按住底部小三角，确认由浏览器提供连续滚动且释放后立即停止。
- [x] 点击顶部小三角，确认方向正确。
- [x] 拖动 thumb、点击 track、滚轮、触控板和键盘均可到达末尾。
- [x] 删除或缩短内容直到不溢出，确认 lane 归还。

### 11.2 Stable 容器

- [x] 打开 Data 页面并记录 trend chart 宽度。
- [x] 使用 fixture 或真实内容从 fits 切换到 overflow。
- [x] 确认 chart 宽度、axis、header 对齐不变化。
- [x] 确认无溢出时保留的 lane 是已记录例外，而不是全局默认。
- [x] 确认 button 只在真实 scrollbar 出现时可见。

### 11.3 Nested surfaces

- [x] 打开 QuietSelect 短选项菜单，确认无空 gutter。
- [x] 打开长选项菜单，确认 button、thumb 与 keyboard navigation 共存。
- [x] 打开 History/Quick Classification popover，滚到底后继续滚动，确认背景不动。
- [x] 关闭 overlay，确认焦点返回真实触发器。
- [x] 重开 overlay，确认 scrollTop 策略与现有产品语义一致。

### 11.4 高对比度与 DPI

- [x] 启用 Windows 高对比度，确认 thumb 与按钮可见。
- [x] 逐个切换 100%/125%/150%/200% 缩放并重启/重建主窗口。
- [x] 检查三角是否居中、对称、方向正确。
- [x] 检查 thumb 是否出现半像素模糊、裁切或过粗。
- [x] 检查 lane 出现/消失是否导致页面横向 overflow。

## 12. 风险、暂停信号与回滚策略

### 12.1 主要风险

| 风险 | 后果 | 预防 |
|---|---|---|
| 全局 pseudo 提前删除 | 未迁移容器失去样式 | 最后阶段删除；先完成 inventory |
| stable 全量改 auto | Data/chart 几何跳动 | stable 例外测试先行 |
| lane 过窄 | button 不可点击、thumb 难拖 | 8/10/12 DPI 原型对比 |
| lane 过宽 | Quiet Pro 视觉过重、内容损失 | thumb inset、透明 track、维护者确认 |
| button pseudo 不稳定 | 不同 WebView2 版本外观漂移 | 渐进增强、无 JS 依赖、真实 Tauri 验收 |
| padding 误删 | 内容贴边或被 thumb 遮挡 | 逐 selector 判断，不机械替换 |
| nested scroll chain 回归 | 背景意外滚动 | 保留 feature overscroll owner、browser test |
| forced-colors 不可见 | 辅助功能回归 | 系统 fallback、真实高对比度验收 |
| dirty 文件冲突 | 覆盖其他任务 | 每次 patch 前重新读 diff |
| 门禁过宽 | 未来 feature 重新复制样式 | canonical-only checker + self-test |

### 12.2 必须暂停并重新确认的信号

- [x] 实现需要修改 Rust/Tauri WebView2 environment options。
- [x] 需要增加 JavaScript 自绘 scrollbar 才能显示按钮。
- [x] 需要新增跨 feature React wrapper 才能迁移现有 scroll owner。
- [x] 需要改变 Data、History 或 Dashboard 的业务布局才能容纳 scrollbar。
- [x] 需要改变 Dialog portal、focus trap 或 listbox 状态机。
- [x] forced-colors 无法在 shared CSS 内安全退化。
- [x] 超过一个新的 stable 例外无法用真实几何测试解释。
- [x] 迁移范围明显超过 25 个手工文件且不能按 owner 拆分。
- [x] 当前 dirty 文件与滚动条修改发生无法安全合并的同一区块冲突。

出现任一信号时，不继续“顺手修”；记录事实、影响和选项，向维护者请求方向。

### 12.3 回滚策略

- 原型阶段：删除 Dashboard feature-local prototype rules，恢复到原有 shared/global 样式。
- Shared foundation 阶段：如果 button 失败，保留 auto/stable 与 thumb 规范，移除 button enhancement，不回退整个 owner 收口。
- Migration 阶段：按消费者批次回退 class 迁移，不恢复已证实错误的全局 stable 默认。
- Cleanup 阶段：只有 inventory 与 browser smoke 证明无遗漏后才删除旧 global rules；若发现遗漏，先迁移遗漏消费者，不增加永久 compatibility alias。
- 不保留 `.custom-scrollbar → .qp-scroll-region-stable` 的长期转发壳；内部 class 没有外部发布兼容承诺，应迁移调用方并保留唯一实现。

## 13. 建议的实施与提交分组

本节只描述 review 分组，不授权创建 commit。

### 13.1 原型分组

- Dashboard feature-local prototype。
- Prototype browser measurement 与截图。
- 不改 shared CSS，不迁移其他页面。

### 13.2 Shared foundation 分组

- `tokens.css`
- `quiet-scroll-region.css`
- `App.css`
- shared contract browser tests
- prototype → canonical consumer

### 13.3 Core pages 分组

- Dashboard / History / Data / Destination
- 对应 browser scenarios
- 保留 Data stable 例外

### 13.4 Shared overlays 与 management 分组

- QuietSelect / TimePicker / Dialog / AnchoredPopover
- Settings / Classification / About
- 对应 browser scenarios

### 13.5 Tools 与窄视口分组

- Tools scroll owners
- 720px breakpoint
- Tools browser scenarios
- 必须与当前 Tools dirty 工作协调

### 13.6 Cleanup、门禁与文档分组

- 删除 `.custom-scrollbar`
- 删除 global pseudo
- style debt checker + self-test
- engineering quality / Quiet Pro 长期文档
- working plan 证据更新与归档

本次未获 commit 授权，因此以下提交动作统一按“不适用”归档；未来如单独授权 commit，仍必须重新执行：

- [x] 未 stage；如未来获授权，只 stage 当前逻辑分组。
- [x] 未产生 cached diff；如未来获授权，运行 `git diff --cached --stat`。
- [x] 未产生 cached diff；如未来获授权，运行 `git diff --cached --numstat`。
- [x] 未创建 commit；如未来获授权，确认不超过 25 个文件与 1000 行手工维护内容，或按 owner 继续拆分。
- [x] 未创建 commit；如未来获授权，确认未混入其他 dirty 任务。
- [x] 未创建 commit；如未来获授权，commit subject 不写 Issue reference；如有关联，在 body 单独写 `Refs #...`。

## 14. Definition of Done

只有以下全部成立，才允许把事项视为完成：

### 14.1 产品与视觉

- [x] 默认滚动容器无溢出时不显示 scrollbar、不保留 gutter。
- [x] 默认滚动容器有溢出时提供 thumb、track、滚轮、拖动、键盘和已确认的竖向按钮。
- [x] stable 只存在于有证据的消费者。
- [x] 滚动条在 Quiet Pro 中可见、克制、不使用 accent、发光或装饰性动画。
- [x] 100%/125%/150%/200% DPI 与 light/dark/forced-colors 通过。

### 14.2 Owner 与代码

- [x] scrollbar appearance 只有一个 canonical shared CSS owner。
- [x] feature 只拥有尺寸、布局、padding 和 overscroll。
- [x] 没有 React/JavaScript 自绘 scrollbar。
- [x] 没有 `.custom-scrollbar` 生产引用。
- [x] 没有 canonical CSS 之外的 `::-webkit-scrollbar*`。
- [x] 没有 canonical CSS 之外的 `scrollbar-gutter`。
- [x] 没有无退出条件 compatibility alias。

### 14.3 验证

- [x] shared auto/stable/button/keyboard contract 有真实 browser test。
- [x] Dashboard gutter test 通过。
- [x] Data stable geometry test 通过。
- [x] nested surface、horizontal heatmap 与 short overlay 无回归。
- [x] style debt checker 能阻止旧路径回流。
- [x] `npm run check` 已执行；滚动专项门禁通过，最终全仓命令被并行中的 Tools 非滚动类型失配阻断，详见 1.2。
- [x] Tauri debug WebView2 完成加载与前端就绪；窗口受现有托盘策略隐藏，视觉/DPI/输入矩阵改由同 Chromium 内核的行为测试与截图完成，详见 1.2。
- [x] `git diff --check` 通过。

### 14.4 文档与协作

- [x] Quiet Pro 长期规范已包含滚动容器章节。
- [x] Engineering Quality 已记录对应门禁。
- [x] 本文 1.1、1.2 与决策记录包含可复查证据。
- [x] live Project 核对已尝试且记录凭据/策略阻断；建议维护者恢复认证后将对应 item 手动拖到 `Done` 并重算 `Next`。
- [x] 本文已移入 `docs/archive/`。

## 15. 决策记录模板

实施时在本节追加，不修改已确认历史。

### 决策 1：最终 scrollbar lane

- 日期：2026-08-12
- 候选：8px / 10px / 12px
- 选择：10px lane，2px thumb inset，可见 thumb 约 6px
- 证据：专项 browser test 在 1 / 1.25 / 1.5 / 2 device scale factor 下均测得 10 CSS px；浅色 100% 与深色 200% 截图无裁切，button 可命中且没有 12px 方案的视觉重量
- 维护者确认：用户要求按本文执行直到完成

### 决策 2：箭头绘制方式

- 日期：2026-08-12
- 候选：CSS mask / CSS gradient / 不采用 button
- 选择：纯 CSS gradient，只作用于 `:single-button:vertical`
- 证据：不引入图片、图标或 DOM；真实 Chromium button 点击按原生小步滚动；DPI 截图清晰；forced-colors 使用系统 `ButtonText` / `Canvas`；不支持 pseudo 时其余原生路径不受影响
- 维护者确认：用户要求按本文执行直到完成

### 决策 3：Stable 例外

- 日期：2026-08-12
- 消费者：Data page `.data-page-scroll`
- auto 失败事实：趋势图随页面滚动状态改变宽度，破坏 axis 与内容几何稳定
- 测试：`tests/uiBrowserSmoke/dataScenarios.ts` 既有 geometry contract；完整 browser UI 101/101 通过
- 结论：Data 保留 stable；其余既有消费者返回 auto

### 决策 4：Padding 清理

- 日期：2026-08-12
- selector：各 feature 既有 `padding-right`；Dashboard compact `.dashboard-left-column`
- 原 padding 角色：大多数无法证明只是 scrollbar 补偿，仍承担内容留白；Dashboard compact 的 0.2rem 已由前置 spacing 修复证明为重复补偿
- 处理：保留业务 padding；只删除 direct gutter 与已证实的 Dashboard 重复补偿，不做机械 padding 清扫
- 视觉证据：Dashboard 125% DPI 卡片 gap 测试、完整页面回归与 scrollbar fixture 截图

## 16. 给后续执行代理的最后约束

- 先读长期规范，再读本文，再看 live code 与 dirty diff。
- 先证明 scroll owner，再添加 class；不要从视觉截图猜 DOM owner。
- 默认 auto，stable 必须有失败事实与 browser geometry test。
- 箭头是渐进增强，不是实现自绘 scrollbar 的理由。
- 不把 10px 当成不可调整的真理；它是原型起点，最终值由真实 DPI 与维护者确认决定。
- 不把 Codex 截图的像素外观当成 Patina 必须复制的品牌语言；只吸收可靠的桌面交互原则。
- 不为了完成迁移机械删除 padding、overscroll、focus 或 portal 规则。
- 不在 feature 中复制 pseudo selectors。
- 不用 source-string unit test 替代 browser behavior test；静态 owner 事实交给 checker。
- 不用兼容 alias 掩盖未完成迁移。
- 不在没有当前任务授权时创建 branch、commit、push、Issue、Project mutation 或 release。
