# 本地化契约与贡献指南

本文是 Patina 多语言系统的长期操作指南与参考。目标读者是新增或修改用户可见文案、维护原生表面、贡献新语言的开发者。

它回答消息 schema、资源、生成、runtime、复核和贡献流程，不决定产品功能、具体措辞语义或发布优先级。

## 1. 方案结论

Patina 使用仓库级、语言无关的消息契约，而不是让某个前端对象成为规范源：

- `locales/schema.ts` 定义 key、参数、消息种类和消费表面；
- `locales/registry.ts` 是唯一生产语言注册表；
- `locales/<locale>/` 是人工维护的纯声明式资源目录；
- `locales/review-manifest.ts` 记录各翻译对标准原文版本的复核结果；
- `scripts/i18n/generate.ts` 为前端和 Rust 生成各自的静态产物；
- `src/shared/i18n/` 是前端运行时 owner；
- `src-tauri/src/domain/localization/` 是 Rust 运行时 owner。

资源文件使用受限制的 TypeScript 对象字面量承载数据。这里使用 TypeScript 只是为了仓库内编辑体验；检查器禁止函数、调用、条件表达式、展开、计算属性和跨文件继承。消息中的 `$op` 节点是一种小型声明式 DSL：它描述“做什么”，不执行任意代码。生成结果才是业务代码消费的 API。

schema 条目可增加语言无关的 `description` 和 `translatorNote`。翻译包始终提供由表面与 key 形成的稳定位置上下文；当短文案、品牌名、无障碍含义或业务语义可能歧义时，维护者必须补充这两个字段之一，导出器会把它们直接交给翻译者。

这不是 Fluent，也没有引入新的前端语言或运行时框架。前端使用浏览器内建的 `Intl`，Rust 仅为 CLDR 基数复数使用 ICU4X。

## 2. 不变量

- locale 是显式运行时输入；React 通过 `LocaleProvider` 和 hook 获取，纯函数显式接收 locale 或 `UiText`。
- 语言相关缓存必须包含 locale；优先缓存语言无关数据。
- 业务代码不得读取 `locales/`，也不得直接读取 generated 资源表。
- generated 文件不可手改；修改源后运行 `npm run i18n:generate`。
- 用户可见文案、无障碍标签、托盘、原生提醒和 Markdown 展示字段都受同一契约约束。
- 协议字段、数据库字段、导入标识、程序名、URL、HEX/RGB/HSL 等数据不得机械本地化。
- 未登记硬编码会失败；例外必须精确到文件和值，并写明 owner 与原因。

## 3. 消息模型

### 3.1 静态文案

schema 的 `kind` 为 `string`，locale 资源直接提供字符串。

### 3.2 参数插值

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

### 3.3 业务选择

布尔或枚举语义使用 `if`、`eq`、`notEq` 等受控表达式。选择条件属于消息契约，不允许重新写成 locale 文件里的函数。

### 3.4 CLDR 基数复数

复数消息使用 `plural`，计数参数在 schema 中标记为整数语义。每个 locale 必须提供该语言由 CLDR 定义的全部类别。

俄语通常使用：

- `one`：`1`、`21`；
- `few`：`2`、`22`；
- `many`：`0`、`5`、`11`、`25`；
- `other`：主要覆盖非整数等其他形式。

不得根据尾数手写俄语公式。前端由 `Intl.PluralRules` 选择类别，Rust 由 ICU4X 选择类别。`locales/fixtures/ru-RU/plurals.ts` 是不进入生产注册表的共享夹具，并生成 Rust 测试数据，以代表值证明两端一致。

## 4. 修改或新增文案

1. 在 `locales/schema.ts` 新增或调整语言无关定义，明确 `frontend` 或 `native` 表面。
2. 在每个生产 locale 的相应资源 bundle 中添加相同 key。
3. 若标准原文 `zh-CN` 的语义发生变化，重新人工复核其他语言，再运行 `npm run i18n:review -- <locale> --key <message-key>` 明确确认该条翻译；不得直接手改 hash。
4. 运行 `npm run i18n:generate`。
5. 业务调用方只使用生成的 `UiText` 或 Rust localizer API。
6. 运行 `npm run check:i18n:self-test`、`npm run check:i18n` 和命中的功能测试。

