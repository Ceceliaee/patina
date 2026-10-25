# 执行单：首装默认设置与分类颜色基线固化
Document Type: One-off Execution Plan

## 1. 背景

当前应用的两个默认面向还不够适合正式发布：

- `Settings` 默认值来自源码中的通用 `DEFAULT_SETTINGS`
- 内置分类的默认颜色分配仍可能通过运行时随机分配得到

这会带来一个发布期问题：

- 首次安装用户看到的默认设置与默认分类颜色，不一定与当前产品负责人已经调好的版本一致

本轮目标是：

- 将“当前这台机器上已调好的设置”和“当前认可的内置分类默认颜色”固化为发布版的首装默认基线
- 但不能破坏已有用户在更新后的个性化设置

也就是说，最终行为必须是：

- **首次安装**：使用这次固化后的默认设置与默认分类颜色
- **已有安装 / 后续更新**：继续尊重用户已经持久化的设置与颜色，不覆盖

## 2. 本轮目标

只处理“首装默认档案”收口：

- 将当前认可的默认设置固化为源码默认设置
- 将当前认可的内置分类默认颜色固化为确定性映射
- 保持已有用户持久化设置和分类颜色优先

完成后应达到：

- 新安装用户第一次进入应用时，看到的设置与分类默认色是稳定一致的
- 已有用户更新后，自己的设置与分类颜色不被覆盖
- 不再依赖运行时随机分配来决定内置分类的首装颜色

## 3. 范围

重点文件：

- `src/lib/settings-store.ts`
- `src/lib/categoryColorRegistry.ts`
- `src/lib/config/categoryTokens.ts`

建议新增：

- `src/lib/config/releaseDefaultProfile.ts`

如确有必要，允许少量补充：

- `src/shared/lib/settingsPersistenceAdapter.ts`
- `src/shared/lib/classificationPersistence.ts`
- `CHANGELOG.md`

## 4. 非目标

- 不把当前机器上的应用重命名、应用颜色覆盖、标题记录开关、统计开关等私有 app override 直接固化为软件默认值
- 不把自定义分类一起固化为首装默认
- 不扩展到 Rust / Tauri 架构改造
- 不新增复杂迁移系统
- 不重做 Settings / App Mapping UI

## 5. 核心要求

### 5.1 首装默认设置

- 用“当前认可的设置值”更新首装默认设置基线
- 这些默认值应进入稳定源码常量，而不是临时散落在页面逻辑里
- `DEFAULT_SETTINGS` 最终应反映本轮确认后的发布默认值

### 5.2 首装默认分类颜色

- 内置可分配分类的默认颜色必须改为确定性映射
- 不再让首装默认分类颜色依赖运行时随机分配
- `other` 继续保持固定色
- `system` 继续保持系统保留色
- 自定义分类仍可保留当前动态/后续分配策略，不属于本轮范围

### 5.3 已有用户不被覆盖

- 任何已有持久化设置都必须优先于新默认值
- 任何已有分类默认色分配或颜色 override 都必须优先于新默认值
- 更新后不能把已有用户改回“发布默认值”

### 5.4 当前机器基线的来源

本轮要固化的是“当前这台机器上你已经调好的基线”，不是拍脑袋重选一套新默认。

因此执行时应优先：

1. 从当前本机实际使用的数据源中提取：
   - 当前 settings 值
   - 当前内置分类默认颜色分配
2. 再将这些值转成源码中的发布默认档案

如果执行方无法可靠定位当前本机正在使用的数据源，应暂停并向用户确认，不要擅自凭感觉重配默认值。

## 6. 推荐实现方向

### 6.1 默认档案集中化

建议新增一个稳定配置文件，例如：

- `src/lib/config/releaseDefaultProfile.ts`

由它集中导出：

- `RELEASE_DEFAULT_SETTINGS`
- `RELEASE_DEFAULT_CATEGORY_COLOR_ASSIGNMENTS`

然后：

