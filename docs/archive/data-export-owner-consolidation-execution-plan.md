# 数据导出 Owner 收口执行方案

## 0. 文档定位

本文是一次性执行方案，不是长期规范。

目标是把数据导出前端、样式和共享组件归回正确 owner，消除当前这些边界异味：

- `src/features/export` 作为独立前端 feature 存在，但产品入口实际在 Settings / 存储 / 数据安全中。
- `src/styles/features/export.css` 作为独立 feature 样式存在，但没有对应长期页面 feature。
- `src/styles/shared/range-picker.css` 作为未定义 CSS owner 存在，不在当前 Quiet Pro 样式归属模型内。
- 导出字段清单同时散落在前端 platform gateway 与 Rust export engine，存在契约漂移风险。
- 局部 UI 迭代让 `src/styles/quiet-pro.css` 增长并触发 hotspot 预算失败。

本文完成后应归档到 `docs/archive/`，不长期停留在 `docs/working/`。

## 1. 第一性原理

### 1.1 Feature 不是按名词建目录

前端 `features/*` 表示产品表面或能力闭环 owner。

一个目录能成为 feature，至少要满足：

- 有独立的产品入口或长期信息架构位置。
- 有自己的 UI 状态、服务和测试闭环。
- 不是为了让某个弹窗或局部流程“看起来独立”而拆出来。

数据导出当前不是导航一级页面，也不是独立工作台。它是 Settings 中“存储 / 数据安全”的一个本地数据控制动作。因此前端 UI owner 应归 Settings，而不是 `features/export`。

### 1.2 执行引擎与入口 UI 可以不是同一个 owner

Rust `engine/export` 是合理 owner，因为它拥有真实导出行为：

- CSV / SQLite / Parquet 写出。
- 时间范围过滤。
- 字段校验。
- 分类规则计算。
- 文件替换与原子写入。

Settings 只拥有“用户如何发起导出”的 UI 编排，不拥有导出引擎。

### 1.3 Platform gateway 只拥有边界，不拥有 UI 语义

`src/platform/persistence/dataExportGateway.ts` 应只负责：

- 调用 Tauri command。
- 定义 IPC 请求 / 响应类型。
- 解析或映射来自 Rust 的边界数据。

它不应长期拥有：

- 字段分组标题。
- 默认 UI 字段组。
- 字段配置弹窗的展示顺序。
- Settings 页面的偏好记忆规则。

### 1.4 Shared 只能放稳定共享能力

`QuietDateRangePicker` 同时服务 Data 页和 Settings 数据导出弹窗，因此它可以是 shared component。

但 `src/styles/shared` 不是当前文档定义过的样式 owner。当前样式 owner 只有：

- `src/styles/tokens.css`
- `src/styles/quiet-pro.css`
- `src/styles/app-shell.css`
- `src/styles/features/*`

所以共享组件样式只有两个合法落点：

- 稳定 Quiet Pro 组件原型：进入 `src/styles/quiet-pro.css`。
- 某个 feature 私有样式：进入对应 `src/styles/features/*.css`。

`src/styles/shared/range-picker.css` 应删除。

### 1.5 样式 owner 必须跟组件 owner 对齐

如果组件属于 Settings，样式应在 `settings.css`，并使用 `settings-*` 前缀。

如果组件属于 shared Quiet Pro，样式应在 `quiet-pro.css`，并使用 `qp-*` 前缀。

如果 Export 不是前端 feature，就不应存在 `styles/features/export.css`。

### 1.6 验证不是附属动作

这次任务是结构收口，不是单点 UI 修补。验收不能只看页面可见效果，必须验证：

- 目录 owner 收敛。
- 样式 owner 收敛。
- 架构边界检查通过。
- hotspot 预算恢复通过或有明确、刻意的预算调整。
- 导出功能仍能执行。

## 2. 当前状态审计

### 2.1 前端目录

- [x] 确认 `src/features/export/components/Export.tsx` 只被 Settings 使用。
- [x] 确认 `src/features/export/components/ExportFieldConfigDialog.tsx` 只被数据导出弹窗使用。
- [x] 确认 `src/features/export/services/exportService.ts` 只是 platform gateway 转发壳。
- [x] 确认 `src/features/export/services/exportRange.ts` 是导出弹窗私有时间范围逻辑。
- [x] 确认 `src/features/export/services/exportPreferenceStorage.ts` 是导出弹窗私有偏好记忆。

