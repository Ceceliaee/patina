# 提醒时间直接选择的体积归属

提醒时间入口直接显示日历和时间列，取消中间输入浮层。Tools 组合共享 `QuietCalendar` 与 `QuietTimeColumns`；后者与独立 `QuietTimePicker` 共用时间选项、滚动定位和键盘行为。`QuietDatePicker` 仅剩 Destination detail 消费，构建器将它合入该懒加载页面，原 support 归属随之消失。

## 测量与边界

使用相同锁文件、Node 24.22.1、Vite 8.2.4 和预算脚本的默认 gzip。前候选及发布重建记录来自[标准选择器决策](2026-11-01-reminder-standard-controls-bundle-decision.md)。这些是前端构建数据，不是桌面启动耗时或发布安装包测量。

| KiB gzip | 前候选 | 当前候选 |
| --- | ---: | ---: |
| Destination detail | 7.49 | 8.92 |
| 未归属 lazy support | 6.02 | 4.16 |
| QuietTimePicker | 1.95 | 1.98 |
| Tools | 11.89 | 12.09 |
| 全部 JS/CSS | 396.92 | 396.92 |
| 初始 JS/CSS | 201.34 | 201.46 |

Destination detail 增加约 1.43 KiB（19.1%），support 减少约 1.86 KiB（30.9%）。总量基本持平；新增组合样式使初始图增加约 0.12 KiB（0.06%）。v1.9.11 重建总量记录为 384.91 KiB，当前较它增加约 12.01 KiB（3.12%），包含此前提醒能力；该发布记录没有单独的 Destination detail 数值。

未增加依赖或修改 manual chunks。单日期控制器仍在详情首次打开时懒加载，日历主体和时间列仍共享。强行把唯一消费者的控制器拆成独立 chunk 只会改变归属与请求数；在 Tools 保留不用的输入组件会违背此次交互要求。日期与时间算法不在 feature 内复制，新的组合不进入启动 JS。

## 有限调整

- Destination detail 上限从 8.1 调整为 9.25 KiB，增加 1.15 KiB（14.2%）；相对实测值缓冲约 3.6%。
- support 上限从 6.55 收紧为 4.36 KiB，减少 2.19 KiB（33.4%）；相对实测值缓冲约 4.8%。
- 两项上限合计收紧 1.04 KiB。总量、初始图、其他页面和共享组件上限保持不变，继续执行 3% headroom。

最终生产构建和 bundle 检查通过。此项不改变发布或依赖安全验收责任。
