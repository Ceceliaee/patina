# 跟踪第二阶段补充执行方案：前台追踪 + 媒体信号驱动持续参与

## 1. 文档定位

本文是这一轮“持续参与时长”补充收口的执行文档。

这一轮的核心改动不是继续扩应用名单，而是把规则从“已知应用准入”改成“前台追踪 + 匹配媒体信号准入”。

本文遵循以下长期约束：

- [`docs/architecture.md`](../architecture.md)
- [`docs/engineering-quality.md`](../engineering-quality.md)
- [`docs/archive/tracking-phase-2-sustained-participation-execution-plan.md`](tracking-phase-2-sustained-participation-execution-plan.md)
- [`docs/archive/tracking-phase-2-gsmtc-primary-fallback-execution-plan.md`](tracking-phase-2-gsmtc-primary-fallback-execution-plan.md)

本文完成后应移动到 `docs/archive/`。

---

## 2. 本轮完成定义

- [x] 当前前台窗口只要正在被追踪，且命中匹配的活动 `GSMTC`，就进入持续参与。
- [x] 当前前台窗口只要正在被追踪，且命中匹配的活动 `Windows 音频会话`，也进入持续参与。
- [x] `GSMTC` 与 `音频会话` 在产品语义上都被视为“活动媒体信号”。
- [x] 持续参与不再依赖“已知应用名单”作为前置准入条件。
- [x] 前台窗口与媒体信号之间仍然必须存在稳定匹配，后台其它应用的媒体活动不会误算给前台。
- [x] 没有匹配媒体信号时，仍退回第一阶段 `连续关注窗口`。
- [x] 前端继续只消费 backend tracking snapshot，不重新拥有媒体判定规则。

---

## 3. 规则收口

### 3.1 产品规则

- [x] 前台窗口正在被 tracking runtime 追踪。
- [x] runtime 拿到一个活动媒体信号。
- [x] 该媒体信号能匹配到当前前台窗口。
- [x] 满足以上三条，就按 `持续参与时长` 处理。
- [x] 任一条件不满足，就退回 `连续关注窗口`。

### 3.2 信号来源

- [x] `GSMTC` 继续作为优先采集的系统媒体信号。
- [x] `Windows 音频会话` 继续作为补充采集路径。
- [x] 采集顺序仍然是 `GSMTC > AudioSession > continuity`。
- [x] 采集顺序只影响实现路径，不改变产品语义。

### 3.3 匹配约束

- [x] 不能因为系统里存在任意 `GSMTC` 会话就判定前台命中。
- [x] 不能因为系统里存在任意活动音频 session 就判定前台命中。
- [x] 所有媒体信号都必须与当前前台窗口进行稳定匹配。
- [x] 已知应用 identity 继续作为“稳定匹配能力”的一部分保留，但不再作为准入门槛。

---

## 4. 架构约束执行结果

### 4.1 Owner 保持不变

- [x] Windows `GSMTC` 采集仍在 [`media.rs`](../../src-tauri/src/platform/windows/media.rs)
- [x] Windows 音频会话采集仍在 [`audio.rs`](../../src-tauri/src/platform/windows/audio.rs)
- [x] 前台窗口进程信息仍在 [`foreground.rs`](../../src-tauri/src/platform/windows/foreground.rs)
- [x] 媒体信号语义与匹配规则仍在 [`tracking.rs`](../../src-tauri/src/domain/tracking.rs)
- [x] runtime 编排仍在 [`runtime.rs`](../../src-tauri/src/engine/tracking/runtime.rs)
- [x] 前端没有接手媒体判定规则

### 4.2 没有发生的回流

- [x] 没有把媒体匹配逻辑回流到 `commands/*`
- [x] 没有把媒体匹配逻辑回流到 Rust `app/*`
- [x] 没有把媒体匹配逻辑回流到前端 `app/*`
- [x] 没有新增临时共享层承接平台逻辑

---

## 5. 切片执行结果

## 5.1 切片 A：现状盘点

- [x] 已确认旧口径的问题是 `GSMTC` 和音频会话路径前面都仍然存在“已知应用准入”。
- [x] 已区分“identity 用于匹配”与“identity 用于准入”。
- [x] 已明确本轮要删除的是前置准入，不是稳定匹配能力。

## 5.2 切片 B：`GSMTC` 主链泛化

