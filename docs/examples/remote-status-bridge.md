# 远程推送使用文档

本指南帮助用户把 Patina 当前状态推送到自己的接收端，并确认连接是否工作。它不传历史记录，不是数据库同步。开发接收端请查[协议参考](./remote-status-protocol.md)；部署示例请查 [Worker README](./remote-status-bridge-worker/README.md)。

[适用范围](#1-功能定位) · [公开留存](#公开展示与留存) · [部署配置](#部署示例接收端) · [确认成功](#确认连接与快照) · [排障](#13-排障)

## 公开展示与留存

**此示例用于公开状态展示。** Token 只保护 `/ws` 上传鉴权；`/state` 无读取鉴权且允许跨域读取。最新状态包含机器标识、应用名称、图标与时间戳。关闭 Patina 推送或断开连接不会删除远端状态，离线标记也不是删除；示例没有自动过期删除或清理接口。仅供自己读取的需求需要另行实现读取鉴权；需要删除留存数据时，应通过 Cloudflare 的存储管理能力处理并核实结果。

示例使用 Durable Object 持久化每台机器的最新状态，并在实例恢复时读取；不保存历史序列，不使用独立 D1 或 KV。部署前需要可部署 Worker 和 Durable Object 的 Cloudflare 账号，账号权限、服务限制与费用以所用账号为准。

<a id="1-功能定位"></a>

## 功能定位

远程推送把本机当前追踪状态发到用户自己的 `WebSocket` 服务，比如 Cloudflare Worker。

这条链路只发当前状态，不发历史记录，也不直接接入远端数据库。本项目只负责 `Windows -> Worker` 这一段。Worker 后面要怎么转发到网页或别的展示系统，由 Worker 项目自己处理。

它不会替代现有能力：

- 网页记录仍通过本机 HTTP 浏览器桥接链路处理。
- 本地 SQLite 仍是 Patina 历史记录、设置、备份和恢复的主数据源。

<a id="2-适用场景"></a>

## 适用场景

适合这些场景：

- 在公网屏幕上只读展示当前正在使用的应用。
- 多台 Windows 机器分别推送状态，由同一个 Worker 汇总后展示。
- 希望外部系统只知道当前状态，不拿到本地历史记录。

它不解决这些问题：

- 同步历史时间记录。
- 跨设备合并本地数据库。
- 远端恢复、补历史或做团队报表。

<a id="3-开启方式"></a>

## 开启方式

入口在 `设置 -> 服务 -> 远程推送`。

需要填写：

- `接收地址`：Worker `WebSocket` 地址，格式通常是 `wss://<your-worker-host>/ws`。
- `Token`：Patina 连接 Worker 时发送的鉴权值。
- `本机标识`：Patina 自动生成并持久化，用来区分不同机器。

启用规则：

- 开关默认关闭。
- `接收地址` 为空时不会连接。
- `Token` 为空时不会连接。
- 保存设置后，Patina 会关闭旧连接并按新配置重连。
- `本机标识` 由 Rust 启动时生成并保存，设置页只读展示。

## 部署示例接收端

确认上述公开展示边界符合需求后，可使用一键部署；手动部署和本地开发见 [Worker README](./remote-status-bridge-worker/README.md)。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Ceceliaee/patina/tree/main/docs/examples/remote-status-bridge-worker)

快速部署：

1. 点击 `Deploy to Cloudflare`。
2. 在部署页填写 `REMOTE_STATUS_BRIDGE_TOKEN`。
3. 部署完成后记下 Worker 域名。
4. 打开 Patina `设置 -> 服务 -> 远程推送`。
5. 填写接收地址：`wss://<your-worker-host>/ws`。
6. 填写和 Worker 相同的 `Token`。
7. 打开远程推送开关并保存。

## 确认连接与快照

保存设置后，从示例的 `/state` 查询本机标识，观察 `lastReceivedAtMs` 是否随新快照更新；[响应示例](./remote-status-bridge-worker/README.md#122-http-路由示例)说明字段。只看机器列表非空或 WebSocket 升级成功都不足以确认当前连接，因为远端可能保留旧状态。

关闭开关会停止推送，远端状态仍按[留存规则](#公开展示与留存)保存。配置完整但没有新快照时，按下节区分地址、鉴权和状态更新问题。

<a id="13-排障"></a>

## 排障

开关打开后 Worker 没收到连接：

- 检查 `接收地址` 是否为空。
- 检查地址是否使用 `wss://`。
- 检查 Worker 是否正确处理 `WebSocket` upgrade。
- 检查网络是否允许访问该 Worker。

Worker 收到连接但没有快照：

- 检查 Worker 是否返回了 `{"type":"auth-ok"}`。
- 检查返回消息是否是合法 JSON。
- 检查 `Token` 是否匹配。

Worker 只看到机器离线：

- 检查 Worker 的离线阈值是否短于 60 秒心跳。
- 推荐使用 150 到 180 秒作为离线阈值。
- 检查 Worker 是否按 `machineId` 更新最后接收时间。

图标丢失：

- 先核对[图标发送规则](./remote-status-protocol.md#6-图标发送规则)：本机没有可用图标时会发送 `png:none` 与 `iconData: null`，重连不会凭空补出图标。
- 确认 Worker 保存了首帧中可用的 `iconData`，并在后续未重发图标时保留对应缓存。
- 确认 Worker 在收到新 `iconHash` 且带 `iconData` 的快照时更新缓存。
- Worker 冷启动或实例切换后，等待 Patina 重连首帧提供当前可用图标。

修改配置后仍走旧连接：

- 保存设置后旧连接会关闭。
- 如果新配置完整，Patina 会按新配置重连。
- 通过新连接的鉴权结果与 `lastReceivedAtMs` 确认生效，不记录或输出 Token。

## 接收端参考入口

以下入口保留原使用文档的章节锚点，完整内容已归到对应参考，避免两处维护同一消息。

<a id="4-worker-侧最低要求"></a>

- [4. Worker 侧最低要求](./remote-status-protocol.md#4-worker-侧最低要求)

<a id="5-快照消息"></a>

- [5. 快照消息](./remote-status-protocol.md#5-快照消息)

<a id="6-图标发送规则"></a>

- [6. 图标发送规则](./remote-status-protocol.md#6-图标发送规则)

<a id="7-发送时机"></a>

- [7. 发送时机](./remote-status-protocol.md#7-发送时机)

<a id="8-worker-离线判定"></a>

- [8. Worker 离线判定](./remote-status-protocol.md#8-worker-离线判定)

<a id="9-重连行为"></a>

- [9. 重连行为](./remote-status-protocol.md#9-重连行为)

<a id="10-worker-状态建议"></a>

- [10. Worker 状态建议](./remote-status-protocol.md#10-worker-状态建议)

<a id="11-安全边界"></a>

- [11. 安全边界](./remote-status-protocol.md#11-安全边界)

<a id="12-示例-worker-接口"></a>

- [12. 示例 Worker 接口](./remote-status-bridge-worker/README.md#12-示例-worker-接口)

<a id="121-路由总览"></a>

- [12.1 路由总览](./remote-status-bridge-worker/README.md#121-路由总览)

<a id="122-http-路由示例"></a>

- [12.2 HTTP 路由示例](./remote-status-bridge-worker/README.md#122-http-路由示例)

<a id="123-websocket-握手示例"></a>

- [12.3 WebSocket 握手示例](./remote-status-bridge-worker/README.md#123-websocket-握手示例)

<a id="124-websocket-消息示例"></a>

- [12.4 WebSocket 消息示例](./remote-status-bridge-worker/README.md#124-websocket-消息示例)