不要通过修改 generated 文件、复制中英文分支或扩大硬编码例外来让检查通过。

## 5. 新增内置语言

### 5.1 开发者直接编辑资源

以俄语为例：

```powershell
npm run i18n:new -- ru-RU Русский
```

可先检查预计改动而不写文件：

```powershell
npm run i18n:new -- ru-RU Русский --dry-run
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
npm run i18n:review -- ru-RU --all
npm run i18n:generate
npm run check:i18n:self-test
npm run check:i18n
npm test
npm run check:rust
```

语言选择器、前端 `Locale` 类型、Rust `Locale` enum、资源表和方向元数据均由注册表生成；新增现有契约可表达的语言不需要修改 React 组件或 Rust 业务模块。

新增语言不等于自动解决布局问题。正式发布前仍需检查长文本、字体覆盖、输入法，以及 RTL 语言的镜像布局。它们是界面兼容性验收，不是复数算法。

### 5.2 向非开发者交接 XLSX 翻译包

外部翻译者不需要安装开发环境，也不应接触 TypeScript 资源或消息 DSL。维护者可从任意已注册参考语言生成任意规范 BCP 47 目标语言的工作簿：

```powershell
npm run i18n:export-kit -- ru-RU Русский --from en-US
```

其他语言使用相同命令；例如 RTL 语言可增加 `--direction rtl`。工具不会写死俄语规则，而是由目标 locale 的 `Intl.PluralRules` 展开其 CLDR 类别。默认文件写入 `artifacts/i18n/`，也可用 `--output <file.xlsx>` 指定位置。

工作簿包含：

- `Instructions`：目标语言、参考语言、占位符和交回规则；
- `Translations`：每条可翻译单元的上下文、表面、key、分支、参考文本和输入列；
- `Glossary`：产品术语与不可翻译名称；
- `_Manifest`：隐藏的格式版本、schema/source fingerprint 和完整性元数据。

翻译者只编辑黄色的 `Translation` 和 `Translator note / question` 列。`⟦count⟧` 等占位符可以按目标语序移动，但不能删除、增加或改名。消息的业务分支和目标语言复数类别会展开为独立行，翻译者不需要理解内部 AST。

机器翻译、生成式翻译和简繁字符转换都只能产生审校草稿，不能直接成为生产资源。生产验收必须由熟悉目标地区软件语境的审校者结合真实界面逐项确认：原意没有偏移、当地术语自然一致、按钮与危险操作不会误导、同屏上下文读起来连贯，并覆盖长文本和窄窗口。`i18n:review` 只记录某个 source hash 已被明确签署，不能代替母语审校，也不能把自动化通过解释成文案准确。如果暂时没有可信审校能力，或维护者在实际界面中发现系统性疑问，应保持该 locale 不进入生产注册表，或在尚未发布时完整撤回。

收到文件后先生成可审查资源，不注册生产语言：

```powershell
npm run i18n:import-kit -- artifacts/i18n/patina-ru-RU-from-en-US-translation-kit.xlsx --target ru-RU --label Русский --direction ltr --from en-US
```

可用 `--output <directory>` 指定审查目录。导入器会拒绝过期 fingerprint、缺失或额外行、被修改的参考列、漏译、占位符错误、意外公式、富文本、外部关系或嵌入对象、异常或过大的 XLSX 容器和不符合目标 locale CLDR 规则的结果。返回工作簿仍应按不可信输入处理：先用导入器验证并生成干净的可审查资源，不把直接打开陌生 XLSX 当作审查前置步骤。

完成代码审查和母语界面验收后，才显式应用：

```powershell
npm run i18n:import-kit -- path/to/completed-kit.xlsx --target ru-RU --label Русский --direction ltr --from en-US --apply
npm run i18n:review -- ru-RU --all
npm run i18n:generate
npm run check:full
```

导入命令要求维护者在命令行再次明确目标 locale、原生名称、方向和参考 locale；导入器逐项对照工作簿，不能让回传文件自行决定将注册哪个语言。`--apply` 使用与 `i18n:new` 相同的原子事务，首次创建资源目录、注册 locale，并把 review 状态保留为 `PENDING`。它拒绝覆盖已注册或已存在的 locale。XLSX 与 `exceljs` 都只属于开发工具链，不进入 Patina 前端、Rust 二进制或安装包。

