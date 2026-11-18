# 本地化契约与贡献指南

本文是 Patina 多语言系统的长期操作指南与参考。目标读者是新增或修改用户可见文案、维护原生表面、贡献新语言的开发者。

它回答消息 schema、资源、生成、runtime、复核和贡献流程，不决定产品功能、具体措辞语义或发布优先级。

按任务进入：[修改文案](#4-修改或新增文案)、[直接增加语言](#51-开发者直接编辑资源)、[交接 XLSX](#52-向非开发者交接-xlsx-翻译包)。完成操作后可查[消息模型](#3-消息模型)、[资源激活](#53-前端资源装载与-locale-激活)、[原生回退](#6-rust-原生表面)和[验证](#8-验证入口)。下文按操作、参考排列。

<a id="1-方案结论"></a>

<a id="1-消息与实现-owner"></a>

## 消息与实现 owner

Patina 使用仓库级、语言无关的消息契约，而不是让某个前端对象成为规范源：

- `locales/schema.ts` 定义 key、参数、消息种类和消费表面；
- `locales/registry.ts` 是唯一生产语言注册表；
- `locales/<locale>/` 是人工维护的纯声明式资源目录；
- `locales/review-manifest.ts` 记录各翻译对标准原文版本的复核结果；
- `scripts/i18n/generate.ts` 为原生应用生成 Rust 消息与数据资源；
- `desktop/recorder/src/domain/localization/` 是 Rust 运行时 owner。

资源文件使用受限制的 TypeScript 对象字面量承载数据。这里使用 TypeScript 只是为了仓库内编辑体验；检查器禁止函数、调用、条件表达式、展开、计算属性和跨文件继承。消息中的 `$op` 节点是一种小型声明式 DSL：它描述“做什么”，不执行任意代码。生成结果才是业务代码消费的 API。

schema 条目可增加语言无关的 `description` 和 `translatorNote`。翻译包始终提供由表面与 key 形成的稳定位置上下文；当短文案、品牌名、无障碍含义或业务语义可能歧义时，维护者必须补充这两个字段之一，导出器会把它们直接交给翻译者。

同一句前端消息也供原生窗口使用时，在现有 schema 条目标记 `alsoNative: true`。原生生成器导出该 key 和译文。

这不是 Fluent，也没有引入新的前端语言或运行时框架。前端使用浏览器内建的 `Intl`，Rust 仅为 CLDR 基数复数使用 ICU4X。

<a id="2-不变量"></a>

## 不变量

- locale 是显式运行时输入；纯函数显式接收 locale 或 `UiText`。
- 语言相关缓存必须包含 locale；优先缓存语言无关数据。
- 业务代码不得读取 `locales/`，也不得直接读取 generated 资源表。
- generated 文件不可手改；修改源后运行 `pnpm run i18n:generate`。
- 应用界面、无障碍标签、托盘、原生提醒和 Markdown 导出中的消息文案都受同一契约约束；发布说明正文另见[发布规范](./versioning-and-release-policy.md#83-release-与-app-note)。
- 协议字段、数据库字段、导入标识、程序名、URL、HEX/RGB/HSL 等数据不得机械本地化。
- 未登记硬编码会失败；例外必须精确到文件和值，并写明 owner 与原因。

<a id="4-修改或新增文案"></a>

## 修改或新增文案

1. 在 `locales/schema.ts` 新增或调整语言无关定义，明确 `frontend` 或 `native` 表面。
2. 在每个生产 locale 的相应资源 bundle 中添加相同 key。
3. 若标准原文 `zh-CN` 的语义发生变化，重新人工复核其他语言，再运行 `pnpm run i18n:review <locale> --key <message-key>` 明确确认该条翻译；不得直接手改 hash。
4. 运行 `pnpm run i18n:generate`。
5. 业务调用方只使用生成的 `UiText` 或 Rust localizer API。
6. 运行 `pnpm run check:i18n`、相关类型检查和命中的功能测试。仅修改现有文案或译文不默认运行工具自测；修改消息契约、格式化、生成或校验工具及其相关依赖时，按[工程质量](./engineering-quality.md#7-本地化质量路由)追加对应行为测试和自测。

不要通过修改 generated 文件、复制中英文分支或扩大硬编码例外来让检查通过。

<a id="5-新增内置语言"></a>

## 新增内置语言

<a id="51-开发者直接编辑资源"></a>

### 开发者直接编辑资源

以俄语为例：

```powershell
pnpm run i18n:new ru-RU Русский
```

可先检查预计改动而不写文件：

```powershell
pnpm run i18n:new ru-RU Русский --dry-run
```

该命令会：

1. 验证并规范 locale tag；
2. 由标准原文资源创建 `locales/ru-RU/`；
3. 把语言、原生名称和方向加入唯一注册表；
4. 把全部 source-review 状态置为 `PENDING`，不会替贡献者自动签署人工复核；
5. 保持组件、Rust 业务代码和手工语言 union 不变。

资源目录、review manifest 和注册表采用临时目录、安全替换与失败回滚；跨进程锁防止两个语言事务并发覆盖，写入前还会验证注册表没有在等待锁时发生变化。注册表最后写入，普通失败不会留下已注册但缺少资源的半成品。若进程被强制终止，命令会拒绝覆盖残留的锁、目标目录或 staging 目录并给出检查提示；维护者确认注册表、review manifest 与目录状态后再清理残留。这种残留不会被工具静默当作新的生产语言。

如需从另一份资源开始翻译，可加 `--from en-US`。从右到左语言使用 `--direction rtl`；Provider 会把注册表方向同步到文档根节点。

生成后完成整个 locale 目录的翻译，特别检查复数消息，再执行：

```powershell
pnpm run i18n:review ru-RU --all
pnpm run i18n:generate
pnpm run check:i18n:self-test
pnpm run check:i18n
pnpm test
pnpm run check:rust
```

前端 `Locale` 类型、Rust `Locale` enum、资源表和方向元数据均由注册表生成。GPUI 设置页的语言选项由 [`settings.rs`](../desktop/patina/src/settings.rs) 持有；新增语言时同步更新该选项列表。

新增语言不等于自动解决布局问题。正式发布前仍需检查长文本、字体覆盖、输入法，以及 RTL 语言的镜像布局。它们是界面兼容性验收，不是复数算法。

<a id="52-向非开发者交接-xlsx-翻译包"></a>

### 向非开发者交接 XLSX 翻译包

外部翻译者不需要安装开发环境，也不应接触 TypeScript 资源或消息 DSL。维护者可从任意已注册参考语言生成任意规范 BCP 47 目标语言的工作簿：

```powershell
pnpm run i18n:export-kit ru-RU Русский --from en-US
```

其他语言使用相同命令；例如 RTL 语言可增加 `--direction rtl`。工具不会写死俄语规则，而是由目标 locale 的 `Intl.PluralRules` 展开其 CLDR 类别。默认文件写入 `artifacts/i18n/`，也可用 `--output <file.xlsx>` 指定位置。

工作簿包含：

- `Instructions`：目标语言、参考语言、占位符和交回规则；
- `Translations`：每条可翻译单元的上下文、表面、key、分支、参考文本和输入列；
- `Glossary`：产品术语与不可翻译名称；
- `_Manifest`：隐藏的格式版本、schema/source fingerprint 和完整性元数据。

翻译者只编辑黄色的 `Translation` 和 `Translator note / question` 列。`⟦count⟧` 等占位符可以按目标语序移动，但不能删除、增加或改名。消息的业务分支和目标语言复数类别会展开为独立行，翻译者不需要理解内部 AST。

接入前由维护者确认翻译与审核安排。生产验收须检查原意、术语、关键操作和真实界面布局，不能由生成器自动放行；一项接入决定不自动改变其他语言的既有贡献安排。

`i18n:review` 记录某个 source hash 已被明确接受，不能证明审核身份或文案准确；译文变化后须重新复核。具体 locale、显示名称和方向由注册表持有，接入决定与验收结果留在对应执行记录，不在本文逐语言维护例外。

翻译反馈按产品、版本、页面、现有译文和预期含义定位，不要求提供 Token 或私人活动数据。误导删除、恢复或隐私操作的问题优先修正；修改源资源后更新复核记录与生成产物，并检查其他表面的同术语。持续反馈由各仓本地化维护者负责，自动检查通过不能替代语义判断。

收到文件后先生成可审查资源，不注册生产语言：

```powershell
pnpm run i18n:import-kit artifacts/i18n/patina-ru-RU-from-en-US-translation-kit.xlsx --target ru-RU --label Русский --direction ltr --from en-US
```

可用 `--output <directory>` 指定审查目录。导入器会拒绝过期 fingerprint、缺失或额外行、被修改的参考列、漏译、占位符错误、意外公式、富文本、外部关系或嵌入对象、异常或过大的 XLSX 容器和不符合目标 locale CLDR 规则的结果。返回工作簿仍应按不可信输入处理：先用导入器验证并生成干净的可审查资源，不把直接打开陌生 XLSX 当作审查前置步骤。

完成代码审查和母语界面验收后，才显式应用：

```powershell
pnpm run i18n:import-kit path/to/completed-kit.xlsx --target ru-RU --label Русский --direction ltr --from en-US --apply
pnpm run i18n:review ru-RU --all
pnpm run i18n:generate
pnpm run check:full
```

导入命令要求维护者在命令行再次明确目标 locale、原生名称、方向和参考 locale；导入器逐项对照工作簿，不能让回传文件自行决定将注册哪个语言。`--apply` 使用与 `i18n:new` 相同的原子事务，首次创建资源目录、注册 locale，并把 review 状态保留为 `PENDING`。它拒绝覆盖已注册或已存在的 locale。XLSX 与 `exceljs` 都只属于开发工具链，不进入 Patina 前端、Rust 二进制或安装包。

<a id="3-消息模型"></a>

## 消息模型

<a id="31-静态文案"></a>

### 静态文案

schema 的 `kind` 为 `string`，locale 资源直接提供字符串。

<a id="32-参数插值"></a>

### 参数插值

schema 声明参数名和类型，资源使用 `arg` 与 `concat`：

```ts
"example.greeting": {
  "$type": "message",
  "body": {
    "$op": "concat",
    "parts": ["Hello, ", { "$op": "arg", "name": "name" }]
  }
}
```

参数名必须与 schema 完全一致。缺失、多余或类型语义错误由检查器拒绝。

<a id="33-业务选择"></a>

### 业务选择

布尔或枚举语义使用 `if`、`eq`、`notEq` 等受控表达式。选择条件属于消息契约，不允许重新写成 locale 文件里的函数。

<a id="34-cldr-基数复数"></a>

### CLDR 基数复数

复数消息使用 `plural`，计数参数在 schema 中标记为整数语义。每个 locale 必须提供该语言由 CLDR 定义的全部类别。

俄语通常使用：

- `one`：`1`、`21`；
- `few`：`2`、`22`；
- `many`：`0`、`5`、`11`、`25`；
- `other`：主要覆盖非整数等其他形式。

不得根据尾数手写俄语公式。前端由 `Intl.PluralRules` 选择类别，Rust 由 ICU4X 选择类别。`locales/fixtures/ru-RU/plurals.ts` 是不进入生产注册表的共享夹具，并生成 Rust 测试数据，以代表值证明两端一致。

<a id="53-前端资源装载与-locale-激活"></a>

## 原生资源与语言切换

窗口和托盘从 Recorder 读取已注册语言的静态资源。切换语言时由页面重新读取相应消息，语言相关的缓存以 locale 区分。

<a id="6-rust-原生表面"></a>

## Rust 原生表面

托盘、GPUI 页面、Tools 到期提醒、Markdown 导出和内置分类名通过 `domain/localization` 获取文案。调用方传 key 和命名参数。生成的 Rust 消息支持文本、参数、拼接和 ICU4X 基数复数，也支持以 `if` 判断命名参数是否等于指定字符串。例如 Today 的昨日对比使用 `direction` 参数选择增长、减少或持平的译文。

未知持久化 locale 会记录诊断并回退到注册表中的标准语言。文本缺失 key 会先回退标准语言，仍缺失时记录诊断并返回 key，避免静默空白。

步骤说明等 `kind: "data"` 资源也可标记 `alsoNative: true`，由 `data(locale, key)` 读取结构化内容。读取失败时先回退标准语言，仍不可用则返回 `None`；调用方不另存一份译文。GPUI 通过 recorder 的 `localized_data` 导出使用该接口。

CSV、SQLite 和 Parquet 的稳定字段名是数据契约，不随 UI locale 改变；只有 Markdown 的用户展示标签本地化。

<a id="7-硬编码例外"></a>

## 硬编码例外

原生界面文案从消息契约读取。仓库检查器扫描原生界面及导出路径，检测重新写入源码的译文。DSL 校验器检查参数类型、操作数与值域；变更生成器时同时验证对应 Rust 资源。

<a id="8-验证入口"></a>

## 验证入口

- `pnpm run test:i18n`：CLDR 夹具、通用翻译包往返、篡改和占位符反例。
- `pnpm run check:i18n:self-test`：validator、硬编码门禁和新语言命令的反例。
- `pnpm run check:i18n`：资源完整性、参数、CLDR 类别、source-review hash、generated stale 和硬编码。
- `pnpm run check:types`：生成类型与调用方一致性。
- `pnpm run check:rust`：Rust 格式化、测试、边界和 clippy。
- `pnpm run check:full`：涉及跨模块、Rust 或公共生成链路的本地化修改；局部修改按[工程质量](./engineering-quality.md#5-默认验证门槛)选择相关验证。

任何检查失败都应修复 owner 或契约，不应直接修改生成产物。
