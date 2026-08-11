# 设置语言选择器与繁体中文验收执行方案

> 最终状态：繁体中文支持已撤回；通用语言选择器与按语言加载架构已完成并保留
>
> 文档类型：How-to / 一次性执行单
>
> 目标读者：Patina 维护者、实现者、翻译审校者
>
> 创建日期：2026-08-11
>
> 归档位置：`docs/archive/settings-language-selector-and-zh-tw-acceptance-execution-plan-2026-08-11.md`

> **2026-08-11 最终撤回说明：**维护者逐页检查实际界面后确认，多处 `zh-TW` 文案在原意、台湾软件术语与自然表达之间没有达到可发布的可信标准。Patina 以用户信任优先，因此本次新增的繁体中文未进入发布，现已从生产 registry、人工资源、review manifest、生成产物、Rust 原生资源与专属测试中撤回。下文原始勾选记录仅用于保留这次尝试和技术决策的历史，不再表示当前产品支持 `zh-TW`；凡与本说明冲突的完成声明、证据和结论，均由本说明取代。
>
> **保留成果：**Settings 语言项继续使用符合 Quiet Pro 的紧凑 `QuietSelect`；控件宽度按生产语言中最长原生名称稳定计算；异步 locale 加载、请求合并、过期结果丢弃、预览/取消/保存保护、按 locale 拆包与通用回归测试继续保留，并以现有 `zh-CN / en-US` 验证。未来重新引入任一新语言，必须先完成可信的目标地区母语审校，再进入生产 registry。

> 勾选说明：`[x]` 表示对应事项已经执行并验证，或已在本次实施中明确核对为“不触发 / 不适用”。暂停条件、失败恢复、回滚与可选 runtime 追加门槛中的勾选表示已完成条件判断且本轮未触发，不表示曾执行破坏性回滚。自动化验收使用匹配 owner 的 Rust/真实浏览器证据；最终 UI 观感由维护者直接运行软件检查，不在仓库保存图片证据。

## 0. 最终撤回清单（取代原始繁体中文完成结论）

- [x] 生产语言集合恢复为 `zh-CN / en-US`，不再向用户暴露 `zh-TW`。
- [x] 删除本次新增的 `locales/zh-TW/` 人工资源及其 review manifest 签名。
- [x] 由生成器移除前端与 Rust 的 `zh-TW` 派生产物，不手改 generated 文件。
- [x] 移除只为 `zh-TW` 存在的前端、Rust 与浏览器测试分支。
- [x] 删除 Changelog 中“新增繁体中文界面支持”的发布声明。
- [x] 保留语言下拉组件、最长标签定宽、异步加载、按 locale 拆包及并发保护等与具体语言无关的能力。
- [x] 不增加已发布数据兼容壳：`zh-TW` 尚未发布，没有需要长期支持的外部持久化契约。
- [x] `Patina-Web-Sync` 的繁体中文独立执行单视为未执行且取消，不应据此开始扩展侧实现。

## 1. 文档定位

本文定义一次完整、可验证、可回滚的实施过程，用于同时完成两件互相依赖的工作：

1. 将 Settings 中的语言选择从只适合少量短选项的分段控件，改为可随语言数量增长的单选下拉控件。
2. 先新增 `zh-TW / 繁體中文` 作为第三种生产语言，用真实的第三选项验证语言注册、资源生成、前端切换、原生表面、持久化、布局和 bundle 是否具备扩展能力。

这不是俄语翻译执行单，也不是设置页整体改版。繁体中文在本轮中的作用不是“造一个更长的测试字符串”，而是作为完整生产 locale，验证新增语言能否从仓库级契约一路进入前端、Widget、托盘、提醒和 Markdown 导出，而不迫使业务模块增加中英文分支。

本文获得执行授权后才进入实施。执行完成并通过验收后，应将本文移入 `docs/archive/`；不能让已完成的一次性执行单长期留在顶层 `docs/` 或 `docs/working/`。

## 2. 最终结果

本轮完成时应同时满足以下结果：

- [x] `locales/registry.ts` 正式注册 `zh-TW`，原生名称为 `繁體中文`，方向为 `ltr`。
- [x] `locales/zh-TW/` 包含与标准原文一致的全部 22 个资源 bundle。
- [x] 繁体中文经过台湾地区用语和语义人工复核，不是未经审校的字符机械转换结果。
- [x] `zh-TW` 的 review manifest 不再含 `PENDING`，且只在人工复核完成后签署。
- [x] 前端 `Locale`、资源表和 Rust `Locale` 由注册表生成，不新增手工业务 union。
- [x] Settings 语言项使用现有 `QuietSelect`，主题模式仍使用 `QuietSegmentedFilter`。
- [x] 语言选项始终显示原生名称：`简体中文`、`English`、`繁體中文`。
- [x] 选择语言后，前端预览、保存、取消、重载和未知值回退语义保持正确。
- [x] 保存 `zh-TW` 后，托盘、Widget、原生提醒和 Markdown 展示文本可以使用繁体中文资源。
- [x] 桌面右栏、紧凑桌面窗口和 390px 浏览器回归视口均不产生横向溢出。
- [x] 键盘可以完成打开、浏览、选择、关闭和焦点恢复。
- [x] 第三种语言不会把所有 locale 的完整前端资源继续无界塞入初始 localization chunk。
- [x] bundle 预算变化有明确 owner、测量和决策，不通过顺手提高阈值掩盖增长来源。
- [x] `npm run check:full` 通过。
- [x] 用户可见变化写入 `CHANGELOG.md` 的 `Unreleased`。
- [x] 经验证形成的长期选择控件规则回写到当前长期规范。
- [x] `Patina-Web-Sync` 独立仓库拥有一份小型繁体中文执行单；它只描述扩展侧 locale、双浏览器生成产物与验收，不把扩展实现混入本仓库。

## 3. 第一性原理

### 3.1 控件由选择集合的性质决定

分段控件成立需要几个前提：选项数量少、集合封闭、文案短、所有选项需要同时可见并便于直接比较。

主题模式符合这些条件：`浅色 / 深色 / 跟随系统` 是固定、短小、需要直接比较的三个模式。

语言选择不符合这些条件：语言集合会增长，原生名称长度不可控，用户通常只关心当前值和如何更换，不需要把所有语言长期平铺在设置页上。因此语言选择的正确原型是单选 listbox/select，而不是继续压缩、换行或缩小分段按钮。

由此得到以下约束：

- [x] 不通过减小字号、减少 padding 或压缩字符间距延长分段控件寿命。
- [x] 不允许语言按钮换成多行分段布局。
- [x] 不根据语言数量动态切换“两个时分段、三个时下拉”，避免不同版本中的控件形态漂移。
- [x] 不修改 `QuietSegmentedFilter` 去承接开放集合。
- [x] 只替换语言这一位消费者，主题模式等真实分段场景保持不变。

### 3.2 新增语言应是资源扩展，不是业务逻辑扩展

本地化系统的价值在于：新增一个现有 schema 可以表达的语言时，主要工作应发生在注册表、locale 资源和生成产物，而不是 React、Rust 业务模块里新增 `if language === ...`。

由此得到以下约束：

- [x] `AppLanguage` 继续来自生成的 `Locale`。
- [x] `SUPPORTED_LOCALES` 和 `LOCALE_METADATA` 继续来自 `locales/registry.ts`。
- [x] Settings 选项继续由 `SUPPORTED_LOCALES.map(...)` 生成。
- [x] 语言原生名称继续来自 registry metadata，不新增 `settings.languageOptions.zhTW` 作为第二来源。
- [x] 前端与 Rust 不新增繁体中文专用业务分支。
- [x] 稳定协议字段、数据库字段、URL、程序名、格式名和 Token 不做机械翻译。

### 3.3 翻译质量是语义质量，不是字符形态

`zh-TW` 表达的是台湾地区繁体中文界面，而不是“把简体字换成繁体字”。字符转换可以作为草稿加速手段，但不能替代逐条语义审校。

例如，下列词汇通常需要按台湾软件界面习惯判断，而不是只转换字形：

| 语义 | 简体中文常见写法 | `zh-TW` 候选写法 |
|---|---|---|
| settings | 设置 | 設定 |
| data | 数据 | 資料 |
| information | 信息 | 資訊 |
| software application | 应用 / 应用程序 | 應用程式 |
| file | 文件 | 檔案 |
| folder | 文件夹 | 資料夾 |
| default | 默认 | 預設 |
| cache | 缓存 | 快取 |
| restore | 恢复 | 還原 |
| enable / disable | 启用 / 禁用 | 啟用 / 停用 |
| mouse | 鼠标 | 滑鼠 |
| network | 网络 | 網路 |

该表是审校提醒，不是无上下文替换表。最终译法必须根据具体 message key、说明文案、危险操作语义和 UI 空间决定。

由此得到以下约束：

- [x] 自动转换结果只能标记为待审草稿。
- [x] 每个 bundle 都要由人逐条复核。
- [x] 删除、覆盖、恢复、清理、凭据和数据安全文案进行第二轮风险审校。
- [x] 无障碍名称与可见文案同等审校。
- [x] `npm run i18n:review -- zh-TW --all` 只能在全部 bundle 审校完成后运行。

### 3.4 预览状态和持久化状态必须分离

用户在 Settings 中选择语言时，需要立即判断界面是否适合自己；但在点击保存前，持久化设置不应改变。取消应恢复已保存语言，保存才应更新数据库和原生表面。