### 5.3 前端资源装载与 locale 激活

生成器为每个生产 locale 输出独立资源模块，并生成只包含明确动态 import 的 loader manifest。标准原文 `zh-CN` 作为同步可用的初始资源进入默认启动图；其他语言只在已保存设置、预览选择或窗口恢复实际需要时加载。每个 locale chunk 都应有稳定 owner、独立 bundle 预算和构建图断言，不能落入无 owner support aggregate，也不能让新增语言继续线性抬高初始 localization runtime。

前端运行时遵守以下契约：

- 已完成资源按 locale 缓存；同一 locale 的并发首次请求合并为同一个 in-flight Promise；
- `LocaleProvider` 只对当前仍有效的请求结果提交状态，较早请求即使较晚完成也不得覆盖新选择；
- `text`、有效 locale、`document.lang` 与 `document.dir` 在目标资源可用后一起切换；等待期间继续呈现最后一个可用 locale，不显示空白或混合状态；
- 目标资源加载失败时保留最后一个可用 locale，记录可诊断错误，并阻止 Settings 保存一个未实际展示的目标语言；
- 主窗口和 Widget 通过同一 Provider/runtime 契约装载资源，feature 与业务代码不得直接读取 generated locale 模块；
- 缺失消息仍按标准原文回退，但“整个目标 locale 资源无法加载”属于激活失败，不能伪装成一次成功切换。

修改生成器、loader、缓存或激活顺序时，至少验证 manifest 与注册表一致、同 locale 请求合并、快速连续切换、当前请求失败、Widget/主窗口契约以及 locale chunk 的构建图归属。

## 6. Rust 原生表面

托盘、Tools 到期提醒、Markdown 导出标题/摘要/字段标签和内置分类名通过 `domain/localization` 获取文案。调用方传 key 和命名参数，不得重新维护 `match language` 中英文表。生成的 Rust 消息 AST 原生支持 `literal`、`arg`、`concat` 与 `plural`；每个 `plural` 都调用 ICU4X，因此俄语的记录、小时、分钟等词形无需修改 Rust 业务调用方。

未知持久化 locale 会记录诊断并回退到注册表中的标准语言。缺失 key 会先回退标准语言，仍缺失时记录诊断并返回 key，避免静默空白。

CSV、SQLite 和 Parquet 的稳定字段名是数据契约，不随 UI locale 改变；只有 Markdown 的用户展示标签本地化。

## 7. 硬编码例外

检查器使用 TypeScript AST 检查 `.ts`/`.tsx` 中的 JSX 文本与字符串表达式、可见属性、常见 view-model 展示字段和受控通知调用；它按词法作用域跟踪常量和 `let` 的直线/条件赋值，并把同一 sink 的全部可能文本分别送入例外检查，避免已批准值遮蔽未批准值。Rust 门禁检查已声明 native 文案是否在托盘、提醒和 Markdown owner 中重新出现。

DSL validator 会同时检查操作数类型和值域。例如数值必须有限，`monthName` 的月份必须是 `0..11` 的整数且字面日期必须有效；前端运行时仍保留同样的防御，非法输入只记录诊断并返回安全空串。生成器可以移除 `concat` 中的空字符串节点，但必须保留 `concat` 操作本身的字符串转换语义。

确属非自然语言的数据、诊断文本或注册名称（例如主题的正式名称），登记在 `scripts/i18n/hardcoded-exceptions.ts`。每项必须包含：

- 精确文件；
- 精确值；
- owner；
- 为什么不能本地化。

检查器会同时拒绝未登记硬编码和已经不再命中的陈旧例外。不接受目录、前缀、glob 或正则豁免。

## 8. 验证入口

- `npm run test:i18n`：前端格式化、CLDR 夹具、通用翻译包往返、篡改和占位符反例。
- `npm run check:i18n:self-test`：validator、硬编码门禁和新语言命令的反例。
- `npm run check:i18n`：资源完整性、参数、CLDR 类别、source-review hash、generated stale 和硬编码。
- `npm run check:types`：生成类型与调用方一致性。
- `npm run check:rust`：Rust 格式化、测试、边界和 clippy。
- `npm run check:full`：结构性本地化修改的最终门槛。

任何检查失败都应修复 owner 或契约，不应直接修改生成产物。