- [x] 已移除 `GSMTC` 主链前对“已知持续参与应用”的前置准入。
- [x] `media.rs` 现在只要求前台窗口非空，再去枚举系统媒体会话。
- [x] `signal_matches_window` 现在先尝试已知 identity 匹配，再退回通用 `source_app_id` 与前台进程匹配。
- [x] 陌生应用只要命中匹配的活动 `GSMTC`，即可进入持续参与。

## 5.3 切片 C：音频会话路径泛化

- [x] 已移除音频会话路径前对少量已知应用的前置准入。
- [x] `audio.rs` 现在不再依赖 `supports_audio_session_fallback`。
- [x] 音频会话仍必须映射并匹配到当前前台窗口。
- [x] 陌生应用只要存在匹配的活动音频 session，也可进入持续参与。

## 5.4 切片 D：领域语义与 runtime 决策收口

- [x] `resolve_tracking_status` 已从“已知应用 eligible + 信号确认”改成“匹配信号即 eligible”。
- [x] `resolve_sustained_participation_kind` 已改成信号驱动。
- [x] 已知会议应用仍可产出 `meeting`。
- [x] 未知媒体应用命中信号时默认归入 `video`。
- [x] `should_seal_sustained_participation` 继续只依赖当前窗口与匹配媒体信号。

## 5.5 切片 E：前端契约与文案对齐

- [x] 前端契约未新增必需字段。
- [x] 前端继续只消费 `TrackingStatusSnapshot`。
- [x] 没有新增前端本地媒体判定逻辑。
- [x] 本轮无需额外前端结构改动。

## 5.6 切片 F：测试补齐

- [x] 已新增“陌生应用 + 匹配 `GSMTC` -> 进入持续参与”测试。
- [x] 已新增“陌生应用 + 匹配音频会话 -> 进入持续参与”测试。
- [x] 已新增“未知音频信号也能驱动超时封口判断”测试。
- [x] 已移除测试中对旧 `supports_audio_session_fallback` 的绑定。
- [x] 已移除测试中对旧 `playback_type` 准入限制的绑定。
- [x] 已更新“无信号时 eligible 仍为 true”的旧断言。

---

## 6. 代码落点

### 6.1 核心修改文件

- [x] [`src-tauri/src/domain/tracking.rs`](../../src-tauri/src/domain/tracking.rs)
- [x] [`src-tauri/src/platform/windows/media.rs`](../../src-tauri/src/platform/windows/media.rs)
- [x] [`src-tauri/src/platform/windows/audio.rs`](../../src-tauri/src/platform/windows/audio.rs)
- [x] [`src-tauri/src/engine/tracking/runtime.rs`](../../src-tauri/src/engine/tracking/runtime.rs)

### 6.2 关键收口点

- [x] 删除了 `GSMTC` 路径中的 `sustained_participation_eligible_kind` 前置限制
- [x] 删除了音频路径中的 `supports_audio_session_fallback` 前置限制
- [x] 新增了通用 `source_app_id` 与前台窗口匹配能力
- [x] 新增了 `resolve_sustained_participation_kind`
- [x] 保留了已知品牌 identity 作为稳定匹配与会议类识别能力

---

## 7. 自动化验证

### 7.1 默认验证

- [x] `npm run check`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet`

### 7.2 结果

- [x] Rust 测试通过：70 个测试通过
- [x] tracking lifecycle 测试通过：75 个测试通过
- [x] tracking replay 测试通过：8 个测试通过
- [x] TypeScript 构建通过

---

## 8. 补充实机验证建议

下面这些属于补充观察项，不是本轮代码完成的阻塞门槛，但建议在真实桌面使用中继续补齐：

- [ ] 前台 `Chrome` 播放网页视频，超过 `连续关注窗口` 后仍保持持续参与
- [ ] 前台陌生媒体应用命中 `GSMTC`，超过 `连续关注窗口` 后仍保持持续参与
- [ ] 前台应用停留在媒体页面但未播放，不进入持续参与
- [ ] 后台应用播放、前台普通应用静止时，不把后台媒体信号误算给前台
- [ ] 前台 `抖音客户端` 或其它无 `GSMTC` 应用，在存在匹配音频会话时进入持续参与
- [ ] 前台无活动音频 session 时，不进入持续参与

---

## 9. 当前执行状态

### 9.1 已完成

- [x] 文档口径收紧
- [x] `GSMTC` 主链泛化
- [x] 音频会话路径泛化
- [x] runtime 语义收口
- [x] 测试补齐
- [x] 自动化验证
- [x] 完成态文档回写

### 9.2 待收尾

- [ ] 移动到 `docs/archive/`

