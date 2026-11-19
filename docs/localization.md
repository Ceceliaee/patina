# 本地化

从仓库根目录运行本文中的命令。修改文案时直接编辑 JSON，向译者交接时使用 XLSX。桌面程序通过编译进二进制的 Rust 资源显示文案。

<a id="1-方案结论"></a>
<a id="1-消息与实现-owner"></a>

## 资源位置

| 需要修改的内容 | 位置 |
| --- | --- |
| 消息 key、参数、种类、上下文和消费表面 | [消息契约](../locales/schema.json) |
| 文案、语言名称、阅读方向、显示顺序和审阅状态 | [各语言目录](../locales)，以语言标签为目录名，`metadata.json` 保存元数据，其余 JSON 按业务域保存消息 |
| 生成、检查、审阅与 XLSX 交接 | [Rust 开发工具](../xtask/src/i18n) |
| 语言选择、复数、消息格式化和回退 | [Rust 本地化库](../crates/i18n/src/lib.rs) |

<a id="2-不变量"></a>
<a id="4-修改或新增文案"></a>

## 修改或新增文案

1. 在消息契约中定义 key、种类和参数。原生专用消息使用 `surface: "native"`，其他已有消息增加原生消费者时使用 `alsoNative: true`。对有歧义的短文案、品牌名或无障碍标签填写 `description` 或 `translatorNote`，导出的工作簿会给译者展示。
2. 在每个语言的业务域文件中补齐同一条消息。标准原文的语言由 `metadata.json` 中的 `source` 标志确定。原文改变后，人工复核每份译文，再分别执行以下命令。示例复核英文托盘退出项。

   ```sh
   cargo xtask i18n review en-US --key native.tray.quit
   ```

3. 重新生成资源并检查。提交源 JSON 和生成文件。单个消费者可以使用生成的类型化函数，例如 `patina_i18n::messages::native_export_records(locale, count)`。

   ```sh
   cargo xtask i18n generate
   cargo xtask i18n check
   ```

<a id="5-新增内置语言"></a>
<a id="51-开发者直接编辑资源"></a>

## 新增内置语言

先选定规范 BCP 47 标签、语言原名和阅读方向。以下命令预览从英文建立法语资源，去掉 `--dry-run` 后写入 `locales/fr/`。参考语言默认使用标准原文，阅读方向默认为 `ltr`。从右到左的语言传入 `--direction rtl`。

```sh
cargo xtask i18n new fr Français --from en-US --dry-run
cargo xtask i18n new fr Français --from en-US
```

完成所有业务域翻译，逐条复核文本、占位符、各复数分支与结构化说明，然后确认整种语言，生成产物并校验。

```sh
cargo xtask i18n review fr --all
cargo xtask i18n generate
cargo xtask i18n check
```

新建和应用翻译包都会为每个 key 留下 `PENDING`。工具在目标旁的隐藏临时目录写入全部资源与元数据，完成后一次重命名才注册语言。操作系统文件锁串行化修改命令。失败可修复后重试，已有语言不会被覆盖。进程异常终止留下的隐藏临时目录不参与注册。

设置页从生成的语言列表读取显示顺序和原名。正式发布前需要在界面核对长文本、字体、输入法，以及 RTL 语言所需的镜像布局。

<a id="52-向非开发者交接-xlsx-翻译包"></a>

## 向非开发者交接 XLSX 翻译包

维护者导出工作簿。默认文件名包含目标和参考语言，可以用 `--output` 指定路径。

```sh
cargo xtask i18n export-kit fr Français --from en-US
```

把 `artifacts/i18n/patina-fr-from-en-US-translation-kit.xlsx` 发给译者。译者在 **Translations** 的黄色列填写译文和疑问，保留全部行、消息标识和参考列。**Instructions** 说明如何填写，**Glossary** 提供术语。每个目标语言的 CLDR 复数类别和选择分支有独立翻译行。保留所有 `⟦参数⟧` 及其出现次数，可以因语序调整位置。单元格支持纯文本和换行。

收到工作簿后，在命令行指定可信的目标标签、原名、方向和参考语言。默认把草稿写入 `artifacts/i18n/imported/fr/`，可用 `--output` 指定新的草稿目录。

```sh
cargo xtask i18n import-kit artifacts/i18n/patina-fr-from-en-US-translation-kit.xlsx --target fr --label Français --direction ltr --from en-US
```

工具检查工作簿版本、消息契约、参考原文、不可编辑列的指纹、行与占位符。缺失或重复的行、改动的参考列、空译文、非预期公式、外部关系和超限解压内容都会使导入失败。原文或契约已经改变时，从当前版本导出新工作簿。核对草稿后用同一命令加 `--apply` 注册新语言，再执行复核、生成和检查。工作簿解析依赖仅用于开发工具。

<a id="3-消息模型"></a>
<a id="31-静态文案"></a>
<a id="32-参数插值"></a>
<a id="33-业务选择"></a>
<a id="34-cldr-基数复数"></a>

## 消息模型

静态消息允许字符串、字符串数组、字符串记录，以及带命名校验器的结构化数据。`message` 的参数在契约内声明。下面的消息使用 `arg` 取具名参数，用 `concat` 拼接译文。

```json
{
  "$type": "message",
  "body": {
    "$op": "concat",
    "parts": ["Hello, ", { "$op": "arg", "name": "name" }]
  }
}
```

选择分支使用 `if`、`eq` 等声明式操作。复数分支使用 `plural` 和整数参数，每种语言都提供 ICU4X 为该语言列出的全部 CLDR 基数类别。俄语的 1、21 取 `one`，2、22 取 `few`，0、5、11、25 取 `many`。其他形式由 CLDR 判定。[俄语复数夹具](../locales/fixtures/ru-RU/plurals.json)

<a id="53-前端资源装载与-locale-激活"></a>
<a id="6-rust-原生表面"></a>
<a id="7-硬编码例外"></a>

## 原生资源与回退

GPUI 页面、无障碍标签、托盘、提醒和 Markdown 导出显式传入 `Locale`。语言相关缓存将 locale 作为键的一部分。动态字段可用 `text` 或 `format_text`，结构化资源可用 `localized_data`。读取无效的持久化语言标签会记录诊断并回退到标准语言。消息在所选语言无法解析时重试标准语言，仍失败则记录诊断并显示 key。结构化资源重试后仍缺失时返回 `None`。

原生界面和导出中的用户文案使用消息资源。`i18n check` 检查源码中重复的原生标准译文。协议和数据库字段、用户自定义名称、程序名、URL、配色数值及 CSV、SQLite、Parquet 的稳定字段保持原值。

<a id="8-验证入口"></a>

## 验证入口

| 命令 | 验证内容 |
| --- | --- |
| `cargo xtask i18n check` | 生产语言、键和参数、CLDR 类别、原文审阅指纹、生成结果、硬编码 |
| `cargo test -p patina-i18n` | 运行时格式化、复数、类型化消息与语言元数据 |
| `cargo test -p xtask -- i18n::` | 消息校验反例、XLSX 往返与异常输入、审阅失效、原子导入 |

界面或导出行为发生变化时，还要运行相应消费者的行为测试。[工程质量](./quality.md#验证范围)