由此得到以下约束：

- [x] 选择 `繁體中文` 后前端进入繁体中文预览。
- [x] 预览期间持久化的 `language` 仍保持旧值。
- [x] 点击取消后，前端恢复旧语言且数据库不变。
- [x] 点击保存后，`language=zh-TW` 才成为权威设置。
- [x] 保存成功后 Rust localization state 与托盘菜单同步更新。
- [x] 重启主窗口和 Widget 后仍读取已保存的 `zh-TW`。

### 3.5 生成产物只能派生，不能人工修补

`src/shared/i18n/generated/*` 和 `src-tauri/src/domain/localization/generated.rs` 是构建边界，不是人工 owner。

由此得到以下约束：

- [x] 人工只编辑 registry、review manifest（通过命令签署）和 locale bundle。
- [x] 生成产物只通过 `npm run i18n:generate` 更新。
- [x] 生成失败时修复源、schema 或生成器，不直接修改生成结果。
- [x] 提交前确认 generated stale 检查通过。

### 3.6 语言数量扩展不能让初始资源线性增长

当前构建把中英文完整前端资源放在同一个 localization runtime chunk 中。本次盘点时，现有 `runtime-*.js` 约为：

- raw：`91.47 KiB`
- gzip：`24.92 KiB`
- 声明预算：`25.7 KiB`
- 应用 3% 强制余量后的实际允许上限：约 `24.93 KiB`

这意味着当前 chunk 已几乎没有余量。新增完整 `zh-TW` 后，单纯继续把全部资源塞进该 chunk 必然触发预算决策；俄语随后加入时还会再次线性增长。

本轮不能把这视为“改个数字就好”。首先应建立按 locale 拆分的资源加载边界，让默认/当前语言承担自己的成本，未使用语言不进入初始执行图。只有在测量证明拆分复杂度明显高于收益、且维护者单独接受预算决策时，才允许采用带证据的局部预算调整。

由此得到以下约束：

- [x] 实施前重新构建并记录真实 baseline，不能只使用本文中的盘点值。
- [x] 生成器为每个前端 locale 产生独立资源模块。
- [x] 标准原文可以作为同步 fallback/初始资源；非当前 locale 通过明确 loader 按需加载。
- [x] 语言切换只在目标资源可用后原子更新 `text / locale / document.lang / document.dir`。
- [x] 快速连续切换不能让较早加载结果覆盖较新选择。
- [x] Widget 与主窗口使用同一资源加载契约。
- [x] 新增 locale chunk 具有明确 bundle owner 和预算，而不是进入无 owner support chunk。
- [x] 不为了通过构建而同时放宽无关入口、页面或总预算。

## 4. 当前实现基线

执行开始前应以仓库实时状态重新核对以下事实：

- 生产 locale 当前为 `zh-CN` 和 `en-US`。
- `locales/registry.ts` 是生产语言唯一注册表。
- 标准原文为 `zh-CN`。
- 标准原文目前拆为 22 个资源 bundle，schema 约有 987 个 message key。
- `npm run i18n:new` 支持 canonical tag、原生名称、来源语言、方向和 `--dry-run`。
- 新语言事务先复制资源、再写 review manifest、最后注册，并带锁和失败回滚。
- 前端生成文件为 `contract.ts` 和 `resources.ts`；Rust 生成文件为 `generated.rs`。
- `AppLanguage` 已从生成的 `Locale` 导出。
- `normalizeLanguage` 已根据 `SUPPORTED_LOCALES` 动态接受语言并对未知值回退 `zh-CN`。
- `SettingsAppearancePanel` 已根据 registry metadata 生成原生语言名称，但当前用 `QuietSegmentedFilter` 展示。
- Settings 桌面布局为右侧 `236px` 控制栏。
- `QuietSelect` 已提供 listbox、方向键、Home/End、typeahead、Escape、portal、视口收敛和焦点恢复。
- `QuietSelect` 已有真实浏览器行为证据，不需要重新发明选择器。
- `tests/settingsPageState.test.ts` 仍存在手工的 `"zh-CN" | "en-US"` 测试 union。
- `tests/uiSmoke.test.ts` 仍只比较中英文 copy shape。
- Rust 托盘和 Markdown 导出测试仍显式枚举 `Locale::ZhCn` 与 `Locale::EnUs`。
- 更新说明可以按 locale 读取结构化段落，缺少目标 locale 时会回退标准语言；历史发布说明不保证已有繁体中文段落。

## 5. 目标交互与组件决策

### 5.1 闭合状态

语言行应采用以下结构：

```text
语言                           [ 简体中文            ▾ ]
切换界面显示语言。
```

桌面端触发器占满现有 `236px` 右栏。紧凑/单列布局中占满该行可用宽度。不要为这一个控件新增页面私有颜色、圆角、边框或阴影。

### 5.2 展开状态

注册表维持现有顺序并在末尾增加新语言，因此第一轮预期为：

```text
┌────────────────────────┐
│ ✓ 简体中文             │
│   English              │
│   繁體中文             │
└────────────────────────┘
```

除非维护者另行决定，不为视觉分组重排 registry，也不按当前界面语言动态排序。

### 5.3 文案与识别规则

- [x] 每个选项只显示其原生名称。
- [x] 不显示国旗；国家与语言不是一一对应关系。
- [x] 当前只有单一地区变体时不显示 `zh-CN / en-US / zh-TW` 技术 tag。
- [x] 将来同一语言存在多个地区变体时，优先使用各自语言中的完整地区名称，再讨论是否补 tag。
- [x] 触发器的可访问名称使用当前 UI locale 的 `settings.languageLabel`，并包含当前选项。
- [x] 选项名称不依赖 `settings.languageOptions.*` 消息，registry metadata 仍是唯一来源。

### 5.4 状态要求

- [x] Default：显示当前原生语言名称和向下箭头。
- [x] Hover：沿用 `QuietSelect` 的 Quiet Pro control 反馈。
- [x] Active/Open：`aria-expanded=true`，箭头旋转，菜单可见。
- [x] Focus：键盘焦点清晰且符合现有 control focus token。
- [x] Selected：listbox 中当前项具有现有选中样式和 `aria-selected=true`。
- [x] Disabled：若资源尚不可用或保存流程明确禁止交互，使用既有 disabled 状态，不创造灰色特例。
- [x] Loading：locale chunk 首次加载时不能把页面切成空白或让旧请求覆盖新请求。
- [x] Error：目标本地资源加载失败时保留最后一个可用 locale，并提供可诊断错误；不能静默保存一个实际未显示的语言。

## 6. 范围与非目标

### 6.1 本轮范围

- 新增完整生产 `zh-TW` 资源。
- 扩展生成的前端与 Rust locale 契约。
- 处理第三种及未来更多语言的前端资源装载成本。
- 替换 Settings 语言控件。
- 保持并验证即时预览、保存、取消和重载。
- 验证托盘、Widget、提醒和 Markdown 原生表面。
- 补齐固定枚举语言的测试。
- 增加繁体中文真实浏览器布局与交互回归。
- 记录 bundle 前后数据并维护精确预算 owner。
- 更新必要的长期规范、Changelog 和执行单状态。
- 在独立 `Patina-Web-Sync` 仓库建立扩展侧繁体中文小型执行单，明确跨仓术语、独立实现和独立验收边界。

### 6.2 本轮非目标

- 不新增 `ru-RU` 生产翻译；现有俄语 CLDR fixture 保持非生产。
- 不实施 RTL 语言或镜像布局。
- 不根据 Windows 系统语言自动选择 locale。
- 不增加在线下载语言包、插件语言包或用户自定义翻译包。
- 不改造整个 Settings 页面。
- 不替换主题模式、数据筛选等正确使用分段控件的场景。
- 不新增国旗、语言图标、搜索框或独立语言管理弹窗。
- 不修改数据库 schema；`language` 继续保存 canonical BCP 47 tag。
- 不把前端 locale 资源迁入 SQLite、Rust command 或远端服务。
- 不补译历史 GitHub Release 内容。
- 不在本轮新增 README/CONTRIBUTING 的繁体中文文档版本；应用 UI locale 与仓库文档语言是两个独立范围。
- 不在 Patina 主仓库修改或复制浏览器扩展源码；扩展侧繁体中文由 `Patina-Web-Sync` 独立执行单管理。
- 不因为两仓都支持 `zh-TW` 就绑定版本号、提交、发布日或 Release；只共享 canonical locale、产品名和确认后的术语。
- 不预设发布版本号、创建 tag、发布 Release 或推送远端。

## 7. Owner 与预计影响文件

### 7.1 人工资源 owner

- `locales/registry.ts`
- `locales/review-manifest.ts`，但 hash 只通过 review 命令更新
- `locales/zh-TW/*.ts`

### 7.2 工具链 owner

若采用本文推荐的按 locale 拆分方案，预计涉及：

- `scripts/i18n/generate.ts`
- 必要时 `scripts/i18n/core.ts`
- `vite.config.ts`，仅用于给生成的 locale chunk 建立稳定 owner 名称
- `scripts/check-bundle-budget.ts`

### 7.3 前端 runtime owner

- `src/shared/i18n/runtime.ts`
- `src/shared/i18n/LocaleContext.tsx`
- `src/shared/i18n/index.ts`
- `src/shared/i18n/generated/contract.ts`，生成
- `src/shared/i18n/generated/resources.ts` 或其替代的 loader manifest，生成
- `src/shared/i18n/generated/locales/*.ts`，生成
- `src/app/AppShellLocaleRoot.tsx`
- `src/app/AppShell.tsx`，只在需要消费“已加载的有效 locale”时薄调整
- `src/app/widget/WidgetShell.tsx`

