# 自由专注实现与验证

范围：名称、休息模式创建区，以及正计时、暂停、手动结束、手动开始休息与下一次专注。遵循[产品边界](../product-principles-and-scope.md)、[架构](../architecture.md)和[验证规则](../engineering-quality.md)。

自由专注与番茄任务共用 Tools runtime 的串行操作入口，在 SQLite 事务内切换唯一运行项。新增 migration 25 保存独立任务，现有番茄数据不改写。备份合并保留删除标记，重复合并幂等，导入运行项暂停。界面使用现有 Quiet Pro 控件，名称和休息模式等宽，参数浮层宽 260px，数值输入宽 96px。固定时长和比例时长使用直接可选的两行，单位位于输入框内。

固定休息为 1–120 分钟；比例为专注时长除以 1–20，最短 1 秒。结束本段后等待用户启动休息；休息到期保留本段时长并等待下一次专注。改名保留进度，休息设置仅影响下次准备的休息。通知使用任务版本拒绝过期启动。

- [x] 类型、持久化与事务互斥
- [x] 创建、编辑、通知与多语言
- [x] 计时边界、重复操作、备份与升级测试
- [x] 浏览器交互与隔离桌面验证
- [x] 默认门禁、依赖兼容性与体积检查

`pnpm run check:full` 通过，覆盖类型、ESLint、本地化、IPC、架构、复杂度、样式债务、测试登记、风险域覆盖率、变异测试、完整浏览器回归、构建、体积、Rust 和依赖审计。Rust 单元测试 923 项通过、8 项按既有登记忽略，另有原生探测集成测试和 9 项测试通过。JS 依赖审计为零告警；Rust 审计保留 4 项已验证在 Windows 不可达的精确锁文件例外。

Tools engine 的使用提醒调度与通知合并到同一业务 owner，依赖 owner 数量降至 2。删除失效文案和样式、合并专注通知组件、简化时间选择器并共享懒加载操作图标后，总 JS/CSS gzip 为 397.49 KiB，QuietTimePicker 为 1.96 KiB，support chunks 为 4.16 KiB；原有预算未调整。提醒表单的旧比例断言同步为已确认的日期与重复控件等宽布局。

依赖修复升级 glob/minimatch 及 ExcelJS 的归档依赖链。ExcelJS 4.4.0 的 `StreamBuf.pipe()` 补齐目的流返回值，以兼容 Archiver 7；上游修复该接口后可移除补丁。依赖测试覆盖真实归档匹配、覆盖率遍历、取消操作及普通和流式 XLSX 写入回读。

隔离桌面已验证自由专注的正计时、暂停与改名、重启保留进度、待启动休息、休息到期、过期通知拒绝、跨模式互斥及 migration 25。启动专项验证恢复完成后才运行提醒调度，离线时间不计入本轮使用时长。

完整桌面入口的 contracts、data-recovery、storage-restart、tools-startup、webview-recovery、window-lifecycle 六组通过；mini-input 在 `SetPhysicalCursorPos` 返回失败后报 `Cannot move to owned input target`，未取得鼠标交互验收证据。保留该失败，不放宽断言或反复注入输入。后续由桌面验收 owner 在可用输入环境重跑 mini-input；当前不宣称完整桌面验收通过。对应隔离记录保存在忽略目录 `artifacts/runtime-smoke/1793716194795-967ee95f-e0c4-4c80-a67b-1eddecd1bc79/result.json`。

此次交付包含全部已授权的工作区更改，按功能、依赖修复、测试和文档分组提交。不操作用户数据库，不代表安装包、ARM64 或正式发布验收。
