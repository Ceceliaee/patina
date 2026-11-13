# 编写与安装 Rust 工具面板

示例面板有一个计数和一个按钮。Patina 把点击操作传给 Rust 函数，并保存函数返回的计数。关闭工具页或退出应用后，再次打开面板能读回上次的值。

## 构建与安装

在仓库根目录运行下面的命令。Rust 版本见[桌面工具链](../../rust-toolchain.toml)。

```powershell
rustup target add wasm32-unknown-unknown --toolchain 1.100.0
cargo +1.100.0 build --locked --manifest-path desktop/plugins/counter/Cargo.toml --release --target wasm32-unknown-unknown --target-dir desktop/target/plugins
cargo +1.100.0 run --locked --manifest-path desktop/Cargo.toml -p patina-tool-host --bin pack-tool -- desktop/plugins/counter/manifest.json desktop/target/plugins/wasm32-unknown-unknown/release/patina_counter.wasm desktop/target/counter.patina-tool "$env:LOCALAPPDATA/patina-plugin-author.key"
```

首次打包会在最后一个参数指定的位置生成作者签名密钥。请私下备份它，同一插件后续版本沿用该密钥。在 GPUI 版 Patina 的「工具 → 管理工具」选择「从文件安装」，打开生成的 `counter.patina-tool`。确认名称、文件位置、发布者公钥和所需能力后进入 Counter，点击按钮增加计数。分发时只需提供安装包。

## 修改面板

在[插件入口](src/lib.rs)中改变按钮文案，重新构建并打包，再安装新文件。保持[清单](manifest.json)的 ID，更新即可接续原计数。卸载入口在「管理工具」；重新安装同一插件可读回其保留数据。

[SDK 类型](../../plugin-sdk/src/lib.rs)定义面板请求和响应。打开面板会收到 `Open`，激活按钮会收到带动作 ID 的 `Action`。函数从请求读取私有状态和当前语言，返回新的私有状态与排列好的控件。按钮 ID 在当前面板中唯一；用户看见的文案可以随语言或版本改变。

## 表单与后台计时

面板可返回 `Input`、`Select` 与 `Submit`。提交时 SDK 用稳定的字段 ID 传回输入值，插件在 `Event::Submit` 中校验并保存。控件定义、可调用事件和响应字段以 [Rust 类型](../../plugin-sdk/src/lib.rs) 为准。

需要后台计时的插件在清单中声明 `timer`，在响应中返回 `Timer` 的到期 Unix 毫秒数和通知文案，普通插件将 `task` 留空。宿主保存最近一次响应的计时与私有状态，并在到期时传入 `Due`。一次性任务应在该响应中清空计时，重复任务应计算下一次到期。显示倒计时可返回 `Clock`。卸载时宿主会尝试传入 `Uninstall` 供插件结算，再撤销该实例的后台工作。文件选择器和安装界面都在 Patina 端；模块仅接收与自身相关的请求数据。