### 2.2 样式目录

- [x] 确认 `src/styles/features/export.css` 只服务数据导出弹窗和字段配置弹窗。
- [x] 确认 `src/styles/shared/range-picker.css` 只服务 `QuietDateRangePicker`。
- [x] 确认 `src/styles/features/data.css` 中仍有旧的 `.data-range-picker*` 局部日历样式。
- [x] 确认 `src/App.css` 当前导入了 `./styles/features/export.css` 和 `./styles/shared/range-picker.css`。

### 2.3 共享组件

- [x] 确认 `src/shared/components/QuietDateRangePicker.tsx` 被 Data 和数据导出弹窗使用。
- [x] 确认 `src/shared/components/QuietDialog.tsx` 的 `headerAside` 是否只为数据导出字段弹窗新增。
- [x] 确认 `src/styles/quiet-pro.css` 的新增 header aside 样式是否导致 hotspot 预算失败。

### 2.4 IPC 与 Rust

- [x] 确认 Rust `src-tauri/src/engine/export/*` 是导出执行 owner。
- [x] 确认 `src-tauri/src/commands/export.rs` 只做 command 边界。
- [x] 确认 `src/platform/persistence/dataExportGateway.ts` 中字段常量是否与 Rust `ALL_EXPORT_FIELDS` / `DEFAULT_EXPORT_FIELDS` 重复。

## 3. 目标 Owner 映射

| 当前对象 | 目标 owner | 目标位置 | 处理方式 |
| --- | --- | --- | --- |
| `src/features/export/components/Export.tsx` | Settings 数据安全 UI | `src/features/settings/components/SettingsDataExportDialog.tsx` | 移动并改名 |
| `src/features/export/components/ExportFieldConfigDialog.tsx` | Settings 数据安全 UI | `src/features/settings/components/SettingsDataExportFieldConfigDialog.tsx` | 移动并改名 |
| `src/features/export/services/exportRange.ts` | Settings 数据导出流程 | `src/features/settings/services/settingsDataExportRange.ts` | 移动并改名 |
| `src/features/export/services/exportPreferenceStorage.ts` | Settings 数据导出流程 | `src/features/settings/services/settingsDataExportPreferences.ts` | 移动并改名 |
| `src/features/export/services/exportService.ts` | 无真实 owner | 删除 | 由 settings service 直接依赖 platform gateway |
| `src/features/export/` | 无长期 owner | 删除目录 | 全部迁走后删除 |
| `src/styles/features/export.css` | Settings 样式 | `src/styles/features/settings.css` | 合并并重命名 class |
| `.export-*` class | Settings 数据导出样式 | `.settings-data-export-*` | 全量替换 |
| `src/styles/shared/range-picker.css` | Quiet Pro 共享组件样式 | `src/styles/quiet-pro.css` | 移入或用已有 Quiet Pro class 承接，然后删除目录 |
| `.qp-range-picker*` | Quiet Pro 共享组件原型 | `src/styles/quiet-pro.css` | 保留 `qp-*` 语义 |
| `.data-range-picker*` | Data 私有兼容样式 | `src/styles/features/data.css` | 删除重复样式，仅保留必要 feature 微调或更新测试选择器 |
| `QuietDateRangePicker.tsx` | Shared component | `src/shared/components/QuietDateRangePicker.tsx` | 保留 |
| `QuietDialog.headerAside` | 待重新判断 | 优先删除；必要时保留在 `QuietDialog` | 如果只为数据导出使用，撤回共享扩展 |
| Export field IDs | Rust export engine | `src-tauri/src/engine/export/common.rs` | 作为执行与校验源头 |
| Export field manifest IPC | Platform gateway | `src/platform/persistence/dataExportGateway.ts` | 只暴露来自 Rust 的 manifest |
| Export field UI labels | Copy domain | `src/shared/copy/domains/exportCopy.ts` | 保留文案，不作为行为 owner |

## 4. 非目标