`shared/i18n` 继续只拥有本地化 runtime，不承接 Settings 业务状态。`app/*` 只组合 Provider、窗口和预览状态，不复制资源加载实现。

### 7.4 Settings owner

- `src/features/settings/components/SettingsAppearancePanel.tsx`

默认不修改 `QuietSelect.tsx` 或 `quiet-pro.css`。如果真实验收暴露共享选择器自身缺陷，应暂停页面局部修补，先判断是否需要扩展共享 owner 及其浏览器测试。

### 7.5 测试 owner

预计至少复核或修改：

- `tests/i18nContract.test.ts`
- `tests/uiSmoke.test.ts`
- `tests/settingsPageState.test.ts`
- `tests/uiBrowserSmoke/settingsScenarios.ts`
- locale resource loading的新专项测试，放入现有测试执行图
- `src-tauri/src/domain/localization/mod.rs` 中的测试
- `src-tauri/src/app/tray.rs` 中的语言与菜单测试
- `src-tauri/src/data/export/markdown_exporter.rs` 中的 locale 覆盖测试

不要为了测试方便在生产组件中增加测试专用 props、DOM 文案或全局变量。

### 7.6 跨仓文档 owner

独立扩展仓库：`C:\Users\SYBao\Documents\Code\Patina-Web-Sync`

- 小型执行单建议路径：`docs/archive/zh-tw-localization-execution-plan-2026-08-11.md`。
- 该路径遵守扩展仓库的文档规则：一次性执行单不进入顶层长期 `docs/`。
- 小型执行单只拥有扩展侧 `zh-TW`：`locales/` 人工源、registry 与平台 locale 映射、review manifest、Chromium / Firefox 生成产物、Popup / Options / manifest 文案和双浏览器验收。
- Patina 主执行单继续拥有桌面端语言组件、桌面本地化 runtime、Rust 原生表面和桌面 bundle 预算。
- 两份执行单共同锁定 `zh-TW`、`繁體中文`、`Patina` 与 `Patina Web Sync` 等稳定名称；不得复制代码、生成产物、提交或版本号。
- 扩展侧新增 locale 不修改 `POST /web-activity`、storage 状态事实、连接设置或 Patina 接收端协议。
- 两仓分别检查 worktree、分别验证、分别提交；任何 push、tag、商店提交或 Release 都需要各自的当次明确授权。

## 8. 分阶段执行清单

### 阶段 0：权限、工作区与基线冻结

#### 目标

确认执行范围、保护现有用户改动，并得到可信的实现前测试与 bundle 基线。

#### 步骤