- `settings-store.ts` 中的 `DEFAULT_SETTINGS` 基于它导出
- `categoryColorRegistry.ts` 优先使用它提供的内置分类默认颜色映射

### 6.2 现有持久化优先级保持不变

应保留当前整体优先级：

1. 用户持久化 override / assignment
2. 发布默认档案
3. 极少数兜底 fallback

如果现有代码已经满足这个优先级，就不要为了“首装默认”再引入额外复杂写库逻辑。

### 6.3 不推荐的做法

不要这样做：

- 在升级时批量回写 settings 表覆盖现有值
- 把当前机器所有 app override 都硬编码进默认映射
- 继续保留内置分类随机配色，只是“碰巧这次随机看起来对”

## 7. 执行阶段

### 阶段 A：提取当前机器的目标基线

执行项：

- [x] 定位当前本机实际使用的数据源
- [x] 提取当前 settings 值
- [x] 提取当前内置分类默认颜色分配
- [x] 将本轮确认的默认档案写入本文档或提交说明中，作为后续实现依据

验收门槛：

- [x] 默认档案来源明确
- [x] 不是凭感觉重新选择默认值

本轮提取基线（来源：`%APPDATA%\com.timetracker\timetracker.db`，`settings` 表）：

- `settings`：
  - `afk_timeout_secs=180`
  - `refresh_interval_secs=3`
  - `min_session_secs=60`
  - `tracking_paused=false`（存储值 `0`）
  - `close_behavior=tray`
  - `minimize_behavior=taskbar`
  - `launch_at_login=true`（存储值 `1`）
  - `start_minimized=true`（存储值 `1`）
  - `onboarding_completed=true`（存储值 `1`）
- 内置分类默认颜色 assignment（`__category_default_color_assignment::*`）：
  - `ai=#3293C8`
  - `development=#4790CF`
  - `office=#6F7AE6`
  - `browser=#36AC7E`
  - `communication=#C56A73`
  - `meeting=#BE657D`
  - `video=#66955C`
  - `music=#3D9C6B`
  - `game=#B07E55`
  - `design=#8C6FA1`
  - `reading=#399CCB`
  - `finance=#9A8C52`
  - `utility=#35A69E`

排除项确认：

- `__category_color_override::*` 当前为空（不固化为发布默认）
- 未发现自定义分类（不纳入发布默认）
- app override、历史数据均不纳入发布默认

### 阶段 B：固化源码默认设置

执行项：

- [x] 将确认后的 settings 默认值固化到稳定源码配置
- [x] `DEFAULT_SETTINGS` 改为引用本轮确认后的发布默认值
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 新安装用户首次读取 settings 时，会得到本轮固化值
- [x] 现有持久化 settings 优先级不变

### 阶段 C：固化内置分类默认颜色

执行项：

- [x] 将确认后的内置分类颜色映射固化到稳定源码配置
- [x] `CategoryColorRegistry` 优先使用该映射，而不是对内置分类做随机首配
- [x] 保持已有持久化 assignment / override 优先
- [x] 阶段 C 完成后运行 `npm run build`

验收门槛：

- [x] 新安装用户第一次看到的内置分类颜色稳定一致
- [x] 已有用户现有颜色不被覆盖

### 阶段 D：收尾与发布对齐

执行项：

- [x] 复核首装与升级语义没有冲突
- [ ] 如有必要，在 `CHANGELOG.md` 中补一条“首装默认档案固化”
- [x] 更新本文档勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

- [x] 当前认可的 settings 默认值已固化到源码默认档案
- [x] 当前认可的内置分类默认色已固化为确定性映射
- [x] 首装默认不再依赖随机分类配色
- [x] 已有用户更新后不会被覆盖回默认值
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 严格限定在“首装默认档案固化”
- 先从当前本机实际数据源提取目标默认值，再写源码
- 不要把个人 app override、自定义分类、历史数据一起硬编码成默认
- 不要通过升级覆盖已有用户数据
- 优先使用集中默认档案配置，不要散落多个硬编码默认值
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文档属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不长期留在顶层 `docs/`。