- [x] 不改变 CSV / SQLite / Parquet 导出结果语义。
- [x] 不改变分类“按当前规则计算”的约定。
- [x] 不把数据导出做成独立导航页面。
- [x] 不引入新的 `shared` 样式目录。
- [x] 不为了目录好看大规模重写 Settings。
- [x] 不触碰 README 中已有的无关本地改动。
- [x] 不推送到仓库，除非后续明确要求。

## 5. 执行阶段

### Phase 1：建立迁移保护线

- [x] 运行 `git status --short`，记录所有已有改动。
- [x] 标记不属于本任务的文件，例如 `README.md`、`README.zh-CN.md`，本任务不修改。
- [x] 运行 `rg -n "features/export|styles/features/export|styles/shared|range-picker|QuietDateRangePicker|export-dialog|export-field"` 建立迁移前引用清单。
- [x] 运行 `npm run check:architecture`，确认当前硬边界基线。
- [x] 运行 `npm run check:hotspots`，记录当前失败点。
- [x] 运行 `npm run check:types`，确认迁移前类型基线。
- [x] 如任一基线失败，记录失败，不在迁移中混入无关修复。

### Phase 2：迁移 Settings 数据导出组件

- [x] 新建 `src/features/settings/components/SettingsDataExportDialog.tsx`。
- [x] 将 `src/features/export/components/Export.tsx` 内容迁入。
- [x] 将组件名从 `Export` 改为 `SettingsDataExportDialog`。
- [x] 将 props 保持为 `open`、`onClose`、`onToast`，避免扩大 Settings 状态。
- [x] 将导入路径从 `../services/exportRange.ts` 改为 Settings service 新路径。
- [x] 将 `ExportFieldConfigDialog` 引用改为 `SettingsDataExportFieldConfigDialog`。
- [x] 新建 `src/features/settings/components/SettingsDataExportFieldConfigDialog.tsx`。
- [x] 将 `src/features/export/components/ExportFieldConfigDialog.tsx` 内容迁入。
- [x] 将组件名改为 `SettingsDataExportFieldConfigDialog`。
- [x] 保留拖拽、分组折叠、全选、恢复默认排序、空字段禁用导出等行为。
- [x] 更新 `src/features/settings/components/Settings.tsx`，改为从 Settings components 内部导入数据导出弹窗。
- [x] 确认 `SettingsDataSafetyPanel` 仍只负责展示“数据导出”入口，不直接承接导出流程细节。

### Phase 3：迁移 Settings 数据导出服务

- [x] 新建 `src/features/settings/services/settingsDataExportRange.ts`。
- [x] 将 `src/features/export/services/exportRange.ts` 内容迁入。
- [x] 将类型名前缀从 `ExportRange*` 保持或改为 `SettingsDataExportRange*`。
- [x] 如果保持 `ExportRange*`，确认它们只在 Settings 数据导出路径内使用。
- [x] 新建 `src/features/settings/services/settingsDataExportPreferences.ts`。
- [x] 将 `src/features/export/services/exportPreferenceStorage.ts` 内容迁入。
- [x] 保留首装默认范围为 `month`。
- [x] 保留首装默认格式为 `csv`。
- [x] 保留 localStorage 读写失败不阻塞导出流程的策略。
- [x] 删除 `src/features/export/services/exportService.ts`。
- [x] 在 Settings 数据导出 service 或 component 中直接使用 `src/platform/persistence/dataExportGateway.ts` 的 typed gateway。
- [x] 确认没有 Settings component 直接 import Tauri API。

### Phase 4：收口导出字段契约

推荐方案：Rust engine 作为字段 manifest 源头，前端通过 IPC 读取。