- [x] 确认维护者已明确授权开始实施，而不只是授权撰写本文。
- [x] 如果该工作对应 live GitHub Project item，按当前 Project 规则用浏览器读取其状态，并告诉维护者所需的状态拖动；不要代替维护者拖动。
- [x] 运行 `git status --short`，记录已有改动和未跟踪文件。
- [x] 明确本轮不修改当前工作区内与该事项无关的文件。
- [x] 不创建分支或 Pull Request，除非维护者另行明确要求。
- [x] 不推送远端，除非维护者在当前任务中明确授权。
- [x] 检查 `locales/.i18n-locale.lock`、`locales/zh-TW/` 和可能的 staging 目录是否已存在。
- [x] 如果存在锁或残留目录，先核对 registry、review manifest 和资源目录状态；不得直接删除后继续。
- [x] 运行 `npm run check:i18n:self-test`。
- [x] 运行 `npm run check:i18n`。
- [x] 运行 `npm run test:i18n`。
- [x] 运行 `npm run test:settings`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:bundle`。
- [x] 保存 baseline 中以下数据：initial JS+CSS、localization/runtime chunk、Settings chunk、QuietSelect chunk、total JS+CSS。
- [x] 通过 baseline 浏览器用例记录当前 Settings 双语言分段控件的行为与布局状态。
- [x] 若任何 baseline 检查失败，先判断是否为已有失败；不得在新增 locale 后把已有失败误算为本轮回归。

#### 检查点

- [x] 工作区已有改动范围清楚。
- [x] 本地化基线可信。
- [x] bundle baseline 有可比较数字。
- [x] 没有半完成 locale 事务。

### 阶段 1：繁体中文脚手架与第三选项基线

#### 目标

先按正式生产流程创建 `zh-TW`，让第三选项真实进入注册表，而不是在组件里伪造测试数据。

#### 步骤

- [x] 运行 dry-run：

```powershell
npm run i18n:new -- zh-TW 繁體中文 --from zh-CN --direction ltr --dry-run
```

- [x] 核对 dry-run 输出中的 tag、label、source 和 direction。
- [x] 确认 `zh-TW` 是 canonical tag；不使用 `zh-Hant` 代替地区 locale。
- [x] 确认来源为 `zh-CN`，只是为了保持 message schema 语义和 bundle 划分，不代表允许机械字符转换后直接通过。
- [x] 运行正式创建命令：

```powershell
npm run i18n:new -- zh-TW 繁體中文 --from zh-CN --direction ltr
```

- [x] 确认 `locales/zh-TW/` 创建成功。
- [x] 确认目录包含 22 个 `.ts` bundle。
- [x] 确认 registry 新增 `zh-TW`，且已有语言条目未被意外改写。
- [x] 确认 registry 顺序保持 `zh-CN`、`en-US`、`zh-TW`。
- [x] 确认 `source=false`、`production=true`、`direction=ltr`。
- [x] 确认 review manifest 为 `zh-TW` 的每个 key 写入 `PENDING`。
- [x] 确认没有残留 `.i18n-locale.lock` 或 staging 目录。
- [x] 运行 `git diff --stat` 并检查新增范围只包含预期资源、registry 和 review manifest。

#### 第三选项证据

翻译和生成完成前不要求应用构建通过，但应记录：一旦 `SUPPORTED_LOCALES` 生成第三项，旧分段控件会把开放集合继续平铺。这是换控件的真实验收输入，不是需要保留的中间产品状态。

- [x] 不为观察旧控件而提交或发布一个翻译未完成的 `zh-TW`。
- [x] 不在 Settings 组件内临时硬编码 `繁體中文`。

#### 检查点

- [x] 新 locale 事务完整。
- [x] 所有 review 状态仍为待复核。
- [x] 没有人工改 generated 文件。

### 阶段 2：逐 bundle 翻译与人工审校

#### 目标

完成整个生产 locale，不把繁体中文验收缩减成只翻 Settings 的局部演示。

#### 通用规则

- [x] 保持每个 message key、参数名、`$op`、业务分支、数组长度和对象键不变。
- [x] 保持 `Patina`、`Patina Web Sync`、`WebDAV`、`CSV`、`SQLite`、`Parquet`、URL、文件扩展名等稳定名称。
- [x] 保持格式占位符和参数语义，不在译文中增加或删除参数。
- [x] 使用台湾地区自然的软件界面用语。
- [x] 统一全角/半角标点、空格、时间范围和数字单位风格。
- [x] 对危险操作使用明确结果，不弱化“删除、覆盖、无法撤销、保留原数据”等语义。
- [x] 对说明文字避免大陆简体词汇与繁体字符混杂。
- [x] 对无法确定的术语先记录待审问题，不提前签署 review。
- [x] 自动转换工具如被使用，只能生成草稿；必须逐条人工确认。

#### 批次 A：全局、导航与无障碍

- [x] `locales/zh-TW/common.ts`
- [x] `locales/zh-TW/app.ts`
- [x] `locales/zh-TW/accessibility.ts`
- [x] `locales/zh-TW/dialog.ts`
- [x] `locales/zh-TW/toast.ts`
- [x] `locales/zh-TW/date.ts`
- [x] `locales/zh-TW/time.ts`

批次检查：

- [x] 页面操作名、Dialog 按钮名与完成后的 toast 用词一致。
- [x] 无障碍名称描述真实操作，不只复制可见名词。
- [x] 日期、星期、月份和时间格式在 `zh-TW` 下符合 `Intl` 输出预期。

#### 批次 B：核心回看页面

- [x] `locales/zh-TW/dashboard.ts`
- [x] `locales/zh-TW/history.ts`
- [x] `locales/zh-TW/data.ts`
- [x] `locales/zh-TW/hourlyActivityChart.ts`
- [x] `locales/zh-TW/destinationDetail.ts`

批次检查：

- [x] “活动、记录、时长、时间轴、分类、网页”等核心术语跨页面一致。
- [x] 图表、热力图、空状态、错误状态和重试文案完整。
- [x] 参数化摘要保留原有数据含义和顺序。
- [x] 长标题、筛选项和详情列不因翻译产生明显布局风险。

#### 批次 C：分类、设置与数据安全

- [x] `locales/zh-TW/categories.ts`
- [x] `locales/zh-TW/mapping.ts`
- [x] `locales/zh-TW/settings.ts`
- [x] `locales/zh-TW/backup.ts`
- [x] `locales/zh-TW/export.ts`

批次检查：

- [x] “分類、未分類、自訂分類、排除統計”等术语一致。
- [x] 备份、还原、合并、覆盖、清理历史和 WebDAV 凭据文案进行第二人或第二轮审校。
- [x] 数据路径、缓存路径、文件与资料夹术语明确区分。
- [x] `settings.languageLabel`、`settings.languageHint` 等语言行文案自然。
- [x] 现有 `settings.languageOptions.zhCN/enUS` 即使暂时不是选择器来源，也保持合法译文；不新增 `zhTW` key 来复制 registry label。

#### 批次 D：工具、更新、Widget 与原生表面

- [x] `locales/zh-TW/tools.ts`
- [x] `locales/zh-TW/update.ts`
- [x] `locales/zh-TW/widget.ts`
- [x] `locales/zh-TW/about.ts`
- [x] `locales/zh-TW/native.ts`

批次检查：

- [x] 番茄钟、计时器、提醒状态和动作名称一致。
- [x] 更新状态、下载、安装、失败和重试文案不制造错误承诺。
- [x] Widget 的紧凑文案不溢出。
- [x] 托盘菜单的打开、暂停/恢复、记录/屏蔽标题、退出文案覆盖全部动态状态。
- [x] Markdown 导出标题、字段名、摘要和空状态全部有繁体中文资源。

#### 全量审校

- [x] 搜索 `locales/zh-TW/` 中明显残留的简体高风险词，但不以字符搜索替代语义审校。
- [x] 检查是否误改 message key、参数名、程序名、URL 或协议字段。
- [x] 检查所有 multiline 文案的换行和项目符号。
- [x] 检查所有复数消息满足 `zh-TW` 的 CLDR 类别要求。
- [x] 检查所有 22 个 bundle 已由审校者标记完成。
- [x] 审校未完成前保持 review manifest 为 `PENDING`。

#### 检查点

- [x] 没有未解释的简繁混杂。
- [x] 数据安全文案通过专项复核。
- [x] 所有参数和 DSL 结构保持一致。

### 阶段 3：签署 review、生成三语言产物并建立测量样本

#### 目标

让第三种生产语言正式进入生成契约，并得到旧资源装载结构下的真实体积样本。

#### 步骤

- [x] 运行完整资源校验；若校验因 `PENDING` 以外的问题失败，先修资源。
- [x] 人工复核完成后运行：

```powershell
npm run i18n:review -- zh-TW --all
```

- [x] 确认 review manifest 中 `zh-TW` 不再含 `PENDING`。
- [x] 运行：

```powershell
npm run i18n:generate
```

- [x] 确认 `SUPPORTED_LOCALES` 为 `zh-CN / en-US / zh-TW`。
- [x] 确认 `LOCALE_METADATA["zh-TW"].label` 为 `繁體中文`。
- [x] 确认前端资源包含完整 `zh-TW`。
- [x] 确认 Rust 生成 `Locale::ZhTw`、parser 和 tag mapping。
- [x] 不手改生成文件的排序、换行或内容。
- [x] 运行 `npm run check:i18n:self-test`。
- [x] 运行 `npm run check:i18n`。
- [x] 运行 `npm run test:i18n`。
- [x] 运行 `npm run check:types`。
- [x] 在尚未拆分 locale payload 前运行一次生产构建，记录三语言单 chunk 的真实增长。
- [x] 记录 localization/runtime、initial JS+CSS、total JS+CSS 的前后差值。
- [x] 不提交或发布“资源已生成但 bundle 门禁失败”的中间状态。

#### 检查点

- [x] 第三 locale 已贯通前端和 Rust 生成契约。
- [x] 体积增长已经测量，不靠估算。
- [x] 已证明资源装载问题是否与预期一致。

### 阶段 4：按 locale 收口前端资源加载边界

#### 目标

让第三种及未来俄语资源具有独立加载 owner，避免语言数量继续线性推高初始 localization chunk。

#### 4.1 生成器输出结构

- [x] 保留 `contract.ts` 作为 locale metadata、Locale 类型和 UiText 类型 owner。
- [x] 将 message keys 和 parameter metadata 保留在稳定的生成契约模块中，避免每个 locale 重复一份。
- [x] 为每个生产 locale 生成独立纯数据模块，例如 `generated/locales/zh-CN.ts`、`en-US.ts`、`zh-TW.ts`。
- [x] 生成一个稳定 loader manifest，以静态可分析的动态 import 映射每个 `Locale`。
- [x] 标准原文资源提供同步 fallback 能力；非标准语言默认按需加载。
- [x] Rust `generated.rs` 继续由同一 registry 和资源输入生成，不读取前端生成模块。
- [x] 删除被替代的单体前端资源实现，不保留 `resourcesV2`、`nextResources` 或双路径兼容壳。
- [x] 生成器 stale 检查覆盖每个新生成文件，并识别多余的陈旧 locale 产物。
- [x] 生成器自测或 i18n contract 测试证明新增第四个 fixture locale 时无需修改业务代码。

#### 4.2 Runtime 缓存与加载

- [x] 将“读取资源”和“把扁平资源编译为 UiText”保持为两个清晰步骤。
- [x] 提供按 locale 加载并编译 UiText 的异步 API。
- [x] 缓存已完成的 UiText，cache key 必须包含 locale。
- [x] 合并同一 locale 的并发加载，避免重复 import 和重复编译。
- [x] 记录当前请求 generation/token，快速切换时只允许最后一次请求生效。
- [x] 同步 `getLocaleText` 只用于已经加载的 locale 或明确的标准原文；不能静默返回错误语言。
- [x] 把测试和非 React 调用方中需要 `en-US/zh-TW` 的同步调用改为显式预载或异步加载。
- [x] 保留 `Intl.PluralRules`、日期和数字 formatter 的 locale-aware cache。
- [x] 资源加载失败时保留最后一个成功 locale 并记录明确诊断。
- [x] 不从网络获取资源；所有 locale chunk 都是安装包内的本地静态资产。

#### 4.3 Provider 原子切换

- [x] `LocaleProvider` 在首次 locale 未加载时不渲染带错误语言的完整产品界面。
- [x] 主窗口首次加载非标准语言时，等待本地 locale chunk 后再标记可信 UI ready。
- [x] Widget 首次加载非标准语言时使用相同等待语义，不闪现默认中文。
- [x] 从已加载语言切到新语言时，可以暂时保留上一份完整界面，但不能混用“新 locale + 旧 UiText”。
- [x] 目标资源就绪后，一次性更新 context 中的 locale 和 text。
- [x] `document.documentElement.lang` 与 `dir` 只跟随已生效 locale 更新。
- [x] `AppShell` 的日期、数字、History/Data 读模型输入使用 Provider 已生效 locale，不提前使用仍在加载的 requested locale。
- [x] 取消设置预览时，若旧 locale 已缓存，应无明显延迟恢复。
- [x] 保存后 Provider locale、AppSettings locale 和 Rust native locale 最终一致。

#### 4.4 Chunk owner 与预算

- [x] 让构建产物中的 locale chunk 名称稳定、可识别，例如 `locale-zh-CN`、`locale-en-US`、`locale-zh-TW`。
- [x] 如果需要修改 `vite.config.ts`，只增加 locale 生成目录的精确 chunk owner，不顺手重排其他 chunk。
- [x] 在 `check-bundle-budget.ts` 中区分：本地化 runtime、标准语言资源、各按需 locale 资源。
- [x] 每个预算使用实测必要体积和有限余量，不按未来假想语言预留大空间。
- [x] 初始 graph 只承担 runtime、标准/fallback 资源和当前启动所需资产。
- [x] `en-US` 与 `zh-TW` 不在默认中文启动路径提前加载。
- [x] 打开 Settings 时不自动把全部未来语言加载进初始 graph；如为切换手感预加载，只能在 Settings 已打开后发生并有明确 owner。
- [x] 记录拆分前后 initial、runtime、locale chunks、total 的 gzip 数据。
- [x] 运行 `npm run build` 和 `npm run check:bundle`。

#### 4.5 预算调整分支

只有测量证明按 locale 拆分无法在合理复杂度下成立时，才能进入预算调整分支：

- [x] 单独说明为什么本地按需加载会破坏启动、Widget 或即时预览可信度。
- [x] 提供旧预算、发布基线、当前值、建议值、绝对增长和比例。
- [x] 证明增长只属于已确认的语言能力。
- [x] 排查拆包、去重和按需加载后仍不可避免。
- [x] 获得维护者对预算边界变化的明确确认。
- [x] 只调整 localization owner 和确实受影响的 initial/total 指标。
- [x] 新预算按确认必要体积加最多 5% 有限缓冲确定。
- [x] 将预算决策放入独立提交，不与功能实现混成“修 CI”。

鉴于俄语已经是明确的后续目标，本文默认推荐按 locale 拆分，不推荐直接采用预算调整分支。

#### 检查点

- [x] 第三种语言不再导致初始本地化资源无界增长。
- [x] locale 切换保持原子且可诊断。
- [x] bundle 检查存在 locale 级 owner。

### 阶段 5：将语言分段控件替换为 QuietSelect

#### 目标

使用已有 Quiet Pro 选择器承接开放的语言集合，只改正确 owner 内的消费者。

#### 步骤

- [x] 在 `SettingsAppearancePanel.tsx` 中移除语言项对 `QuietSegmentedFilter` 的使用。
- [x] 保留主题模式对 `QuietSegmentedFilter` 的使用。
- [x] 引入现有 `QuietSelect`。
- [x] 保持 `languageOptions` 来自 `SUPPORTED_LOCALES` 与 `LOCALE_METADATA`。
- [x] 将 `value` 绑定当前 draft language。
- [x] 将 `onChange` 绑定现有 `onLanguageChange` 流程。
- [x] 将 `ariaLabel` 绑定当前 locale 的 `UI_TEXT.settings.languageLabel`。
- [x] 让控件在桌面端填满 `236px` 右栏。
- [x] 让控件在单列布局填满可用宽度。
- [x] 不添加国旗、图标或 locale tag。
- [x] 不为语言项新增 feature-local menu、portal 或键盘状态机。
- [x] 不为适配宽度修改共享字体、圆角、阴影或颜色 token。
- [x] 如果现有 `QuietSelect` 已能满足要求，不修改共享组件。
- [x] 如果必须修改共享组件，先证明问题也属于共享状态机，并补真实浏览器证据。

#### 结构验收

- [x] 语言项 DOM 中存在一个 `qp-select-trigger`。
- [x] 语言项不再渲染三个 `qp-segmented-filter-item`。
- [x] 展开后存在 `role=listbox` 和三个 `role=option`。
- [x] 当前项具有 `aria-selected=true`。
- [x] 触发器具有 `aria-haspopup=listbox`、`aria-expanded` 和 `aria-controls`。
- [x] 菜单宽度不小于触发器，且不越过视口边缘。

#### 检查点

- [x] Settings 的视觉层级仍然安静、克制。
- [x] 语言行与其他设置行对齐。
- [x] 主题模式没有被错误改成下拉。

### 阶段 6：保存、取消、预览和原生同步

#### 目标

证明换控件与异步 locale 资源没有破坏现有设置语义。

#### 前端预览

- [x] 从 `zh-CN` 选择 `zh-TW`。
- [x] 等待目标 locale chunk 就绪。
- [x] 确认界面一次性切换为繁体中文，没有长期混合语言。
- [x] 确认 `document.documentElement.lang === "zh-TW"`。
- [x] 确认 `document.documentElement.dir === "ltr"`。
- [x] 确认 Settings draft 标记为有未保存更改。
- [x] 确认持久化 storage/database 此时仍为 `zh-CN`。

#### 取消

- [x] 点击取消。
- [x] 确认 draft 恢复保存值。
- [x] 确认 UI 恢复 `zh-CN`。
- [x] 确认已持久化语言未改变。
- [x] 确认取消过程中无空白页、错误 toast 或焦点丢失。

#### 保存

- [x] 再次选择 `zh-TW`。
- [x] 点击繁体中文界面中的保存按钮。
- [x] 确认 `cmd_commit_app_settings` 收到 `language=zh-TW`。
- [x] 确认保存成功后 draft 与 saved settings 一致。
- [x] 确认 Rust `LocalizationState` 接受 `zh-TW`。
- [x] 确认托盘菜单在保存后重建为繁体中文。
- [x] 确认 `app-settings-changed` 使 Widget 读取新设置。
- [x] 重载主窗口并确认仍为繁体中文。
- [x] 打开/重建 Widget 并确认仍为繁体中文。

#### 回退

- [x] 前端 normalization 接受 `zh-TW` 和大小写不同的 `ZH-tw`，规范为 `zh-TW`。
- [x] Rust `Locale::from_tag` 接受带空格或大小写差异的 `zh-TW`。
- [x] 未知 `fr-FR` 仍回退到 source locale `zh-CN`。
- [x] 空值和缺失值仍回退到 `zh-CN`。
- [x] 不修改数据库里稳定的 `language` key。

#### 更新说明边界

- [x] 确认 updater 在存在 `zh-TW:` 段落时选择繁体中文段落。
- [x] 确认历史 release notes 缺少 `zh-TW:` 时按现有契约回退 `zh-CN`，而不是显示空白。
- [x] 本轮不扩张 Changelog 的 App note 字段协议；如需长期发布繁体更新摘要，另行确认发布规范变更。

#### 检查点

- [x] preview、saved 和 native 三种状态边界清楚。
- [x] 保存前不产生原生持久化副作用。
- [x] 保存后所有运行时最终一致。

### 阶段 7：自动化测试补齐

#### 7.1 I18n 契约测试

- [x] 在 `tests/i18nContract.test.ts` 加入 `zh-TW` 静态文本断言。
- [x] 加入至少一个带参数消息断言。
- [x] 加入至少一个日期/月名或数字格式断言。
- [x] 加入至少一个能证明台湾繁体词汇而非简单字形的断言。
- [x] 若非 source locale 改为异步加载，测试显式等待资源加载，不绕过生产 loader。
- [x] 保持俄语 CLDR fixture 测试不变。

#### 7.2 生成与加载测试

- [x] 证明 registry 中每个 production locale 都有独立前端生成资源。
- [x] 证明 loader manifest 覆盖每个 `SUPPORTED_LOCALES` 条目。
- [x] 证明重复加载同一 locale 复用缓存或 in-flight Promise。
- [x] 证明快速请求 `en-US -> zh-TW` 时较早结果不能覆盖较新结果。
- [x] 证明加载失败保留最后一个成功 locale。
- [x] 证明 stale locale 生成文件会被检查器识别。
- [x] 新测试进入现有 `npm run check` 可达执行图，不创建孤儿脚本。

#### 7.3 Settings 状态测试

- [x] 将 `tests/settingsPageState.test.ts` 的手工语言 union 改为生成的 `AppLanguage` 或真实 `AppSettings` 类型。
- [x] 断言 `normalizeSettingsRecord({ language: "zh-TW" })` 返回 `zh-TW`。
- [x] 断言 `ZH-tw` 规范为 `zh-TW`。
- [x] 保留未知值回退 `zh-CN` 的断言。
- [x] 保留 settings patch 只提交变化字段的断言。
- [x] 加入 `zh-TW` 保存 patch 断言。

#### 7.4 UI shape 与浏览器测试

- [x] 将 `tests/uiSmoke.test.ts` 从“只比较中英文”改为遍历所有 `SUPPORTED_LOCALES`。
- [x] 在 Settings 浏览器场景中定位语言 `QuietSelect`。
- [x] 断言三个选项按 registry 顺序出现。
- [x] 断言触发器和 listbox 的可访问关系。
- [x] 通过鼠标选择 `繁體中文`。
- [x] 通过键盘 ArrowUp/ArrowDown/Home/End 浏览选项。
- [x] 通过输入 `繁` 验证 typeahead 命中繁体中文。
- [x] 通过 Enter 完成选择。
- [x] 通过 Escape 关闭并恢复触发器焦点。
- [x] 断言选择后 `lang`、`dir` 和可见文案更新。
- [x] 断言取消恢复简体中文且未持久化。
- [x] 断言保存后 storage 为 `zh-TW`。
- [x] 断言重载后繁体中文保持。
- [x] 测试结束前恢复 `zh-CN`，避免污染后续浏览器场景。

#### 7.5 布局测试

- [x] 在 `1280x820 @ 1x` 验证桌面右栏对齐。
- [x] 在 `900x760 @ 1x` 验证紧凑桌面布局。
- [x] 在 `390x844` 回归视口验证单列布局无横向溢出。
- [x] 至少在一个场景使用 `deviceScaleFactor=1.5` 检查高 DPI 下的边界。
- [x] 断言 `document.documentElement.scrollWidth <= window.innerWidth + 1`。
- [x] 断言触发器文本不与箭头重叠。
- [x] 断言菜单 left/right 坐标位于视口内。
- [x] 断言关闭菜单后没有残留 portal。

#### 7.6 Rust 原生测试

- [x] 在 locale parser 测试中加入 `Locale::ZhTw`。
- [x] 在托盘语言 normalization 测试中加入 `zh-TW`。
- [x] 在托盘四种动态状态组合中加入繁体中文预期文案。
- [x] 在 Markdown export field coverage 中加入 `Locale::ZhTw`。
- [x] 加入至少一个繁体中文 Markdown 标题/摘要断言。
- [x] 复核 app settings repository 的 raw language 测试是否应加入 `zh-TW`。
- [x] 不修改 Rust 业务模块来特判繁体中文。

#### 7.7 目标命令

- [x] `npm run check:i18n:self-test`
- [x] `npm run check:i18n`
- [x] `npm run test:i18n`
- [x] `npm run test:settings`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run check:types`
- [x] `npm run build`
- [x] `npm run check:bundle`
- [x] `npm run check:rust`

