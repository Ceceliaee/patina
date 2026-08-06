# 前端与原生多语言文案契约执行方案

> 文档类型：操作指南（How-to Guide）  
> 当前状态：已完成并归档  
> 对应 Project item：`规范化前端与原生多语言文案系统`  
> 目标读者：Patina 维护者、负责实施与复核的 Codex  
> 文档归宿：实施期间保留在 `docs/working/`；全部验收完成后移入 `docs/archive/`

> 完成日期：2026-08-06  
> 验证结论：安全加固后的 `npm run check:full` 再次通过；真实 Tauri/WebView2 runtime smoke 通过；前端、Rust 与外部翻译包对抗式审查的阻断项均已修复，强制终止后的人工恢复边界已明确记录。  
> 构建证据：本地 release 可完成编译与 MSI/NSIS 打包，最终 updater 签名步骤因未提供 `TAURI_SIGNING_PRIVATE_KEY` 按预期停止；相较 1.9.1，EXE +0.065%、MSI +0.253%、NSIS -0.101%。  
> Git 边界：本任务未获得 stage、commit 或 push 授权，交付保留为可审查工作区变更。

## 1. 文档定位

本文是一次结构性执行单，用于把 Patina 现有的双语文案实现收口为统一、明确、可验证且能被前端与 Rust 共同消费的长期契约。

本文不是：

- 国际化概念教程；
- 第三方 i18n 框架选型清单；
- 俄语翻译稿；
- 一次性全仓库重写授权；
- 用户导入运行时语言包的设计；
- 页面布局或 Quiet Pro 视觉改版计划。

实施者应从本文顶部开始，按阶段顺序勾选。除非当前阶段明确允许，否则不得提前删除兼容层、批量迁移全部文案或引入新的运行时依赖。

长期产品、架构、质量和稳定期边界继续以以下文档为准：