- [x] 在 `src-tauri/src/engine/export/common.rs` 中定义导出字段 manifest 数据结构。
- [x] manifest 至少包含字段 `key`、`group`、`default_selected`、`order`。
- [x] Rust manifest 必须复用现有 `DEFAULT_EXPORT_FIELDS` 和 `ALL_EXPORT_FIELDS`，避免第三份字段清单。
- [x] 在 Rust tests 中增加断言：manifest 的所有字段都能被 `resolve_export_fields` 接受。
- [x] 在 `src-tauri/src/commands/export.rs` 增加薄 command，例如 `cmd_get_export_field_manifest`。
- [x] 在 `src-tauri/src/app/bootstrap.rs` 注册新 command。
- [x] 在 `src/platform/persistence/dataExportGateway.ts` 增加 `getExportFieldManifest()`。
- [x] `dataExportGateway.ts` 只保留 IPC 类型、manifest DTO 和 invoke，不保留 UI 字段分组常量。
- [x] Settings 字段弹窗从 manifest 渲染字段组。
- [x] 字段 label / description 仍从 `UI_TEXT.export.fields` 取，缺失文案时显示字段 key 或禁用该字段并记录风险。
- [x] 如果本轮不做 manifest command，必须增加前端测试或脚本，显式校验 TS 字段常量与 Rust 字段常量同步；但这是次优方案，只能作为短期保护。

### Phase 5：删除前端 `features/export`

- [x] 更新所有 imports，确保没有任何文件引用 `src/features/export`。
- [x] 运行 `rg -n "features/export|../export|../../export" src tests docs`。
- [x] 删除 `src/features/export/components/Export.tsx`。
- [x] 删除 `src/features/export/components/ExportFieldConfigDialog.tsx`。
- [x] 删除 `src/features/export/services/exportRange.ts`。
- [x] 删除 `src/features/export/services/exportPreferenceStorage.ts`。
- [x] 删除 `src/features/export/services/exportService.ts`。
- [x] 删除空目录 `src/features/export`。
- [x] 更新 `tests/exportRange.test.ts` 的 import 到 Settings service 新路径。
- [x] 如测试名仍叫 `exportRange.test.ts`，保留；测试名表达行为，不强制表达 owner。

### Phase 6：收口 export 样式到 Settings

- [x] 将 `src/styles/features/export.css` 内容迁入 `src/styles/features/settings.css`。
- [x] 所有 `.export-dialog-*` 改名为 `.settings-data-export-dialog-*`。
- [x] 所有 `.export-section*` 改名为 `.settings-data-export-section*`。
- [x] 所有 `.export-result*` 改名为 `.settings-data-export-result*`。
- [x] 所有 `.export-field-*` 改名为 `.settings-data-export-field-*`。
- [x] 更新 Settings 数据导出组件中的 className。
- [x] 删除 `src/styles/features/export.css`。
- [x] 从 `src/App.css` 删除 `@import "./styles/features/export.css";`。
- [x] 运行 `rg -n "export-dialog|export-section|export-result|export-field|styles/features/export|features/export.css" src tests docs`。
- [x] 保留 copy key 中的 `export` 语义，不因为 class 重命名改文案域。

### Phase 7：删除 `src/styles/shared`

- [x] 将 `src/styles/shared/range-picker.css` 中 `.qp-range-picker*` 规则迁入 `src/styles/quiet-pro.css` 的共享组件区。
- [x] 在迁入前先评估 `quiet-pro.css` 当前 hotspot 预算。
- [x] 如果 `QuietDialog.headerAside` 只是为数据导出字段弹窗服务，先移除 `headerAside` API 和相关 CSS，释放预算。
- [x] 字段数量 summary 改为数据导出字段弹窗内部布局，不要求 `QuietDialog` 支持通用 aside。
- [x] 删除 `src/styles/shared/range-picker.css`。
- [x] 删除空目录 `src/styles/shared`。
- [x] 从 `src/App.css` 删除 `@import "./styles/shared/range-picker.css";`。
- [x] 确认 `QuietDateRangePicker` 仍使用 `.qp-range-picker*` class。
- [x] 删除 `src/styles/features/data.css` 中与 `.data-range-picker*` 重复的日历主体样式。
- [x] 如果浏览器 smoke 依赖 `.data-range-picker` 选择器，改为 `.qp-range-picker` 或给 `DataTrendRangePicker` 保留最小 class 作为测试钩子，不重复样式。
- [x] 运行 `rg -n "styles/shared|shared/range-picker|data-range-picker"`，确认只剩合理测试钩子或没有残留。

### Phase 8：修复 Quiet Pro hotspot