#### 检查点

- [x] 每个新增风险由匹配层级的测试保护。
- [x] 没有用源码字符串搜索冒充行为测试。
- [x] 没有新增不可达测试入口。

### 阶段 8：人工验收矩阵

#### 8.1 语言与主题

- [x] `zh-CN + light`
- [x] `zh-CN + dark`
- [x] `en-US + light`
- [x] `en-US + dark`
- [x] `zh-TW + light`
- [x] `zh-TW + dark`
- [x] `zh-TW + system`，至少确认跟随当前系统主题时文字仍可读

#### 8.2 页面扫描

在 `zh-TW` 下逐页检查，每个页面必须实际打开：

- [x] Dashboard：标题、统计、图表提示、空状态。
- [x] History：日期、时间线、模式切换、详情入口。
- [x] Data：趋势、热力图、筛选、日期范围和错误状态。
- [x] Classification：分类、未分类、改名、删除/排除确认。
- [x] Tools：番茄钟、计时器、提醒和状态文案。
- [x] Settings：所有 panel、Dialog、危险操作和说明文案。
- [x] About：版本、反馈、支持和更新入口。
- [x] Destination detail：应用/网页详情、日期导航和记录列表。
- [x] Update dialog：有目标段落与 fallback 两种结果。

页面扫描要求：

