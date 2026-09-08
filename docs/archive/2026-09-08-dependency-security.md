# 依赖安全修复执行记录

范围：修复 GitHub 依赖告警对应的可升级依赖，并补齐本地审计遗漏。依赖版本由 Cargo manifest/lockfile 拥有，审计规则由 `scripts/audit-dependencies.ts` 及其报告解析器拥有。保护现有 Windows x64、ARM64 支持、IPC 权限、SQLite 数据及导出字段契约；本任务不发布、不修改远程告警状态。

## 执行清单

- [x] 核对 GitHub 公告、锁定版本及 Windows 依赖路径：Tauri、Thrift、rand、glib。
- [x] 升级 Tauri 至 2.11.5，前端 API 同步至 2.11.1，随上游工具链移除 rand 0.7.3。
- [x] 将 Arrow/Parquet 升级至 59.3.0，移除 Thrift；保持导出实现和数据字段不变。
- [x] 补查 RustSec unsound 警告，将 event-listener 升级至修复版 5.4.2。
- [x] 审计纳入 unsound 及已知 GitHub 独有公告，并增加受影响版本、修复边界及不完整报告的回归测试。
- [x] glib 0.18.5 无兼容补丁版：转交上游 GTK/Tauri 升级处理；保留精确例外，由审计在两个 Windows 发行 target 中逐次验证不可达。此项不是漏洞已修复声明，未来依赖路径变化必须阻断审计。
- [x] 检查 Tauri 自动生成的权限 schema 差异：主窗口默认集新增多窗口支持查询、移动平台标识查询及托盘图标组合设置；沿用上游默认集，未扩大数据库、文件访问或远程来源授权。挂件使用逐项权限，未获得新增权限。
- [x] 运行完整质量门禁和联网依赖审计。
- [x] 运行隔离桌面 runtime smoke，核对 IPC、数据库及窗口生命周期。
- [x] 检查最终差异、更新 changelog 并归档记录。审查未发现剩余可操作缺陷；glib 按上述上游处置保留。

## 验证与剩余风险

2026-09-08 本地验证结果：

- `npm run check:full` 中的前端质量、构建、111 项 browser smoke、Rust 编译、707 项测试（1 项既有忽略）及 clippy 均通过。现有 Parquet 测试验证导出字段顺序、行数及读取结果。
- 上述整链最后的联网审计因命令行未继承系统代理而失败；仅在重跑进程中设置 `HTTP_PROXY`、`HTTPS_PROXY` 为已有系统代理后，`npm run check:dependencies` 联网通过：Rust 无未处理的 vulnerability/unsound，4 项精确例外均验证 Windows x64、ARM64 不可达；npm 0 项漏洞。未改全局代理设置，也未使用离线结果替代联网证据。
- `npm run test:tauri-runtime-smoke` 在最终 Tauri/API 版本组合下独立重跑通过，覆盖 command、event、SQLite、capability 及主窗口／挂件生命周期。首轮 browser 首屏、一次 runtime 启动曾超时，独立重跑通过，未放宽测试门槛。
- 审计回归测试通过；用升级前的真实 lockfile 运行新解析器，检出 Tauri、Thrift 两项 GitHub 公告，升级后均不命中。
- 文档检查、changelog 校验和 `git diff --check` 通过。依赖与权限差异已按本地 diff 复核；无应用数据迁移或导出字段变化。

glib 仍在跨平台 lockfile 中，GitHub 可能继续展示该告警；上游升级可移除该依赖后，应同时删除本地精确例外。本次未推送或更改 GitHub 告警状态。现有审计要求见 [工程质量](../engineering-quality.md#5-默认验证门槛)，不在此复制长期政策。