- [x] 运行 `npm run check:hotspots`。
- [x] 如果仍失败，先删除不必要的共享扩展，而不是直接调高预算。
- [x] 如果 range picker 作为稳定 shared component 导致 `quiet-pro.css` 合理增长，更新 `scripts/check-quality-hotspot-baseline.ts` 预算。
- [x] 更新预算时必须在提交说明或执行记录中写明理由：`QuietDateRangePicker` 是 Data 与 Settings 共用的 Quiet Pro component prototype。
- [x] 不允许为了让检查通过而把共享组件样式塞回 `src/styles/shared`。

### Phase 9：更新测试与自动化

- [x] 更新 `tests/exportRange.test.ts` imports。
- [x] 如新增 Rust manifest command，补 Rust 单元测试。
- [x] 如新增 platform manifest parser，补前端测试。
- [x] 更新 UI smoke 中依赖 `.data-range-picker` 的选择器。
- [x] 增加或调整 smoke 断言：Settings 中数据导出入口仍存在。
- [x] 增加或调整 smoke 断言：数据导出弹窗能打开。
- [x] 增加或调整 smoke 断言：字段配置弹窗能打开且空字段禁用确认或导出。
- [x] 增加或调整 smoke 断言：默认导出格式为 CSV。
- [x] 确认不会新增对 `src/features/export` 的引用。

### Phase 10：验证命令

按顺序执行：

- [x] `npm run check:types`
- [x] `npm run test:export`
- [x] `npm run test:ui-smoke`
- [x] `npm run check:architecture`
- [x] `npm run check:naming`
- [x] `npm run check:hotspots`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml export --quiet`
- [x] `npm run build`

如果涉及 manifest command 或 Rust exporter 字段逻辑，还应执行：

- [x] `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
- [x] `npm run check:rust`

如果时间允许，最终执行：

- [x] `npm run check`

## 6. 手动验收清单

### 6.1 Settings / 存储页面

- [x] Settings 页面能正常打开。
- [x] 存储区域显示三块：数据导出、备份与恢复、本机目录。
- [x] 数据导出块没有图标噪音。
- [x] 点击数据导出按钮打开数据导出弹窗。

### 6.2 数据导出弹窗

- [x] 默认范围为本月。
- [x] 默认格式为 CSV。
- [x] 格式选择在配置字段行之后，并位于右侧。
- [x] 点击导出直接打开系统保存文件选择器。
- [x] 取消保存文件选择器后弹窗不报错。
- [x] 导出中按钮进入 loading 状态。
- [x] 导出成功显示 toast。
- [x] 导出失败显示 warning toast。

### 6.3 时间范围

- [x] 中间按钮打开和 Data 页一致的日期范围选择器。
- [x] 外层模式是本日、本周、本月、本年。
- [x] 弹出日历内仍有自定义、一周、一月、一年模式。
- [x] 左右按钮在外层切换本日、本周、本月、本年。
- [x] 打开日历后左右按钮切换日历内部模式。
- [x] 不允许选择未来日期。
- [x] 自定义范围开始/结束顺序错误时给出错误状态。

### 6.4 字段配置弹窗

- [x] 弹窗高度不压迫，底部按钮固定可见。
- [x] 字段数量 summary 在右上角下对齐。
- [x] 默认字段展开，分析字段和高级字段默认折叠。
- [x] 分组按钮有全选/取消全选、恢复默认排序、折叠/展开。
- [x] 图标语义正确：已全选显示勾选方框，点击后取消选择。
- [x] tooltip 使用 Quiet Pro 样式，文案不包含“本组”或“分组”。
- [x] 字段行高度和用户确认后的视觉一致。
- [x] 拖拽时行被抬起，原位置变弱，插入线为 2px 细虚线。
- [x] 放手后字段进入目标位置。
- [x] 取消不保存字段变化。
- [x] 确认保存字段变化。
- [x] 全部字段取消后导出按钮禁用。

### 6.5 Data 页范围选择器

- [x] Data 页趋势范围选择器仍能打开。
- [x] Data 页原有近 7 天、一周、一月、一年交互不回归。
- [x] Data 页浏览器 smoke 通过。

## 7. 风险与处理

### 7.1 风险：移动组件导致 import 爆炸

处理：

- [x] 先移动组件，再逐个修 import。
- [x] 每完成一个 phase 运行 `npm run check:types`。
- [x] 不在同一 phase 顺手改 UI 行为。