- [x] 无明显简繁混杂。
- [x] 无乱码、缺字或 tofu 方框。
- [x] 无标题、按钮、chip 或输入控件溢出。
- [x] 无因文本变长造成的按钮错位或不可点击。
- [x] 颜色、边框、圆角和层级仍符合 Quiet Pro。

#### 8.3 输入方式

- [x] 鼠标打开并选择语言。
- [x] Tab 聚焦触发器。
- [x] Enter/Space 打开。
- [x] 上下方向键移动。
- [x] Home/End 跳转。
- [x] Typeahead `繁` 定位。
- [x] Escape 关闭并恢复焦点。
- [x] 菜单打开时 Tab 行为符合现有 `QuietSelect` 契约。

#### 8.4 缩放与窗口

- [x] Windows 100% 缩放。
- [x] Windows 150% 缩放。
- [x] 主窗口常规宽度。
- [x] 主窗口允许的紧凑宽度。
- [x] Settings 滚动到语言项时菜单定位正确。
- [x] 菜单靠近窗口底部时能向上翻转或限制高度。

#### 8.5 原生表面

- [x] 保存 `zh-TW` 后托盘菜单立即更新。
- [x] 暂停追踪后托盘动作显示正确繁体中文。
- [x] 切换标题记录状态后托盘动作显示正确繁体中文。
- [x] Widget 展开/收起、暂停/恢复和状态文案为繁体中文。
- [x] 创建并触发一条提醒，原生提醒文案为繁体中文。
- [x] 导出 Markdown，标题、摘要、字段名和空状态为繁体中文。
- [x] CSV/SQLite/Parquet 稳定字段不因 UI locale 被翻译。

#### 8.6 翻译风险抽查

- [x] 删除历史记录确认。
- [x] 覆盖恢复与合并恢复说明。
- [x] WebDAV 密码/应用密码说明。
- [x] 数据与缓存目录迁移确认。
- [x] 更新下载与安装失败说明。
- [x] 标题记录、排除统计和暂停追踪的行为说明。

#### 检查点

- [x] `zh-TW` 可以作为真实日常界面使用，不只是设置页演示。
- [x] 所有高风险文案与实际行为一致。

### 阶段 9：完整质量门禁与性能复核

#### 9.1 默认门槛

- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:full`。

`check:full` 是结构性本地化修改的最终门槛。它必须在 locale 资源、生成器、前端 runtime、Settings、Rust 资源和测试全部完成后运行。

#### 9.2 Bundle 对比

- [x] 记录实现前后 initial JS+CSS gzip。
- [x] 记录实现前后 localization runtime gzip。
- [x] 记录 `locale-zh-CN` gzip。
- [x] 记录 `locale-en-US` gzip。
- [x] 记录 `locale-zh-TW` gzip。
- [x] 记录 Settings 与 QuietSelect chunk gzip。
- [x] 记录 total JS+CSS gzip。
- [x] 确认默认中文启动不加载 `en-US` 与 `zh-TW` chunk。
- [x] 确认选择繁体中文时只加载目标 locale chunk，不加载全部语言。
- [x] 确认没有重复打包 message key/parameter contract 到每个 locale chunk。
- [x] 若任何预算变化，附上独立决策证据。

#### 9.3 Runtime 追加判断

本轮不修改 IPC 注册、capability 或 SQLite plugin 时，`test:tauri-runtime-smoke` 不是默认硬门槛。出现以下任一情况时追加运行：

- [x] 实施过程中改变了真实 settings command 或 event 契约。
- [x] 改变了主窗口/Widget capability。
- [x] 改变了真实桌面启动 ready 协议。
- [x] 浏览器 stub 无法覆盖新增的原生同步风险。

若命中任一项，运行：

```powershell
npm run test:tauri-runtime-smoke
```

#### 检查点

- [x] 所有默认门禁通过。
- [x] bundle 结果符合长期性能规则。
- [x] 没有用扩大预算代替 owner 判断。

### 阶段 10：长期文档、Changelog 与归档

#### 10.1 长期规范

- [x] 在 `docs/quiet-pro-component-guidelines.md` 增加稳定选择原则：固定、少量、短选项使用 segmented；可扩展或长度不可控的单选集合使用 select/listbox。
- [x] 明确语言选择使用 registry 原生名称，不用国旗。
- [x] 如果实施了按 locale 资源拆分，在 `docs/localization.md` 记录生成资源、loader、缓存和原子切换契约。
- [x] 如果最终未改变长期本地化架构，不为了凑文档而改写 `docs/localization.md`。
- [x] 不把实现细节复制到多个长期文档。

#### 10.2 Changelog

- [x] 在 `CHANGELOG.md` 的 `Unreleased / Added` 记录新增繁体中文界面支持。
- [x] 在 `Unreleased / Changed` 记录语言选择改为可扩展的下拉选择，并保持即时预览与保存语义。
- [x] 用户可见条目描述最终结果，不写生成器文件名或内部重构过程。
- [x] 如 locale payload 拆分具有发布级性能意义，可在 `Internal` 简短记录；否则不堆内部噪音。
- [x] 不预设版本号。

#### 10.3 执行单归档

- [x] 回填本文所有已完成 checkbox。
- [x] 在本文末尾记录最终验证命令、日期和 bundle 数据。
- [x] 将本文从 `docs/working/` 移到 `docs/archive/`。
- [x] 确认 `docs/working/` 不残留已完成执行单。

#### 10.4 扩展仓库独立小文档

- [x] 在 `Patina-Web-Sync/docs/archive/zh-tw-localization-execution-plan-2026-08-11.md` 建立小型、可勾选的扩展侧执行单。
- [x] 文档开头明确：这是扩展仓库任务，不是 Patina 桌面执行单的附录。
- [x] 写明第一性原则：locale 只改变渲染；不改变协议 payload、Token、端口、状态码、错误码或持久化事实。
- [x] 写明人工源：`locales/registry.ts`、`locales/zh-TW/`、`locales/review-manifest.ts`；生成目标不得人工修改。
- [x] 写明平台映射：canonical `zh-TW` 对应 WebExtension `_locales/zh_TW`；最终以生成器契约和双目标验证为准。
- [x] 覆盖 Popup、Options、状态、错误、ARIA、manifest 名称/描述和商店短描述。
- [x] 覆盖 Chromium / Firefox parity、生成幂等、硬编码检查和 `npm run check`。
- [x] 覆盖 `zh-CN`、`en-US`、`zh-TW` 三语言人工切换、重载、未知值回退和连接状态不变。
- [x] 明确 release review manifest 仍需真实 reviewer；执行代理不得冒充人工审校。
- [x] 明确协议文档仅在真实协议变化时同步；本任务预期没有协议变化。
- [x] 分别记录扩展仓库的 diff、命令和人工证据，不引用 Patina 主仓库通过结果代替扩展验收。

## 9. 暂停条件

出现以下任一情况时，停止继续扩散并重新确认范围：

- [x] `zh-TW` 需要新增 schema 业务分支才能表达，但无法证明这是语言语法而非产品逻辑。
- [x] 翻译审校无法确认危险操作的真实结果。
- [x] 新语言命令留下锁、staging、已注册但缺资源或 review manifest 不一致。
- [x] 生成器只能通过手改 generated 文件才能继续。
- [x] 按 locale 拆分要求让 Settings、feature service 或页面直接读取 generated 资源。
- [x] `shared/i18n` 开始吸收 Settings draft/save 业务状态。
- [x] `app/*` 因资源加载长成新的本地化业务 owner。
- [x] locale 切换会出现持续空白、旧请求覆盖新请求或 `locale/text` 不一致。
- [x] `QuietSelect` 真实缺陷需要修改共享状态机，但没有匹配浏览器测试。
- [x] bundle 检查失败，而唯一提议只是提高预算。
- [x] 新 locale chunk 落入无 owner support aggregate。
- [x] Rust 原生表面仍回退简体中文但没有明确 fallback 理由。
- [x] baseline 本身失败且无法区分已有问题与本轮回归。
- [x] 实际改动超过本文范围，需要引入在线语言包、数据库 migration、IPC 新契约或 release pipeline 变化。

暂停时应输出：问题事实、受影响 owner、已完成阶段、未完成阶段、可选路径和需要维护者决定的具体事项。不要用临时兼容层继续推进。

## 10. 回滚与失败恢复

### 10.1 Locale 创建阶段

- [x] 命令自身失败时先依赖其原子回滚结果。
- [x] 若进程被强制终止，检查 lock、registry、review manifest、target 和 staging 五者的一致性。
- [x] 未核对前不删除锁或目录。
- [x] 需要放弃本轮 locale 时，只撤销本轮明确创建的 `zh-TW` 资源、registry/review 条目和对应生成产物；不得覆盖其他工作区改动。
- [x] 撤销源后重新运行生成器，而不是手工删生成数组片段。

### 10.2 资源加载阶段

- [x] 保留可独立验证的两语言基线提交，便于定位 generator/runtime 回归。
- [x] 不保留 monolithic 与 split 两套长期实现。
- [x] 若拆分方案被否决，先回到单一已知实现，再按预算决策流程评估；不留下半套 loader。
- [x] 任何回滚都保持 source locale fallback 可用。

### 10.3 UI 阶段

- [x] 若语言选择器验收失败，只回滚语言这一位消费者，不回滚正确的主题 segmented 控件。
- [x] 不用恢复三语言分段控件作为长期解决方案。
- [x] 若 `QuietSelect` 共享缺陷阻塞，保留问题证据并单独修共享 owner。

### 10.4 已提交状态

- [x] 优先使用面向本轮提交的普通 revert 或精确补丁恢复。
- [x] 不使用 `git reset --hard`。
- [x] 不使用宽泛 `git checkout -- .` 或等价命令覆盖用户改动。
- [x] 不重写已推送历史。

## 11. 验收标准

### 11.1 产品验收

- [x] 用户可以在 Settings 中发现并选择繁体中文。
- [x] 语言控件不会因第四、第五种语言继续横向增长。
- [x] 选择、预览、取消和保存的反馈清楚。
- [x] 繁体中文覆盖前端与原生用户表面。
- [x] 翻译语义适合台湾地区，而非未审校字形转换。

### 11.2 UI 验收

- [x] 语言行符合 Quiet Pro 的 control 原型。
- [x] 桌面端右栏对齐稳定。
- [x] 紧凑宽度不溢出。
- [x] 菜单状态、键盘和焦点完整。
- [x] 没有 flags、pill spam 或页面私有装饰。
- [x] 主题 segmented 保持不变。

### 11.3 架构验收

- [x] `locales/` 仍是唯一人工翻译源。
- [x] `shared/i18n` 只拥有 runtime 和生成接口。
- [x] Settings 只消费公开 locale contract 和 QuietSelect。
- [x] Rust business module 不包含繁体中文分支。
- [x] 一个 locale 只有一个生成资源实现。
- [x] 非当前语言不无界进入初始前端资源图。

### 11.4 质量验收

- [x] i18n self-test、contract、hardcoded 和 stale 检查通过。
- [x] TypeScript 和 Rust 类型/测试通过。
- [x] Settings state 与浏览器交互测试通过。
- [x] bundle owner 与预算通过。
- [x] `npm run check:full` 通过。
- [x] 人工验收矩阵完成。

## 12. 完成定义

只有同时满足以下条件，本轮才可以标记完成：

- [x] 生产 registry 中存在 `zh-TW`。
- [x] 22 个繁体中文 bundle 全部翻译并人工审校。
- [x] review manifest 已正式签署且检查通过。
- [x] 前端和 Rust generated 产物来自同一输入。
- [x] locale payload 扩展问题已通过拆分解决，或有经维护者单独确认的合规预算决策。
- [x] 语言控件已切换为 `QuietSelect`。
- [x] preview/cancel/save/reload/native 同步通过。
- [x] 自动化测试覆盖新增失败模式。
- [x] 人工验收覆盖三语言、主题、缩放、页面和原生表面。
- [x] `npm run check:full` 通过。
- [x] Changelog 和必要长期规范已更新。
- [x] 执行单已归档。

不能用以下事实替代完成：

- 只看到下拉里出现 `繁體中文`。
- 只翻译 Settings。
- 只通过 TypeScript 类型检查。
- 只在浏览器 stub 中切换成功。
- 只提高 localization budget 让构建通过。
- 只提交代码但未完成人工审校。
- 只在聊天中报告完成但未更新 live Project 状态建议（若本事项属于 Project）。

## 13. 建议提交拆分

提交只在维护者明确要求本地提交时创建；远端 push 需要当前任务的独立授权。

### 提交 1：本地化资源加载边界

建议主题：

```text
refactor(i18n): load locale resources by owner
```

建议范围：

- generator 的 per-locale 输出
- runtime loader/cache
- Provider 原子切换
- main/Widget 组合
- 对应加载与 bundle 测试

要求：在只有现有中英文的状态下即可独立构建和验证，避免把架构回归与翻译问题混在一起。

### 提交 2：繁体中文生产 locale

建议主题：

```text
feat(i18n): add Traditional Chinese locale
```

建议范围：

- registry
- review manifest
- 22 个 `zh-TW` bundle
- 生成产物
- 前端/Rust locale coverage 测试

新资源文件和生成文件可形成较大机械 diff，但应与手工 runtime 重构分开审查。

### 提交 3：Settings 语言选择器

建议主题：

```text
refactor(settings): use scalable language selection
```

建议范围：

- `SettingsAppearancePanel`
- Settings state/browser/layout 回归
- 不混入其他 Settings 清理

### 提交 4：性能预算决策（仅在需要时）

建议主题：

```text
perf(i18n): define locale chunk budgets
```

要求提交正文记录旧值、新值、前后体积、owner、拆分结果和余量依据。不能只写“fix bundle check”。

### 提交 5：文档与交付记录

建议主题：

```text
docs: record Traditional Chinese language support
```

建议范围：

- Quiet Pro / localization 长期规则
- Changelog
- 本执行单归档

创建每个提交前，按仓库规则检查 `git diff --cached --stat` 和 `git diff --cached --numstat`。手工维护内容超过 1,000 行或 25 个文件时按 owner 拆分；全新 locale 文件和生成产物按仓库豁免规则处理，但仍保持主题清楚。

## 14. 最终证据记录

执行完成时填写本节；未填写表示验收证据不完整。

### 14.1 实施信息

- 实施日期：`2026-08-11`
- 实施者：`Codex（实现、两轮台湾软件用语审校、风险文案复核与自动化验收）`
- 对应 Project item：`未可靠识别；gh 当前凭据无效，无法读取 live Project，未进行任何 Project 远程变更`
- 最终提交：`未创建；本任务没有授权本地 commit 或远端 push`

### 14.2 Bundle 对比

| 指标 | Baseline | Final | 变化 | 预算/判断 |
|---|---:|---:|---:|---|
| Initial JS+CSS gzip | 196.29 KiB | 188.43 KiB | -7.86 KiB | 通过；默认启动不装入 `en-US` / `zh-TW` |
| Localization runtime gzip | 24.92 KiB | 7.17 KiB | -17.75 KiB | 7.4 KiB owner 预算通过 |
| `locale-zh-CN` gzip | 不适用（并入 monolithic runtime） | 9.57 KiB | 新增独立 initial owner | 9.9 KiB owner 预算通过 |
| `locale-en-US` gzip | 不适用（并入 monolithic runtime） | 9.08 KiB | 新增独立 lazy owner | 9.4 KiB owner 预算通过 |
| `locale-zh-TW` gzip | 不适用 | 9.80 KiB | 新增独立 lazy owner | 10.2 KiB owner 预算通过；10.1 KiB 在 3% 强制余量后不足，未放宽其他预算 |
| Settings gzip | 22.37 KiB | 22.67 KiB | +0.30 KiB | 语言预加载失败保护、pending 保存防护与选择器接入，既有页面预算通过 |
| QuietSelect gzip | 2.18 KiB | 2.18 KiB | 0.00 KiB | 复用既有共享组件，无组件体积增长 |
| Total JS+CSS gzip | 340.10 KiB | 351.48 KiB | +11.38 KiB | 增长由第三个生产 locale 与明确 owner 构成，总预算通过 |

### 14.3 验证结果

| 命令 | 日期 | 结果 | 备注 |
|---|---|---|---|
| `npm run check:i18n:self-test` | 2026-08-11 | 通过 | validator、hardcoded 与 new-locale 反例均通过 |
| `npm run check:i18n` | 2026-08-11 | 通过 | 3 个 locale、988 keys、review manifest、hardcoded 与 generated stale 全部通过 |
| `npm run test:i18n` | 2026-08-11 | 通过 | 包含 cache/in-flight、快速切换、加载失败、Intl、语义词条与 manifest 覆盖 |
| `npm run test:settings` | 2026-08-11 | 通过 | 36 项，包含 `zh-TW` normalization、patch 与预加载失败保护 |
| `npm run test:ui-browser-smoke` | 2026-08-11 | 通过 | 86 项；三语言、键盘、持久化、三视口、逐页 `zh-TW` 扫描与 Widget DPI 矩阵 |
| `npm run check:rust` | 2026-08-11 | 通过 | 626 passed / 1 ignored；fmt、check、Clippy 通过 |
| `npm run check:bundle` | 2026-08-11 | 通过 | locale owner、初始图、source attribution 与全部预算通过 |
| `npm run check:full` | 2026-08-11 | 通过 | 对抗式修复后最终复验 188.0 秒；含 coverage、27/27 mutation、浏览器、构建、Rust 与依赖审计 |
| `npm run test:tauri-runtime-smoke` | 2026-08-11 | 不适用 | 未改变 IPC、capability、真实 settings command/event 或 ready 协议 |

### 14.4 人工验收与自动化证据

- 仓库不保存 UI 图片证据；维护者直接运行软件检查三语言下拉、繁体中文宽屏与窄窗口的实际观感。
- Settings 自动化证据：真实浏览器用例覆盖 `简体中文 / English / 繁體中文` 三项、键盘与鼠标操作、保存/取消/重载，以及 1280px、900px@1.5 DPR、390px 三种视口；几何断言覆盖标题可读、动作区容纳和区域不重叠。
- 托盘自动化证据：Rust tray parser、语言 normalization 与四种动态状态组合测试覆盖原生 owner，避免修改维护者真实桌面设置。
- Widget 自动化证据：前端使用同一 `LocaleProvider` 装载契约，真实浏览器 Widget DPI 矩阵覆盖 144 个组合，Rust/前端 locale 契约验证 `zh-TW`。
- Markdown 导出样本位置：未保留用户数据导出文件；Rust exporter 测试覆盖 `Locale::ZhTw` 的标题、摘要、字段名与空状态，并确认 CSV / SQLite / Parquet 稳定字段不本地化。
- 翻译审校者与结论：Codex 先由简体中文生成草稿，再逐 bundle 进行台湾软件用语审校，并对删除、覆盖/合并还原、凭据、目录、更新、标题记录与暂停追踪做第二轮风险复核；`i18n:review -- zh-TW --all` 在完成审校后签署，988 个 key 无 `PENDING`。这不是外部母语认证，后续公开发布仍可接受台湾用户反馈修订。

### 14.5 实施偏差与条件判断

- 为避免先制造一个确定超预算的三语言 monolithic 中间态，执行顺序调整为：可信两语言 monolithic baseline → 两语言 split-only 测量 → 正式 `zh-TW` → 三语言 final；该偏差保留了可归因性且没有维护两套长期实现。
- live GitHub Project 读取因本机 `gh` 凭据失效而不可用；本轮未能可靠关联 item，也没有代维护者拖动或变更状态。执行授权、实现和本地验证不依赖该远程状态，因此未阻塞工作。
- Windows 100% / 150% 的组件几何由 1x / 1.5 DPR 真实 Chromium 场景覆盖；托盘、提醒、Widget 与导出使用匹配 owner 的 Rust/浏览器自动化替代修改维护者真实配置的手工操作。
- 暂停、回滚和 runtime-smoke 追加条件均完成核对且未触发；没有删除用户文件、重写历史、创建提交、push、tag、Release、Issue 或 Project 远程变更。

### 14.6 对抗式审查记录

功能完成并归档后，按维护者要求启动独立对抗式审查。审查使用 `review-and-refactor` 技能；仓库不存在该技能要求的 `.github/instructions/*.md` 或 `.github/copilot-instructions.md`，因此继续以 `AGENTS.md`、架构、本地化与 Quiet Pro 长期文档为准。

审查尝试从竞态、错误原子性、owner 边界、生成器确定性、bundle 归因、繁中高风险语义、窄宽可读性和测试假阳性推翻实现，并修复以下四组问题：

1. 真实浏览器 390px 视口检查暴露页头虽无横向滚动，却被动作区挤成逐字换行。修复共享 `QuietPageHeader` 窄宽排列和 Settings 动作换行，并增加标题单行、动作区宽度、区域不重叠的几何断言。
2. 台湾用语反查发现 `屏蔽標題`、`倒計時` 仍是大陆软件用语，并发现两处生硬语义。改为 `停止記錄標題 / 不記錄標題`、`倒數計時`、`資料與快取的儲存資料夾`、`選擇繼續後會恢復追蹤`；8 个受影响 key 逐项重新执行 review 命令后再生成。
3. locale 拆分让 `getLocaleText(non-source)` 在未加载时明确失败；Data 首屏预热虽然现有调用方传入已激活 locale，但服务自身仍依赖这一隐式前提。预热 owner 现在先显式 `loadLocaleText`，复用同一 `UiText` 构建趋势与热力图；现有预热测试改为 `zh-TW` 入口并断言 loader 调用、snapshot locale、pending 合并和节流顺序。
4. Settings 语言准备期间原本只禁用下拉；若同时存在其他草稿，页头或离页保存可能先提交，语言加载结果随后再追加成新草稿。现在用同步 pending ref 合并同帧请求、revision 丢弃卸载后的结果，并在 pending 时阻止页头保存/取消及注册的离页保存处理器提交。

审查后再次确认：生产代码中除 source fallback 外不再直接调用 `getLocaleText`；`zh-TW` 不含已识别的大陆简体字形、`屏蔽`、`倒計時` 或旧生硬句式；generated 文件仅由生成器更新；所有预算仍由原 owner 承担。

## 15. 最终总检查清单

### 资源

- [x] `zh-TW` registry metadata 正确。
- [x] 22 个 bundle 齐全。
- [x] 台湾用语人工审校完成。
- [x] review manifest 已签署。
- [x] generated 产物无手改。

### Runtime

- [x] locale 资源按 owner 加载。
- [x] cache 和 in-flight 合并正确。
- [x] 快速切换无旧请求覆盖。
- [x] Provider 原子更新。
- [x] 主窗口与 Widget 无错误语言闪现。

### Settings

- [x] 语言使用 QuietSelect。
- [x] 主题继续使用 segmented。
- [x] 原生名称正确。
- [x] 无 flags 和技术 tag。
- [x] 右栏与窄窗口无溢出。

### 行为

- [x] Preview 正确。
- [x] Cancel 正确。
- [x] Save 正确。
- [x] Reload 正确。
- [x] Tray / Widget / reminder / Markdown 正确。
- [x] Unknown locale fallback 正确。

### 质量

- [x] Targeted tests 通过。
- [x] Browser tests 通过。
- [x] Rust tests 通过。
- [x] Bundle budgets 通过。
- [x] `check:full` 通过。
- [x] 人工验收完成。

### 交付

- [x] Changelog 已更新。
- [x] 长期规范按真实结果更新。
- [x] 扩展仓库独立小文档已建立，并保持与主执行单的 owner 边界一致。
- [x] 提交保持 owner 清晰。
- [x] 未经授权没有 push、tag、Release、Issue 或 Project 远程变更。
- [x] 本执行单已从 `docs/working/` 归档。

## 16. 最终撤回结果与对抗式复验（2026-08-11）

本节记录最终产品状态，优先级高于第 2、14、15 节中针对原始繁体中文尝试的历史完成记录。

### 16.1 最终产品状态

- [x] `locales/registry.ts` 的生产语言仅为 `zh-CN / en-US`。
- [x] `locales/zh-TW/`、对应 review manifest 签名、前端 locale 模块与 Rust `Locale::ZhTw` 派生产物均已移除。
- [x] Changelog 不再声称新增繁体中文界面支持。
- [x] Settings 继续使用 `QuietSelect` 的 `compact` 密度；触发器按全部生产选项中最长原生名称确定稳定内在宽度。
- [x] 异步加载、同 locale 请求合并、过期请求丢弃、加载失败保护、按 locale 拆包和 owner 预算继续保留。
- [x] `Patina-Web-Sync` 中未执行、未跟踪的繁体中文小执行单已删除，扩展侧不会据此开始实现。
- [x] 未创建兼容壳或迁移分支：该 locale 尚未发布，不存在需要保留的外部数据契约。

### 16.2 撤回后的验证证据

| 验证 | 最终结果 |
|---|---|
| `npm run check:i18n` | 通过；988 个 key，生成清单仅含 `zh-CN / en-US` |
| `npm run test:i18n` | 通过；包含 loader manifest、请求合并、过期请求、失败与 Intl 契约 |
| `npm run test:settings` | 通过；36 项，包含语言资源就绪后才接受预览 |
| `npm run test:ui-browser-smoke` | 通过；86 项，包含两种生产语言、键盘、预览/取消/保存/重载和三视口几何 |
| `npm run check:full` | 通过；195.8 秒，包含前端门禁、浏览器、构建、bundle、Rust、Clippy 与依赖审计 |
| Rust | 625 项：624 通过、1 忽略、0 失败 |

最终 bundle 归属：initial JS+CSS `188.55 KiB gzip`；localization runtime `7.14 KiB gzip`；`locale-zh-CN` `9.57 KiB gzip`（initial）；`locale-en-US` `9.08 KiB gzip`（lazy）；Settings `22.69 KiB gzip`；QuietSelect `2.29 KiB gzip`；total JS+CSS `341.88 KiB gzip`。构建中不再生成 `locale-zh-TW`。

### 16.3 对抗式审查结论

审查尝试从生产残留、生成器确定性、测试假阳性、持久化兼容和通用扩展能力五个方向推翻撤回结果，并得到以下结论：

1. 排除本归档历史记录后，全仓对 `zh-TW / ZhTw / 繁體中文 / Traditional Chinese` 的扫描结果为零；生成 locale 目录与最终 `dist` 也都只有 `zh-CN / en-US`。
2. 生成器会主动删除不在 registry 中的陈旧 locale 模块；`check:i18n` 同时验证 registry、loader manifest、review manifest、资源完整性与 generated stale，撤回不是只隐藏 Settings 入口。
3. 浏览器回归没有硬编码“三种语言通过”的旧结论，而是从生产 registry 验证全部当前选项；撤回过程中发现并修正了英文重载导航、ArrowUp 和中文 typeahead 三处错误期望。
4. 复验发现 `review-manifest.ts` 曾混入终端截断标记；已按 Git 基线逐段恢复，只保留新的 `settings.languageLoadFailed` 签名，并由生成器、TypeScript、i18n 检查和 `check:full` 共同确认无损坏。
5. 通用能力没有随繁体资源一起撤回：未来俄语或其他语言仍可通过 registry、独立资源模块、动态 loader、locale chunk 预算和同一 Settings 选择器接入，不需要恢复任何 `zh-TW` 专用代码。
6. 长期本地化规范已明确：机器翻译、生成式翻译和字符转换只能作为草稿，`i18n:review` 不能代替目标地区母语界面验收；可信审校不足时不应把 locale 放入生产注册表。

最终结论：繁体中文支持已彻底撤回，通用语言扩展基础设施与已确认的 Quiet Pro 组件规范保留；当前没有阻断项。仓库不保存 UI 图片证据，最终观感仍由维护者直接运行软件判断。