- [`product-principles-and-scope.md`](../product-principles-and-scope.md)
- [`roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)
- [`engineering-quality.md`](../engineering-quality.md)
- [`architecture.md`](../architecture.md)
- [`issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)
- [`quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 2. 最终目标

完成后，仓库应满足以下总体结果：

- [x] 只存在一个 `SupportedLocale` 契约和一个受支持语言注册表。
- [x] 文案 schema 独立于 `zh-CN`、`en-US` 或其他具体语言实现。
- [x] 每种语言的资源都是纯声明式、可序列化、可静态分析的数据。
- [x] 不允许语言资源包含任意 TypeScript 函数、条件表达式或跨语言继承。
- [x] 静态消息、参数插值、业务语义分支和 CLDR 基数复数都有明确 schema。
- [x] 前端与 Rust 从同一份仓库级契约生成各自的类型化产物。
- [x] React 通过显式 Provider/hook 获取 locale 与文案，不依赖可变全局 Proxy。
- [x] 纯函数、服务和派生模型显式接收 locale 或 localizer 依赖。
- [x] 已本地化缓存明确包含 locale；更优先的做法是只缓存语言无关数据。
- [x] 系统托盘、原生提醒和语言相关 Markdown 导出不再维护独立中英文常量表。
- [x] 稳定协议字段、导入字段、识别规则、程序名和测试数据不会被错误本地化。
- [x] 原文语义变化会让对应翻译进入待复核状态，并在检查链中失败。
- [x] 新增现有契约能够表达的内置语言时，只需生成并填写该 locale 的资源目录。
- [x] 不发布的 `ru-RU` fixture 能证明前端、Rust 和检查器的 CLDR 复数结果一致。
- [x] 现有中英文页面、格式化结果、无障碍标签和原生表面不回归。

## 3. 第一性原理与不变量

### 3.1 文案是产品行为

文案决定用户如何理解追踪状态、数据删除、恢复、导出、设置和提醒。它不是可以在组件里随手补充的装饰字符串。

- [x] 每条用户可见文案必须有稳定 message key。
- [x] 每条文案必须有明确 owner 和使用表面。
- [x] 会影响数据安全、删除、恢复或追踪理解的文案必须有专项回归测试。
- [x] 无障碍名称、描述和状态播报与视觉文案同等受契约约束。

### 3.2 locale 是显式运行时输入

同一组业务数据在不同 locale 下可以产生不同显示结果。因此 locale 不能是纯函数和缓存看不见的隐藏全局变量。

- [x] React 上下文必须显式持有当前 locale。
- [x] 非 React 代码必须显式接收 `locale` 或 `Localizer`。
- [x] 缓存本地化结果时，locale 必须进入 cache key。
- [x] 语言切换后，不允许继续显示由旧 locale 生成的派生字符串。

### 3.3 schema 不属于任何一种语言

中文可以是标准原文，但不能同时充当类型系统。

- [x] schema 只定义 key、参数、消息种类、业务分支和目标表面。
- [x] `zh-CN` 只提供 source text，不定义其他语言的对象形状。
- [x] `en-US`、未来 `ru-RU` 和其他语言不能从 `zh-CN` 展开继承。
- [x] schema 变化与标准原文变化必须能被分别识别。

### 3.4 业务分支和语言语法分支不同

业务分支表达产品状态，所有语言必须具有相同语义集合；语言语法分支表达自然语言规则，各 locale 可以不同。

业务分支示例：

```text
active / paused
enabled / disabled
increase / decrease / same
app / web
```

语言语法分支示例：

```text
zh-CN: other
en-US: one / other
ru-RU: one / few / many / other
```

- [x] 检查器要求业务分支跨语言一致。
- [x] 检查器按 CLDR 要求验证每个 locale 的复数类别。
- [x] 不允许在翻译资源中写 `count === 1`、`locale === "ru-RU"` 等判断。
- [x] 不允许在业务代码中手写俄语或其他语言的复数算法。

### 3.5 前端与 Rust 共享语义，不复制实现

同一 message key、参数和 locale 在前端与 Rust 必须得到相同的选择结果。两端可以使用不同语言实现，但不能各维护一份业务规则或翻译表。

- [x] 仓库级资源是唯一人工编辑源。
- [x] 前端 bundle 与 Rust 静态模块由同一生成器输入产生。
- [x] 生成产物带有明确的 generated header。
- [x] CI 检查生成产物是否与源资源一致。
- [x] 人工修改生成产物必须失败或被审查明确拒绝。

### 3.6 失败优先在构建阶段暴露

生产包中缺 key、参数错位或复数类别不完整，不应等到用户打开页面才发现。

- [x] 已注册生产 locale 缺失 key 时检查失败。
- [x] 已注册生产 locale 多出未知 key 时检查失败。
- [x] 参数名称、参数类型或业务分支不一致时检查失败。
- [x] locale 必需复数类别缺失时检查失败。
- [x] 标准原文变化但翻译未复核时检查失败。
- [x] native-required key 未生成 Rust 产物时检查失败。

### 3.7 稳定协议不得被翻译

本地化只改变用户显示，不改变数据身份或交换协议。

- [x] CSV、SQLite、Parquet 稳定字段名保持不变。
- [x] 导入格式字段、识别关键词和应用可执行文件名保持不变。
- [x] 分类稳定 ID、Tauri command、event、SQLite key 和错误码保持不变。
- [x] Markdown 用户标题、字段显示标签和说明可以本地化。
- [x] 品牌名、协议缩写和格式标签按例外策略处理，不机械翻译。

### 3.8 内置资源是可信文本，不是可执行内容

本项不支持用户导入语言包，因此不需要运行不受信任的翻译代码。

- [x] locale 资源禁止函数和任意表达式。
- [x] 参数默认按纯文本处理。
- [x] 第一版不允许翻译资源注入 HTML、React 节点或任意富文本标签。
- [x] 第一版不引入在线翻译、AI 翻译或云端资源加载。

## 4. 当前实现基线

### 4.1 前端资源

当前主要资源位于 [`src/shared/copy/domains/`](../../src/shared/copy/domains/)，包括 `about`、`accessibility`、`app`、`backup`、`categories`、`common`、`dashboard`、`data`、`dateTime`、`destination`、`dialog`、`export`、`history`、`mapping`、`settings`、`toast`、`tools`、`update` 和 `widget` 等领域。

现有模式：

- 每个文件同时维护中英文；
- 英文部分有时通过展开中文对象获得默认值；
- 动态文案使用任意 TypeScript 函数；
- [`bundle.ts`](../../src/shared/copy/bundle.ts) 按语言合并全部领域；
- [`types.ts`](../../src/shared/copy/types.ts) 从 `ZH_CN_UI_TEXT` 推导 `UiText`；
- [`runtime.ts`](../../src/shared/copy/runtime.ts) 使用可变 `activeUiLanguage` 与 `UI_TEXT` Proxy。

基线盘点任务：

- [x] 记录全部领域文件及其 owner。
- [x] 记录全部静态字符串 key。
- [x] 记录全部动态函数 key、参数和返回分支。
- [x] 记录英文展开中文对象的位置。
- [x] 记录 `UI_TEXT` 的所有生产调用方。
- [x] 记录 `getUiText()` 的显式调用方。
- [x] 记录语言相关硬编码和明确例外。
- [x] 把盘点结果保存为生成器可消费的临时迁移 manifest，而不是长期手工清单。

### 4.2 语言状态

当前设置层在 [`appSettings.ts`](../../src/shared/settings/appSettings.ts) 定义 `AppLanguage`，copy 层另行定义 `UiLanguage`。[`AppShell.tsx`](../../src/app/AppShell.tsx) 同时处理已保存语言、设置页预览语言、显式 `uiText` 和全局 Proxy 同步。

- [x] 记录所有 `AppLanguage` 引用。
- [x] 记录所有 `UiLanguage` 引用。
- [x] 记录设置加载、预览、保存、回退和事件同步时序。
- [x] 记录未知语言当前回退到 `zh-CN` 的所有前端与 Rust 路径。
- [x] 记录语言变化会主动清理或被动失效的缓存。

### 4.3 数量型和格式化文案

已知高风险领域包括：

- `backup`：会话、设置、图标和导入数量；
- `data`：对象数、天数、周和年份；
- `destination`：小时、分钟、片段数；
- `export`：记录数和字段数；
- `history`：记录数、活动片段和标题数量；
- `settings`：导入记录、行号、批次和分钟；
- `tools`：分钟、计次、番茄和完成数量；
- `dateTime`：月份和年月格式化。

- [x] 将纯数字插值与真正需要复数选择的消息分开。
- [x] 将基数数量与序数/编号分开。
- [x] 将日期、时间、数字和 duration 格式化从翻译文本拼接中分离。
- [x] 标记当前英文 `count === 1` 手写逻辑。
- [x] 标记当前固定使用复数名词但可能接收 `1` 的消息。
- [x] 标记传入预格式化字符串、导致 localizer 无法掌握数值语义的调用方。

### 4.4 Rust 原生表面

已知独立维护点包括：

- [`app/tray.rs`](../../src-tauri/src/app/tray.rs) 中的 `TrayLanguage`、中英文常量和菜单重建；
- [`data/export/common.rs`](../../src-tauri/src/data/export/common.rs) 中的语言读取和分类显示名；
- [`data/export/markdown_exporter.rs`](../../src-tauri/src/data/export/markdown_exporter.rs) 中的 `if chinese` 文案分支；
- Tools 到期提醒及其他原生通知路径；
- 挂件运行时设置快照中的语言值。

- [x] 盘点所有 Rust 用户可见常量和格式化字符串。
- [x] 区分错误诊断文本与真正用户文案。
- [x] 区分稳定导出字段和本地化 Markdown 显示文本。
- [x] 确认 Tools 到期提醒最终由前端弹窗、Rust 原生通知或两者中的哪一层呈现。
- [x] 为每个原生表面标记 locale 来源、更新时间点和失败回退。

### 4.5 当前测试

当前测试能比较中英文 key 路径、验证部分语言切换和原生托盘行为，但没有独立 schema、复数类别门禁、翻译复核哈希或双端格式化一致性测试。

- [x] 记录现有 copy 相关测试及其真实保障范围。
- [x] 识别只匹配源码文本、没有验证运行时行为的 smoke 断言。
- [x] 识别依赖全局 `setUiTextLanguage()` 且可能发生测试间污染的用例。
- [x] 在迁移前固定现有中英文关键输出快照。

## 5. 目标架构与 owner

### 5.1 仓库级 locale 资源

建议将唯一人工编辑源放在仓库级 `locales/` 目录，使其不从属于前端或 Rust 任一实现：

```text
locales/
  registry.ts
  schema/
    common.ts
    accessibility.ts
    dashboard.ts
    history.ts
    data.ts
    destination.ts
    settings.ts
    backup.ts
    export.ts
    tools.ts
    update.ts
    widget.ts
  zh-CN/
    common.ts
    ...
  en-US/
    common.ts
    ...
```

正式创建前必须完成以下 owner 决策：

- [x] 确认 `locales/` 是仓库级构建资源区，不是新的应用代码根层。
- [x] 在 [`architecture.md`](../architecture.md) 中记录这一长期边界。
- [x] 确认 locale 资源只允许被生成器读取，不允许页面跨层直接导入。
- [x] 确认领域拆分继续按真实 copy owner，而不是堆入单个大文件。
- [x] 确认 canonical resource 不放入 `shared/*` 临时桶。

如果维护者否决仓库级 `locales/`，必须先给出另一个同时满足“前端与 Rust 中立、唯一人工编辑源、可生成”的 owner；不得直接把资源继续留在 `src/shared/copy` 并宣称已经跨端统一。

### 5.2 前端 owner

稳定的跨 feature 本地化运行时属于共享能力，建议归 `src/shared/i18n/`：

```text
src/shared/i18n/
  LocaleProvider.tsx
  useLocaleText.ts
  localizer.ts
  pluralRules.ts
  types.ts
  generated/
```

- [x] `shared/i18n` 不读取 SQLite 或 Tauri。
- [x] `shared/i18n` 不拥有设置保存流程。
- [x] `shared/i18n` 只接收已解析的 `SupportedLocale`。
- [x] `app/*` 只负责把应用级语言状态注入 Provider。
- [x] feature 继续拥有自己的业务枚举和调用时参数。

### 5.3 Rust owner

Rust 需要一个能同时被 `app/tray` 与 `data/export` 使用的纯本地化语义 owner。建议先评估 `domain/localization/`：

```text
src-tauri/src/domain/localization/
  mod.rs
  locale.rs
  message.rs
  plural.rs
  generated.rs
```

该建议必须通过边界复核后才能实施：

- [x] 证明该模块只包含纯 locale、message、参数与选择语义。
- [x] 不在 `domain/localization` 读取数据库、Tauri state 或 Windows API。
- [x] `app/tray` 继续拥有托盘状态和菜单重建时序。
- [x] `data/export` 继续拥有 Markdown 格式，不把导出流程迁入 localization。
- [x] `commands/*` 不承接翻译选择或资源加载逻辑。
- [x] `lib.rs` 只注册模块，不承接本地化实现。
- [x] 如果 `domain/localization` 与长期架构语义冲突，先更新 owner 决策，不新建 `src-tauri/src/localization` 根层。

### 5.4 工具链 owner

生成器和检查器建议归 `scripts/i18n/`：

```text
scripts/i18n/
  model.ts
  parse-schema.ts
  parse-locale.ts
  validate.ts
  generate-frontend.ts
  generate-rust.ts
  hash-source.ts
  new-locale.ts
  self-test.ts
```

- [x] 脚本复用仓库现有 TypeScript 工具链。
- [x] 不为了 AST 解析引入第二套 TypeScript parser。
- [x] 生成器与检查器共享一个解析模型，避免规则漂移。
- [x] 自测使用临时 fixture，不读取或污染真实 locale 资源。

## 6. 语言注册表

### 6.1 最小字段

注册表至少需要：

```ts
type LocaleRegistration = {
  tag: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  production: boolean;
};
```

第一版生产注册表只包含：

```text
zh-CN
en-US
```

`ru-RU` 只存在于测试 fixture，不能进入生产注册表或设置 UI。

- [x] locale tag 使用规范 BCP 47 连字符形式。
- [x] 注册表拒绝重复或无法规范化的 tag。
- [x] `nativeName` 用于语言选择器自称，不依赖当前界面语言。
- [x] 第一版保留 `direction` 字段，但不承诺本项完成 RTL UI。
- [x] `production` 或等价隔离机制确保 fixture 不进入生产 bundle。
- [x] 默认 locale 明确为现有发布默认值，不从对象顺序推断。

### 6.2 唯一类型生成

- [x] 从生产注册表生成前端 `SupportedLocale` union。
- [x] 从同一注册表生成 Rust `SupportedLocale` enum 或等价类型。
- [x] 删除手写 `AppLanguage` 与 `UiLanguage` 的平行定义。
- [x] 设置模型、Provider、缓存和 IPC 使用同一个前端类型。
- [x] Rust 对未知持久化值采用显式 fallback，并记录可诊断信息。
- [x] 未经用户操作不静默重写未知持久化原值，除非另有数据迁移决策。

## 7. 语言无关 message schema

### 7.1 基本结构

建议的语义模型：

```ts
type MessageSchema = {
  params: Record<string, "string" | "integer" | "number" | "date" | "time">;
  selection?:
    | { kind: "business"; parameter: string; variants: readonly string[] }
    | { kind: "cardinalPlural"; parameter: string };
  surfaces: readonly ("frontend" | "native")[];
  description: string;
  meaningVersion: number;
};
```

- [x] `description` 说明上下文，不复制翻译。
- [x] `meaningVersion` 只在语义改变但标准原文字面不足以表达变化时递增。
- [x] `surfaces` 决定是否生成 Rust message API。
- [x] native-only、frontend-only 和跨端消息都必须被验证。
- [x] 参数名称采用稳定语义名，不使用 `value1`、`arg` 等弱名称。

### 7.2 消息种类

第一版只允许以下种类：

1. 静态消息；
2. 参数插值消息；
3. 业务枚举选择；
4. CLDR 基数复数选择。

- [x] 不在第一版支持任意表达式。
- [x] 不在第一版支持翻译资源内的日期计算。
- [x] 不在第一版支持 HTML 或 React rich text。
- [x] 不在第一版支持用户定义 formatter。
- [x] 不把数组拼接、排序或业务过滤塞入 localizer。

### 7.3 参数类型

- [x] `integer` 用于记录数、对象数、片段数和其他离散计数。
- [x] `number` 用于可能包含小数的数值。
- [x] `date`、`time` 接收标准时间值，不接收预翻译的月份名。
- [x] 已格式化的领域 label 只能作为 `string` 参数，并记录 owner。
- [x] 可选参数必须在 schema 中显式声明，不用 `undefined` 隐式改变句子。
- [x] 可选句子变化优先转换为业务分支。

### 7.4 业务选择

示例：

```ts
"dashboard.comparedWithYesterday": {
  params: {
    delta: "string",
    direction: "string",
  },
  selection: {
    kind: "business",
    parameter: "direction",
    variants: ["increase", "decrease", "same"],
  },
}
```

- [x] 每种生产语言必须实现全部业务 variants。
- [x] 不允许 locale 增删业务状态。
- [x] 调用方通过类型化参数传递 variant。
- [x] 检查器拒绝遗漏、拼写错误和额外 variant。

### 7.5 CLDR 基数复数

示例资源：

```ts
// zh-CN
"history.sessionCount": {
  plural: "count",
  other: "{count} 条记录",
}

// en-US
"history.sessionCount": {
  plural: "count",
  one: "{count} record",
  other: "{count} records",
}

// ru-RU test fixture
"history.sessionCount": {
  plural: "count",
  one: "{count} запись",
  few: "{count} записи",
  many: "{count} записей",
  other: "{count} записи",
}
```

- [x] 第一版基数复数 selector 只接收非负整数计数。
- [x] 如果调用方可能传入负数或小数，先明确产品语义再扩展 operands。
- [x] `other` 对所有 locale 必需。
- [x] 其他必需类别由 CLDR locale 规则决定。
- [x] 检查器拒绝对当前 locale 不可达的多余类别，除非规范明确允许兼容类别。
- [x] 资源不包含 `count === 1` 或俄语取模公式。

## 8. 纯声明式 TypeScript 资源约束

### 8.1 允许语法

- [x] 字符串、数字、布尔值和 `null` 字面量。
- [x] 对象和数组字面量。
- [x] `as const`。
- [x] 单次顶层 `defineLocale(locale, resource)` identity helper。
- [x] 从受控类型模块进行 `import type`。

### 8.2 禁止语法

- [x] 函数、箭头函数和 class。
- [x] 条件表达式、逻辑短路表达式和 switch。
- [x] 模板字符串中的 JavaScript 表达式。
- [x] 对另一种语言资源的 import。
- [x] 对象 spread，包括从标准原文继承。
- [x] 运行时 I/O、环境变量和网络读取。
- [x] `Date`、`Intl` 或自定义 formatter 的直接调用。
- [x] HTML、JSX 和 React 节点。
- [x] 动态 key 和计算属性名。

### 8.3 最小模板规则

允许的字符串模板只支持命名参数，例如：

```text
已导出 {count} 条记录
Exported {count} records
```

- [x] 占位符必须对应 schema 参数。
- [x] 每个 schema 必需参数必须被正确使用，除非该 variant 明确不需要。
- [x] 不支持占位符内表达式。
- [x] 不支持隐式位置参数。
- [x] 定义 `{`、`}` 和反斜杠的转义规则并加入自测。
- [x] 解析后生成中间 AST，不在运行时重复解析模板。

## 9. 标准原文与翻译复核

### 9.1 source locale

- [x] 明确 `zh-CN` 为当前标准原文 locale。
- [x] source locale 地位不影响 schema 的语言独立性。
- [x] source locale 也必须通过参数和分支验证。
- [x] 修改 source text 必须触发 hash 更新。

### 9.2 source hash

每条翻译的复核 hash 至少覆盖：

- message key；
- schema 参数名称和类型；
- selection kind 和业务 variants；
- 标准原文各 variant；
- `description`；
- `meaningVersion`。

- [x] 定义稳定规范化序列化，禁止对象遍历顺序导致随机 hash。
- [x] 使用仓库已有 `sha2`/Node crypto 等标准哈希能力，不自创算法。
- [x] hash 由工具生成，不要求翻译者手写。
- [x] source 变化后非 source locale 默认进入 `needsReview`。
- [x] 翻译者完成复核后由明确命令刷新 review hash。
- [x] 直接手改 review hash 不能绕过文案差异审查。

### 9.3 review manifest

建议 review 状态与翻译文本分开，避免污染资源形状：

```text
locales/en-US/review.json
```

正式采用前需比较：

- [x] 单一 locale review manifest；
- [x] 每领域 review manifest；
- [x] 生成目录中的集中 manifest。

选择标准：可审计、合并冲突小、生成稳定、不会形成第二份 key 真相源。

## 10. 前端运行时

### 10.1 LocaleProvider

- [x] 在应用根部加入唯一 `LocaleProvider`。
- [x] Provider 接收 `SupportedLocale` 和生成的 frontend bundle。
- [x] Provider 暴露 `locale`、`t` 和标准 formatter。
- [x] 设置页预览通过 Provider 输入完成，不直接写全局模块变量。
- [x] 预览取消后恢复持久语言。
- [x] 设置提交失败时不让预览值变成持久事实。

### 10.2 类型化调用

目标形状：

```ts
t("export.done", { count })
```

- [x] 无参数 key 不允许传入无关参数。
- [x] 有参数 key 缺少参数时 TypeScript 失败。
- [x] 业务 variant 使用生成的 literal union。
- [x] 基数复数参数必须是 integer 语义。
- [x] 返回类型第一版固定为 `string`。

### 10.3 显式服务依赖

- [x] React 组件使用 hook。
- [x] React hook 内部可以使用 hook 提供的 localizer。
- [x] 纯 service/read model 接收 `Localizer` 或 locale，不导入 Provider。
- [x] 平台 gateway 不生成用户文案，只返回稳定事实和错误码。
- [x] app shell 不成为文案拼接中心。

### 10.4 格式化 API

- [x] `Intl.NumberFormat(locale)` 负责数字显示。
- [x] `Intl.DateTimeFormat(locale)` 负责日期时间显示。
- [x] `Intl.PluralRules(locale, { type: "cardinal" })` 负责前端基数复数类别。
- [x] 统一 formatter cache 以 locale 和 options 为 key。
- [x] 语言切换后 formatter cache 不返回旧 locale 实例。
- [x] 移除 `toLocaleString(undefined)` 等跟随系统而非应用语言的用户可见路径，除非有明确例外。

## 11. Rust 运行时

### 11.1 locale 解析

- [x] Rust `SupportedLocale` 由注册表生成。
- [x] SQLite repository 继续保留原始字符串读取职责。
- [x] locale 归一与 fallback 归纯 localization 边界。
- [x] 托盘 locale state 保存已解析类型，不保存任意字符串。
- [x] 导出在一次操作开始时固定 locale snapshot，避免中途切换混合语言。

### 11.2 CLDR 复数实现

首选验证 ICU4X 最小依赖，而不是完整 Fluent 或手写俄语规则。

- [x] 记录当前 `rustc --version` 和 Cargo 基线。
- [x] 评估直接依赖 `icu_plurals` 与所需 locale/data crate。
- [x] 避免无依据引入完整 `icu` meta crate。
- [x] 使用 compiled data 或明确 provider，禁止运行时网络数据。
- [x] 测量新增依赖的编译时间、release 二进制和安装包体积。
- [x] 通过 `cargo tree` 记录新增依赖边界。
- [x] 如果成本不合格，评估由 Unicode CLDR 数据生成受支持 locale 最小规则；不得回退为人工俄语公式。

依赖决策门：

- [x] 前端与 Rust 的 `zh-CN`、`en-US`、`ru-RU` fixture 类别一致。
- [x] release bundle 和安装包增长可归因且在现有预算内。
- [x] 编译时间增长有记录并可接受。
- [x] 依赖许可证与仓库政策兼容。
- [x] `npm run check:dependencies` 通过。

### 11.3 生成的 native API

目标不是字符串 key 到处流动，而是类型化 native message：

```rust
NativeMessage::HistorySessionCount { count }
```

- [x] native message enum/struct 由 schema 生成。
- [x] Rust 调用方不能请求 frontend-only key。
- [x] 参数类型由 schema 映射。
- [x] generated formatter 不包含业务状态判断。
- [x] 格式化错误有稳定诊断并安全回退到 source locale。

## 12. 缓存与派生模型规则

### 12.1 优先缓存语言无关数据

- [x] Dashboard、History、Data 的基础 snapshot 不存用户可见翻译。
- [x] 应用名、域名、用户自定义分类名等真实数据不被误当翻译。
- [x] 组件或 view model 在消费阶段本地化。
- [x] 持久化 bootstrap cache 中若含本地化显示值，先迁回语言无关表示。

### 12.2 必须缓存本地化结果时

- [x] cache key 包含 `locale`。
- [x] cache value 记录 schema/generator revision，必要时避免旧结构复用。
- [x] 语言切换不依赖注释提醒清缓存。
- [x] 测试覆盖 `zh-CN -> en-US -> zh-CN` 往返切换。
- [x] 测试覆盖设置页未保存预览与取消。

## 13. 迁移兼容策略

### 13.1 兼容层职责

允许短期保留 [`src/shared/copy/`](../../src/shared/copy/) 入口，但它只能：

- 从生成 bundle 转发旧属性；
- 为尚未迁移调用方提供旧函数形状；
- 记录迁移覆盖率；
- 不新增新 key 或新业务逻辑。

- [x] 给兼容层添加显式 deprecated 标记。
- [x] 禁止新生产代码导入 `UI_TEXT`。
- [x] 兼容层不再拥有语言状态。
- [x] 兼容层不得从 `ZH_CN_UI_TEXT` 推导类型。

### 13.2 退出条件

只有全部满足时才能删除：

- [x] 生产代码没有 `UI_TEXT` 导入。
- [x] 生产代码没有 `setUiTextLanguage()` 调用。
- [x] 所有动态函数已迁移为 schema message。
- [x] 所有测试改用 Provider、显式 localizer 或生成 bundle。
- [x] 缓存不再依赖全局语言变量。
- [x] Rust 原生表面已切换到生成资源。
- [x] 边界检查禁止重新引入旧入口。

## 14. 分阶段执行计划

### 阶段 0：冻结基线

目标：在改变资源模型前固定当前行为与风险清单。

- [x] 记录 `git status --short`，确认并保留用户现有改动。
- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check`，记录既有失败，禁止把既有失败误归本项。
- [x] 运行 `npm run check:rust`，记录 Rust 基线。
- [x] 记录生产构建 bundle 体积。
- [x] 记录 release Rust 二进制或 Tauri 安装包体积基线。
- [x] 生成前端 copy key、动态函数、硬编码和调用方盘点。
- [x] 生成 Rust 用户文案和 locale 来源盘点。
- [x] 建立关键中英文输出 fixture。

完成证据：

- [x] 基线命令及结果可重复。
- [x] 所有当前文案均进入迁移 manifest 或明确例外。
- [x] 没有开始修改资源格式。

### 阶段 1：锁定 owner 与最小纵向原型

目标：用一条前端静态文案、一条前端复数文案、一条托盘文案和一条 Markdown 文案验证完整方向。

建议原型：

- 前端静态：`common.confirm`；
- 前端复数：`history.sessionCount`；
- Rust 托盘：打开主界面；
- Rust 导出：Markdown 标题。

- [x] 确认仓库级 locale 资源 owner。
- [x] 确认前端 `shared/i18n` owner。
- [x] 确认 Rust `domain/localization` 或替代 owner。
- [x] 更新长期架构文档中的新稳定边界。
- [x] 创建最小 schema 和 `zh-CN`、`en-US` 资源。
- [x] 创建不注册的 `ru-RU` 复数 fixture。
- [x] 生成最小前端 bundle。
- [x] 生成最小 Rust module。
- [x] 在不删除现有路径的情况下验证输出。

禁止继续条件：

- [x] Rust owner 需要反向依赖 `app/*`。
- [x] Cargo 独立检查依赖未生成临时文件才能运行。
- [x] 生成产物需要开发者手工同步 key。
- [x] 复数结果无法在双端一致复现。

### 阶段 2：实现 schema、注册表和 AST 约束

- [x] 实现 registry parser。
- [x] 实现 schema parser。
- [x] 实现 locale resource parser。
- [x] 实现允许语法白名单。
- [x] 实现禁止函数、spread、跨语言 import 的检查。
- [x] 实现重复 key 检查。
- [x] 实现领域文件归属检查。
- [x] 实现参数、业务分支和 surface 检查。
- [x] 实现 fixture 与 production registry 隔离。
- [x] 为每条规则编写一个成功 fixture 和一个失败 fixture。

完成证据：

- [x] 检查器不依赖具体中文对象推导 schema。
- [x] 恶意或意外可执行资源无法通过检查。
- [x] self-test 能证明每个错误分支确实失败。

### 阶段 3：实现模板、哈希和生成器

- [x] 实现命名占位符 parser。
- [x] 实现转义规则。
- [x] 实现稳定 message AST。
- [x] 实现 source hash。
- [x] 实现 review manifest。
- [x] 实现 frontend type generation。
- [x] 实现 frontend bundle generation。
- [x] 实现 Rust locale/message generation。
- [x] 实现 stale generated output 检查。
- [x] 实现 `npm run check:i18n`。
- [x] 实现 `npm run check:i18n:self-test`。
- [x] 把两者接入 `npm run check` 可达链路。

生成确定性：

- [x] 同一输入连续生成两次无 diff。
- [x] Windows 路径和换行不影响 hash。
- [x] 对象顺序规范化。
- [x] 生成文件使用 UTF-8、仓库换行策略和稳定排序。

### 阶段 4：前端 Provider 与显式依赖

- [x] 实现 `LocaleProvider`。
- [x] 实现 `useLocaleText()`。
- [x] 实现类型化 `t()`。
- [x] 实现 `Intl.NumberFormat` cache。
- [x] 实现 `Intl.DateTimeFormat` cache。
- [x] 实现 `Intl.PluralRules` cache。
- [x] 将 AppShell 的 locale 选择注入 Provider。
- [x] 保留设置页预览、取消和保存语义。
- [x] 移除 AppShell 中仅为强制刷新 Proxy 的同步 state。
- [x] 添加 provider 缺失时的开发期明确错误。

验证：

- [x] 主界面初始中文正确。
- [x] 持久英文启动正确。
- [x] 设置页预览即时更新。
- [x] 取消预览恢复旧语言。
- [x] 保存后重开仍保持语言。
- [x] 快速往返切换不残留旧语言。

### 阶段 5：CLDR 复数双端能力

- [x] 前端使用 `Intl.PluralRules`。
- [x] Rust 完成 ICU4X 最小依赖 spike。
- [x] Rust localizer 返回 CLDR cardinal category。
- [x] schema validator 查询 locale 必需类别。
- [x] `ru-RU` fixture 不进入生产 bundle。
- [x] 覆盖 `1 / 2 / 5 / 11 / 21 / 22 / 25`。
- [x] 覆盖 `0`。
- [x] 明确第一版对负数和小数的处理。
- [x] 前端、Rust、检查器结果逐值一致。
- [x] 不允许测试直接复制期望算法到两个实现中制造伪一致。

俄语预期类别：

| 输入 | 预期类别 |
| ---: | --- |
| 0 | `many` |
| 1 | `one` |
| 2 | `few` |
| 5 | `many` |
| 11 | `many` |
| 21 | `one` |
| 22 | `few` |
| 25 | `many` |

### 阶段 6：迁移 Rust 托盘

- [x] 将托盘 key 登记为 native-required。
- [x] 生成托盘 message 类型和资源。
- [x] 删除手写 `TRAY_MENU_*_ZH_CN/EN_US` 常量。
- [x] 删除托盘私有 `TrayLanguage`，改用统一 Rust locale 类型。
- [x] 启动时读取并解析 language setting。
- [x] settings commit 成功后才应用新 locale。
- [x] 语言、暂停状态和标题状态变化仍完整重建菜单。
- [x] locale 更新失败时保留最后可用菜单并记录诊断。
- [x] 托盘测试覆盖中英文、未知值和同批 mutation last-wins。

### 阶段 7：迁移 Rust 导出与原生提醒

- [x] 区分机器稳定字段与 Markdown 显示标签。
- [x] 将 Markdown 标题、摘要、空状态和字段 label 登记为 native-required。
- [x] 删除 `let chinese = ...` 总开关和散落 `if chinese` 文案。
- [x] 导出开始时固定 locale snapshot。
- [x] 分类稳定 ID 保持不变，seeded display label 使用 localizer。
- [x] CSV/SQLite/Parquet schema 不随语言变化。
- [x] 盘点并迁移 Tools 原生提醒文案。
- [x] 验证提醒触发时采用当前应用语言，而不是创建规则时的旧语言。
- [x] 验证无前端窗口时原生表面仍能本地化。

### 阶段 8：按领域迁移前端资源

每个领域遵循同一模板：

- [x] 建立 schema。
- [x] 移入 `zh-CN` source resource。
- [x] 移入并补全 `en-US` resource。
- [x] 删除跨语言 spread。
- [x] 把动态函数转成静态、插值、业务选择或复数消息。
- [x] 迁移组件调用方。
- [x] 迁移 service/read model 调用方。
- [x] 添加领域专项测试。
- [x] 禁止该领域新增旧 `UI_TEXT` 使用。
- [x] 从旧 bundle 删除已完成 owner。

建议批次：

#### 批次 A：低风险共享静态资源

- [x] `common`
- [x] `app`
- [x] `dialog`
- [x] `about`
- [x] `categories`

#### 批次 B：导航、无障碍和日期时间

- [x] `accessibility`
- [x] `dateTime`
- [x] `widget`

日期时间批次必须先确认 formatter owner，不能把 `Date` 调用搬进 locale 资源。

#### 批次 C：核心回看页面

- [x] `dashboard`
- [x] `history`
- [x] `data`
- [x] `destination`

该批次重点验证语言切换、read model、缓存和数量复数。

#### 批次 D：设置与数据安全

- [x] `settings`
- [x] `backup`
- [x] `export`
- [x] `toast`
- [x] `update`

该批次重点验证删除、恢复、导入、导出和错误提示语义不变。

#### 批次 E：分类与工具

- [x] `mapping`
- [x] `tools`

该批次重点验证业务 variants、提醒、分钟和番茄数量。

### 阶段 9：缓存与派生模型收口

- [x] 列出所有包含本地化字符串的 cache。
- [x] 能迁移为语言无关数据的全部迁移。
- [x] 其余 cache key 加入 locale。
- [x] 删除手动清理说明和依赖调用顺序的注释。
- [x] 为 Data、History、Dashboard、Tools 分别添加语言往返测试。
- [x] 验证 lazy-loaded 页面首次打开使用当前语言。
- [x] 验证预热和持久 bootstrap snapshot 不恢复旧语言。

### 阶段 10：硬编码门禁与例外登记

TypeScript/TSX：

- [x] 使用 TypeScript AST 检查 JSXText 用户文案。
- [x] 检查 `aria-label`、`aria-description`、`placeholder`、`title` 等字符串属性。
- [x] 检查 toast、dialog、notification 等受控 API 的字符串参数。
- [x] 不把日志、错误码和测试 fixture 自动当作 UI 文案。

Rust：

- [x] 通过类型化 native message API 收口托盘、提醒和 Markdown 文案。
- [x] 为高风险原生调用点建立受控入口检查。
- [x] 不以全仓库中文/英文正则替代 owner 判断。
- [x] 记录暂时无法自动判断的人工审计范围。

例外登记至少包含：

- [x] 字面值或匹配规则；
- [x] 文件/表面范围；
- [x] 不本地化原因；
- [x] owner；
- [x] 是否需要复核日期或退出条件。

初始例外候选：

- `Patina`；
- `GitHub`；
- `CSV`、`SQLite`、`Parquet`、`Markdown`；
- `HEX`、`RGB`、`HSL`；
- 稳定协议字段与格式示例；
- 真实应用名、域名和可执行文件名；
- 测试数据和识别规则。

### 阶段 11：删除兼容层

- [x] `rg` 确认生产代码没有 `UI_TEXT`。
- [x] `rg` 确认生产代码没有 `getUiTextLanguage()`/`getUiLocale()` 隐式读取。
- [x] 删除 `activeUiLanguage`。
- [x] 删除 `UI_TEXT` Proxy。
- [x] 删除 `WidenCopyValue<typeof ZH_CN_UI_TEXT>`。
- [x] 删除旧 `COPY` 手工 bundle。
- [x] 删除 `AppLanguage`/`UiLanguage` 重复类型。
- [x] 删除旧 domain copy 文件或把仍需保留的兼容入口变成纯转发。
- [x] 增加边界检查，禁止重新引入已退出入口。
- [x] 运行全部迁移清单，确认无遗漏 owner。

### 阶段 12：新语言生成工作流

目标命令：

```bash
npm run i18n:new -- ru-RU
```

本项只实现和测试生成能力，不把 `ru-RU` 加入生产注册表。

- [x] 验证 BCP 47 locale tag。
- [x] 拒绝已存在 locale。
- [x] 按领域创建完整资源目录。
- [x] 生成 source text 参考或明确 TODO 占位。
- [x] 标记所有条目待翻译/待复核。
- [x] 生成 locale metadata 模板。
- [x] 不修改组件、Rust 业务代码或手工类型 union。
- [x] 未完成翻译不能误进入生产 bundle。
- [x] dry-run 能显示将创建的文件与 key 数量。
- [x] 部分失败不会留下半生成 locale。

### 阶段 13：CI、贡献文档与最终验收

- [x] `check:i18n:self-test` 接入主检查链。
- [x] `check:i18n` 接入主检查链。
- [x] generated stale check 接入主检查链。
- [x] 边界检查禁止旧 copy 主路径回流。
- [x] 更新长期架构文档。
- [x] 编写长期本地化贡献文档。
- [x] 贡献文档说明新增 key、修改 source、复核翻译和新增 locale。
- [x] 贡献文档说明 native-required 表面。
- [x] 贡献文档说明 CLDR 复数类别和 `ru-RU` 示例。
- [x] 贡献文档说明哪些内容不能本地化。
- [x] 将本文所有验收项逐条关闭。

## 15. 测试矩阵

### 15.1 schema 与资源检查器

- [x] 缺失 key 失败。
- [x] 多余 key 失败。
- [x] 重复 key 失败。
- [x] 错误参数名失败。
- [x] 错误参数类型失败。
- [x] 缺业务 variant 失败。
- [x] 多业务 variant 失败。
- [x] 缺 CLDR 必需 plural category 失败。
- [x] 缺 `other` 失败。
- [x] fixture 混入 production registry 失败。
- [x] 函数、spread、条件表达式和跨语言 import 失败。
- [x] 未复核 source hash 失败。
- [x] native-required key 未生成 Rust message 失败。

### 15.2 前端格式化器

- [x] 静态消息。
- [x] 单参数插值。
- [x] 多参数插值和参数重排。
- [x] 业务选择。
- [x] `zh-CN` cardinal plural。
- [x] `en-US` cardinal plural。
- [x] `ru-RU` fixture cardinal plural。
- [x] 数字格式化。
- [x] 日期和时间格式化。
- [x] 未知 key 的开发期错误与生产回退。

### 15.3 Rust 格式化器

- [x] locale 解析与 fallback。
- [x] 静态 native message。
- [x] 参数 native message。
- [x] 业务选择。
- [x] 三个 locale fixture 的 cardinal plural。
- [x] generated enum 与参数类型。
- [x] 缺失资源安全回退和诊断。

### 15.4 双端一致性

- [x] 使用同一 fixture 数据驱动前端与 Rust 测试。
- [x] 比较 plural category，而不只比较某一条最终文案。
- [x] 比较最终格式化结果中的参数位置。
- [x] 验证生成器版本和资源 hash 一致。
- [x] 禁止两端各自维护重复期望表。

### 15.5 React 语言切换

- [x] `zh-CN -> en-US`。
- [x] `en-US -> zh-CN`。
- [x] 设置页预览后取消。
- [x] 设置页预览后保存。
- [x] 保存失败恢复。
- [x] lazy view 语言切换后首次打开。
- [x] 后台返回前台后语言不回退。
- [x] Toast、Dialog、Update 和 Tools 状态不残留旧语言。

### 15.6 原生表面

- [x] 启动托盘中文。
- [x] 启动托盘英文。
- [x] 运行时切换托盘语言。
- [x] 暂停/恢复后菜单保持当前语言。
- [x] 标题记录切换后菜单保持当前语言。
- [x] Markdown 导出中文。
- [x] Markdown 导出英文。
- [x] 稳定导出字段不随语言改变。
- [x] 原生提醒使用触发时当前语言。

### 15.7 无障碍与 UI

- [x] title bar aria label。
- [x] sidebar navigation labels。
- [x] 展开/收起状态标签。
- [x] 数量相关 aria 文案。
- [x] 对话框 title/description/action。
- [x] 英文较长文案不造成核心布局回归。
- [x] 本项不改变 Quiet Pro 样式或交互。

## 16. 性能、体积与可靠性

### 16.1 前端

- [x] 记录迁移前入口 JS、公共 chunk、相关 lazy chunk 与总 JS gzip。
- [x] 记录迁移后同口径结果。
- [x] locale bundle 不把所有未来语言装入启动入口。
- [x] 只打包生产注册 locale。
- [x] 不因迁移放宽 bundle budget。
- [x] formatter cache 有界且按 locale 复用。

### 16.2 Rust

- [x] 记录 Cargo 编译时间基线与迁移后结果。
- [x] 记录 release 二进制/安装包体积。
- [x] ICU4X 数据只包含必要能力或有明确成本说明。
- [x] 不因依赖方便把完整国际化套件无差别打包。
- [x] 原生格式化不进行磁盘或网络读取。

### 16.3 可靠性

- [x] 生产 locale 资源在构建期完全验证。
- [x] 运行时缺失资源有 source locale 回退和诊断。
- [x] 单条坏文案不导致托盘或导出整体不可用。
- [x] 设置提交失败不造成前端与托盘永久语言分裂。
- [x] 生成失败不覆盖上一次有效产物。

## 17. 失败模式与暂停条件

以下 `[x]` 表示已经逐项核验且本次实施未触发该暂停条件；出现任一条件仍必须暂停并重新判断，不能用 allowlist 或兼容代码绕过：

- [x] schema 开始包含 feature 业务流程。
- [x] `shared/i18n` 开始读取 SQLite、Tauri 或页面私有状态。
- [x] Rust localization 需要依赖 `app/*` 才能被 data/export 使用。
- [x] `commands/*` 或 `lib.rs` 开始承接生成、选择或格式化逻辑。
- [x] locale 文件需要函数才能表达现有文案。
- [x] 复数实现需要手写俄语公式才能通过测试。
- [x] 新依赖导致 bundle/安装包预算失败且无法归因收口。
- [x] 兼容层开始承接新 key 或新能力。
- [x] 为通过门禁而扩大硬编码 allowlist。
- [x] 迁移改变稳定导出字段、导入格式或分类 ID。
- [x] 中文文档或资源出现编码损坏。

## 18. 验证命令与检查点

### 18.1 局部开发循环

实施后新增的建议命令：

```bash
npm run check:i18n:self-test
npm run check:i18n
```

Rust 复数专项测试应提供可单独运行的明确目标；最终名称以实现落点为准，执行单中不得预先伪造不存在的命令。

### 18.2 每阶段最低检查

- [x] 命中的 i18n self-test。
- [x] 命中的前端或 Rust 专项测试。
- [x] `npm run check:types`。
- [x] `npm run check:architecture`。
- [x] `npm run check:rust-boundaries`（涉及 Rust 时）。
- [x] `npm run build`（涉及前端生成产物时）。

### 18.3 完整交付检查

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`
- [x] `npm run check`
- [x] `npm run check:full`
- [x] `npm run test:tauri-runtime-smoke`（涉及真实桌面运行时、托盘或通知）
- [x] 生产 bundle/安装包体积对照
- [x] 手工中英文核心页面与原生表面冒烟

如果 `npm run check:full` 与上述单项存在重复，以可靠交付为优先，不以重复为由省略对高风险表面的专项证据。

## 19. 提交拆分建议

实际提交仍遵守仓库 Git 规则和用户授权。本节只定义可独立审查边界，不授权 commit 或 push。

建议按以下 owner/行为拆分：

1. schema、registry、AST validator 与 self-test；
2. frontend/Rust generator 与 stale-output check；
3. frontend Provider/localizer 与最小纵向原型；
4. Rust CLDR plural dependency 与 parity tests；
5. Rust tray migration；
6. Rust export/native reminder migration；
7. 前端领域迁移，可按批次继续拆分；
8. 缓存收口与兼容层删除；
9. 硬编码门禁、贡献文档和长期文档。

本次未获 stage/commit 授权，因此没有伪造 staged 或 commit 证据；交付前已完成以下等价工作区核对：

- [x] 使用 `git status`、`git diff --stat`、`git diff --check` 核对工作区范围。
- [x] 确认没有把用户既有无关修改冒充为本任务成果。
- [x] 确认手工维护内容的 owner 边界可拆分审查。
- [x] 确认 generated output 与源资源保持一致。
- [x] 确认最终完整质量门禁通过。

## 20. Project Acceptance criteria 追踪

| Project 验收条件 | 本文落实位置 | 完成 |
| --- | --- | --- |
| 一个语言类型、一个 schema、一个注册表 | 第 5、6、7 节 | [x] |
| 缺失、多余 key 和参数不一致失败 | 第 7、14、15 节 | [x] |
| 复数类别按 locale 验证 | 第 7.5、14 阶段 5、15 节 | [x] |
| 动态文案不再是任意函数 | 第 7、8、14 节 | [x] |
| 语言切换不显示旧语言 | 第 10、12、15.5 节 | [x] |
| 无未登记硬编码 | 第 14 阶段 10、15.1 节 | [x] |
| 托盘、提醒、导出使用明确 locale | 第 11、14 阶段 6/7、15.6 节 | [x] |
| 新 locale 只需填写资源 | 第 14 阶段 12 | [x] |
| source 变化标记翻译复核 | 第 9 节 | [x] |
| 中英文与无障碍不回归 | 第 15 节 | [x] |
| `ru-RU` fixture 双端一致 | 第 7.5、14 阶段 5、15.4 节 | [x] |
| 检查器和边界自测通过 | 第 14 阶段 2/3、18 节 | [x] |
| 长期贡献文档完整 | 第 14 阶段 13 | [x] |

## 21. 长期文档更新

实施完成前至少评估以下更新：

- [x] [`architecture.md`](../architecture.md)：仓库级 locale 资源、前端 shared runtime、Rust localization owner、generated boundary。
- [x] [`engineering-quality.md`](../engineering-quality.md)：i18n 门禁、硬编码例外、双端 parity 和 generated stale check。
- [x] 新增长期本地化贡献文档：新增 key、修改 source、复核翻译、新增 locale、原生表面与 CLDR 复数。
- [x] 如默认语言、产品支持语言承诺发生变化，再评估产品或 README 更新；本项不提前声明俄语已支持。

长期规则写入对应顶层文档，不把长期约束只留在本文。

## 22. 完成定义

只有以下全部满足，Project item 才可建议从 `In progress` 移到 `Done`：

- [x] 第 2 节总体结果全部完成。
- [x] 第 14 节所有阶段完成。
- [x] 第 15 节测试矩阵全部完成或有维护者明确接受的范围说明。
- [x] 第 16 节性能和体积证据完成。
- [x] 第 18.3 节完整验证通过。
- [x] 第 20 节 Project 验收追踪全部勾选。
- [x] 生产代码不再依赖可变 `UI_TEXT` Proxy。
- [x] Rust 不再维护独立中英文用户文案表。
- [x] `ru-RU` fixture 未进入生产注册表、设置 UI 或发布 bundle。
- [x] 长期贡献文档和架构/质量文档已更新。
- [x] 已重新读取 live Project；其当前仍为 `In progress`，维护者应按交付清单手动拖到 `Done`，实现过程未代替维护者修改状态。

完成后：

- [x] 将本文从 `docs/working/` 移至 `docs/archive/`。
- [x] 不把本文继续当作长期架构真相源。
- [x] 向维护者报告新的 `Next` 窗口拖动建议。

## 23. 最终总检查清单

### 契约

- [x] 唯一 locale 类型。
- [x] 唯一生产注册表。
- [x] 独立 schema。
- [x] 纯声明式资源。
- [x] 参数、业务选择和复数类型化。
- [x] source/review hash 生效。

### 前端

- [x] Provider/hook 主路径。
- [x] 无全局可变语言状态。
- [x] 无新 `UI_TEXT` 调用。
- [x] 缓存与 locale 一致。
- [x] 日期数字使用应用 locale。

### Rust

- [x] 统一 locale 类型。
- [x] CLDR plural rules。
- [x] 托盘已迁移。
- [x] 提醒已迁移。
- [x] Markdown 显示文案已迁移。
- [x] 稳定导出字段未改变。

### 工具链

- [x] validator。
- [x] validator self-test。
- [x] frontend generator。
- [x] Rust generator。
- [x] stale generated check。
- [x] hardcoded gate。
- [x] new-locale generator。

### 俄语准备度

- [x] `ru-RU` fixture 非生产。
- [x] one/few/many/other 完整。
- [x] 代表值前端/Rust一致。
- [x] 下一项正式俄语接入无需修改组件或 Rust 业务代码。

### 交付

- [x] 全量测试通过。
- [x] 全量检查通过。
- [x] bundle 和安装包成本可接受。
- [x] 长期文档完成。
- [x] 临时兼容层删除。
- [x] 执行方案归档。

## 24. 外部翻译贡献闭环补充阶段

本阶段源于 Issue #61 的真实俄语贡献场景。此前完成的是仓库内部本地化契约；本阶段补齐非开发者无需接触 TypeScript 或消息 DSL 的翻译交接能力。完成前本文重新作为 `docs/working/` 下的执行依据，Project item 保持 `In progress`。

- [x] 工具接受任意规范 BCP 47 目标 locale，不写死俄语或某一参考语言。
- [x] XLSX 只作为仓库开发期交接文件，不进入 Patina 运行时或安装包。
- [x] `i18n:export-kit` 从任意已注册参考 locale 生成带版本、上下文、术语表和输入指引的工作簿。
- [x] 翻译者只编辑 Translation 与 Translator note 列，不接触内部 DSL。
- [x] 消息分支按目标 locale 的 CLDR 类别展开；俄语只是 one/few/many/other 的真实验收样本。
- [x] 占位符可按目标语言语序移动，但不得缺失、增加或改名。
- [x] `i18n:import-kit` 校验 schema/source fingerprint、显式受信任身份、行集合、不可变列、漏译、占位符和目标 locale 完整性。
- [x] 默认导入只生成可审查资源目录；只有显式 `--apply` 才通过带锁、失败可回滚的事务注册生产 locale，并保持 review 状态为 `PENDING`。
- [x] 工作簿中的公式、富文本、外部关系、嵌入部件、异常 XML/ZIP 或结构篡改不能绕过导入校验。
- [x] 至少用俄语和另一种复数结构不同的 locale 证明实现与语言无关。
- [x] XLSX 四个工作表完成结构、内容与视觉核验。
- [x] 更新长期贡献文档和质量门禁。
- [x] 完成端到端往返、完整质量门禁与对抗式审查。
- [x] 全部通过后再次勾选并移回 `docs/archive/`。

补充验收证据：

- `ru-RU` 从 `en-US` 导出 1073 个翻译单元，完整填写后的工作簿成功重建为按 owner 分包的纯资源，未自动注册生产语言。
- `ar-EG` 证明 `zero/one/two/few/many/other` 与 RTL 元数据来自目标 locale，而非俄语特判。
- 反例覆盖伪造 ZIP 解压尺寸、漏/增/改占位符、不可变列、过期 fingerprint、公式、富文本、外部关系、defined name 与工作簿身份篡改。
- 工作簿四张表经 artifact-tool 检查与渲染，空白输入格、`TODO` 状态、上下文、术语表和隐藏 manifest 均可读。
- `exceljs` 与 `saxes` 仅为开发依赖；生产 bundle budget 通过，npm 审计和 Windows 可达 Rust 依赖均为 0 个漏洞。