### 7.2 风险：字段 manifest 异步加载影响弹窗首屏

处理：

- [x] 弹窗打开时加载 manifest。
- [x] manifest 加载中禁用字段配置按钮或显示低噪音 loading。
- [x] 加载失败时显示 warning toast，并禁止导出，避免字段契约不明时写出错误文件。

### 7.3 风险：测试依赖旧 CSS selector

处理：

- [x] UI 功能测试优先查询语义或 `qp-*` 稳定组件 class。
- [x] 如果必须保留 feature selector，只保留空样式测试钩子，不复制整套视觉规则。

### 7.4 风险：Quiet Pro 共享样式继续膨胀

处理：

- [x] 删除只服务数据导出的 `QuietDialog.headerAside` 扩展。
- [x] 移除 Data 页旧日历重复样式。
- [x] 仅当 range picker 被确认是稳定共享组件时，才允许进入 `quiet-pro.css`。
- [x] 若需要提高 hotspot budget，必须把理由写进执行记录。

### 7.5 风险：文案 owner 误判

处理：

- [x] `UI_TEXT.export` 可保留，因为 copy domain 可以表达产品能力，不等于前端 feature owner。
- [x] 不为了目录统一强行把所有导出文案塞进 `settingsCopy`。
- [x] 如果后续决定 copy domain 必须镜像 feature，再另开小任务迁移。

## 8. 完成定义

本任务只有同时满足以下条件才算完成：

- [x] `src/features/export` 不存在。
- [x] `src/styles/features/export.css` 不存在。
- [x] `src/styles/shared` 不存在。
- [x] `src/App.css` 不再导入 export feature CSS 或 shared range-picker CSS。
- [x] Settings 数据导出 UI 位于 `src/features/settings/components`。
- [x] Settings 数据导出状态与偏好逻辑位于 `src/features/settings/services`。
- [x] `src/platform/persistence/dataExportGateway.ts` 不再承载字段 UI 分组语义。
- [x] Rust export engine 仍是字段校验与导出执行 source of truth。
- [x] Data 页和 Settings 数据导出共用的 date range picker 有清楚 shared component owner。
- [x] `npm run check:hotspots` 通过，或预算调整有明确记录。
- [x] 所有 Phase 10 验证命令通过，未通过项有明确解释。
- [x] 本文档勾选完成并移动到 `docs/archive/`。

## 9. 归档步骤

- [x] 完成所有代码迁移与验证。
- [x] 将本文所有已完成步骤勾选。
- [x] 如有实际执行偏差，在本文新增“执行偏差记录”小节。
- [x] 移动本文到 `docs/archive/data-export-owner-consolidation-execution-plan.md`。
- [x] 确认 `docs/working/` 不保留已完成的一次性方案。

## 10. 执行偏差记录

- [x] Phase 4 未新增 `cmd_get_export_field_manifest` IPC。命名边界检查要求后端 snake_case 协议字段只停留在 platform/Rust 边界，因此实际方案改为：Rust `DEFAULT_EXPORT_FIELDS` / `ALL_EXPORT_FIELDS` 继续作为执行校验源头，`src/platform/persistence/dataExportGateway.ts` 只保留导出协议字段清单与 invoke，Settings 只引用协议清单并定义 UI 分组，不直接书写 raw field。
- [x] 为替代 manifest IPC 的漂移风险，新增 `tests/exportFieldContract.test.ts`，并接入 `npm run test:export`，自动校验前端协议字段清单与 Rust `common.rs` 的默认字段和允许字段完全一致。
- [x] `npm run check` 首次在沙箱中因 Vite/esbuild `spawn EPERM` 中断；按权限规则提权后完整通过。
- [x] `test:ui-browser-smoke` 暴露一处既有 smoke 假设冲突：产品会恢复上次主视图，但测试 reload 后直接查 Dashboard。已改为 reload 后显式回到“今天”再验证 hourly category mode。

## 11. 最终验证记录

- [x] `npm run test:export` 通过，包含导出时间范围测试和 TS/Rust 字段契约对表测试。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml export --quiet` 通过。
- [x] `npm run check` 通过。
- [x] `npm run check:rust` 通过。
