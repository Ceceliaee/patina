# 编写与安装 Rust 工具面板

示例面板有一个计数和一个按钮。Patina 把点击操作传给 Rust 函数，并保存函数返回的计数。关闭工具页或退出应用后，再次打开面板能读回上次的值。

## 构建与安装

在仓库根目录运行下面的命令。Rust 版本见[桌面工具链](../../rust-toolchain.toml)。

```powershell
cargo build --locked --manifest-path plugins/counter/Cargo.toml --release --target wasm32-unknown-unknown --target-dir target/plugins
cargo run --locked --manifest-path Cargo.toml -p patina-plugin-host --bin pack-tool -- plugins/counter/manifest.json target/plugins/wasm32-unknown-unknown/release/patina_counter.wasm target/counter.zip "$env:LOCALAPPDATA/patina-plugin-author.key"
```

在 Patina 的「工具 → 插件市场」选择「从文件安装」，打开 `target/counter.zip`，确认发布者和所需能力后即可使用。已有的 `.patina-tool` 签名包也可以从此入口导入。首次打包会在命令的最后一个路径生成作者签名密钥。请单独备份密钥，更新同一插件时继续使用它。

Counter 的 ZIP 包含一个插件文件夹。

```text
example.counter/
  manifest.json
  plugin.wasm
  signature.json
```

`manifest.json` 声明身份、版本、入口和能力，`plugin.wasm` 保存模块。所有插件都需要 Ed25519 签名，包括预装的提醒和专注。清单、Wasm、签名和语言目录可以放在同一个插件文件夹中，也可以直接放在 ZIP 根目录。安装后每个 ID 对应配置目录下的一个 `tools/plugins/<id>/`。安装相同内容会沿用当前实例，安装其他版本会更新原目录并保留任务。已卸载的插件可以从 ZIP 重装。

语言文件放在可选的 `locales/` 中，每种语言一个 JSON 对象。例如在 `locales/zh-CN.json` 中写入 `{"plugin.name":"计数器","action.add":"加一"}`。插件通过 `request.text("action.add")` 取当前语言的文本。编辑译文后可以直接用原 Wasm 打包。

```powershell
cargo run --locked -p patina-plugin-host --bin pack-tool -- target/example.counter target/counter.zip "$env:LOCALAPPDATA/patina-plugin-author.key"
```

命令末尾是发布者的私钥路径。打包工具会将 Ed25519 公钥和签名写入 `signature.json`。签名覆盖清单、Wasm 和语言资源，修改任一项后用原密钥重新打包。安装窗口显示发布者公钥和所需能力。可用资源管理器重新压缩已签名目录。

在清单中声明 `focus` 或 `reminders`，插件就能通过 `request.data` 读取自己的任务，并通过响应的 `command` 提交动作。同时声明两者时，读取 `data.focus` 和 `data.reminders`，提交 `{"capability":"reminders","command":{...}}` 选择对应接口。卸载会清理该插件的任务和历史。

预装的提醒和专注在各自目录中保存已签名的分发文件。修改译文后，可用原发布者密钥更新其中一个插件。以下示例使用已存在的私钥，递增版本时同时编辑该插件的清单。

```powershell
cargo run --locked -p patina-plugin-host --bin pack-tool -- plugins/bundled/reminders target/reminders.zip "$env:LOCALAPPDATA/Patina.PluginAuthor/plugin-publisher.pk8"
```

## 修改面板

在[插件入口](src/lib.rs)中改变按钮文案，重新构建并打包，再安装新文件。保持[清单](manifest.json)的 ID，更新即可接续原计数。在「插件市场」确认卸载会删除插件数据。重新安装后，计数从零开始。

[SDK 类型](../../crates/plugin-sdk/src/lib.rs)定义面板请求和响应。打开面板会收到 `Open`，激活按钮会收到带动作 ID 的 `Action`。函数从请求读取私有状态和当前语言，返回新的私有状态与排列好的控件。按钮 ID 在当前面板中唯一；用户看见的文案可以随语言或版本改变。

## 页面布局

在清单中声明 `api: 3` 和 `panel` 能力，即可在 `Control::Page` 的每个标签页提供一棵布局树。`Container` 按行、列或等宽网格排列子项。`gap` 使用逻辑像素，`align` 控制交叉轴对齐，`justify` 控制主轴分布。行可换行，容器可嵌套。节点按 ID 引用同一响应里的字段和动作。按钮、输入框、标题和卡片使用 Quiet Pro 的主题与交互状态。

[Layout Counter](examples/layout.rs) 是使用独立 ID 的外部插件。[清单](examples/layout.json)只声明面板能力。在仓库根目录运行以下命令，再从插件市场安装生成的文件。点击「Add one」后计数增加，卸载入口在插件市场。

```powershell
cargo build --locked --manifest-path plugins/counter/Cargo.toml --example layout-counter --release --target wasm32-unknown-unknown --target-dir target/plugins
cargo run --locked -p patina-plugin-host --bin pack-tool -- plugins/counter/examples/layout.json target/plugins/wasm32-unknown-unknown/release/examples/layout_counter.wasm target/layout-counter.zip "$env:LOCALAPPDATA/patina-plugin-author.key"
```

要调整自己的页面，可把示例的 `Flow::Row` 改为 `Flow::Column`，或修改间距、对齐和子项顺序。用原 ID 和签名密钥重新打包即可在支持 API 3 的 Patina 中更新并保留数据。新插件使用自己的 ID、清单和 Wasm 入口，安装成功后会出现在工具首页。API 1 的顺序面板和 API 2 的模板页面继续受支持。

例如，[提醒页面](../bundled/reminders/src/page.rs)声明日期时间、重复方式及按条件显示的间隔字段。[专注页面](../bundled/focus/src/page.rs)把四个计时字段放进两列弹层，并给任务行绑定详情动作。提交表单时，插件收到该表单绑定的字段值，包括收起的弹层里的值。可用组件和布局见 [SDK 页面类型](../../crates/plugin-sdk/src/layout.rs)与[容器和节点](../../crates/plugin-sdk/src/layout/composition.rs)。

## 在 Patina 仓库外开发

假设插件项目 `my-tool` 与 `Patina` 是同级目录。在插件项目中创建 `src/lib.rs`、`manifest.json` 和以下 `Cargo.toml`。可复制上面的 Layout Counter 入口和清单作为起点，将清单的 `id` 与 `name` 改为自己的值。`entry` 对应模块导出的入口函数。

```toml
[package]
name = "my-tool"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
extism-pdk = "1"
patina-plugin-sdk = { path = "../Patina/crates/plugin-sdk" }
```

在 `my-tool` 目录构建、打包。将生成的 `my-tool.zip` 交给使用者，即可在支持 ZIP 安装及该插件 API 版本的 Patina 中直接安装。以后只在此项目中修改布局或业务逻辑、递增清单版本，再用同一密钥打包。

```powershell
cargo build --release --target wasm32-unknown-unknown
cargo run --locked --manifest-path ../Patina/Cargo.toml -p patina-plugin-host --bin pack-tool -- manifest.json target/wasm32-unknown-unknown/release/my_tool.wasm my-tool.zip "$env:LOCALAPPDATA/patina-plugin-author.key"
```

## 表单与后台计时

面板可返回 `Input`、`Select` 与 `Submit`。提交时 SDK 用稳定的字段 ID 传回输入值，插件在 `Event::Submit` 中校验并保存。控件定义、可调用事件和响应字段以 [Rust 类型](../../crates/plugin-sdk/src/lib.rs) 为准。

要自定义通知，在清单中声明 `api: 7` 并导出 `notification`。该函数接收 `Request`，返回 `NoticeContent`，其中包含本地化标题、正文和一至两个按钮。需要二次选择时，提供一个按钮和一组选项。Patina 在用户确认后，以 `Event::Notification` 的 `action` 字段向插件传回操作 ID，插件据此更新任务。[通知类型](../../crates/plugin-sdk/src/notification.rs) · [提醒插件示例](../bundled/reminders/src/notification.rs)

需要后台计时的插件在清单中声明 `timer`，在响应中返回 `Timer` 的到期 Unix 毫秒数和通知文案，普通插件将 `task` 留空。宿主保存最近一次响应的计时与私有状态，并在到期时传入 `Due`。一次性任务应在该响应中清空计时，重复任务应计算下一次到期。显示倒计时可返回 `Clock`。卸载时宿主会尝试传入 `Uninstall` 供插件结算，再撤销该实例的后台工作。文件选择器和安装界面都在 Patina 端；模块仅接收与自身相关的请求数据。
