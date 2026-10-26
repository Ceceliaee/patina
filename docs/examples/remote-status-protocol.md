# 远程状态接收协议

本文供接收端开发者查询 Patina 的 WebSocket 鉴权、快照、图标、心跳和重连约定。用户配置见[使用指南](./remote-status-bridge.md)，示例部署与 HTTP 路由见[Worker README](./remote-status-bridge-worker/README.md)。本协议只传当前状态；本机浏览器网页采集另由 [Web Activity 协议](../web-activity-protocol.md)定义。

[鉴权](#4-worker-侧最低要求) · [快照字段](#5-快照消息) · [图标](#6-图标发送规则) · [心跳](#7-发送时机) · [离线](#8-worker-离线判定) · [重连](#9-重连行为) · [接收端状态](#10-worker-状态建议) · [安全](#11-安全边界)

<a id="4-worker-侧最低要求"></a>

## Worker 侧最低要求

Worker 必须提供一个可升级为 `WebSocket` 的地址。这个地址可以是 Cloudflare Worker，也可以是用户自己的源站。

示例部署和地址/Token 配置见[Worker README](./remote-status-bridge-worker/README.md)。

连接建立后，Patina 会先发送鉴权消息：

```json
{
  "type": "auth",
  "token": "Token"
}
```

Worker 应返回：

```json
{
  "type": "auth-ok"
}
```

鉴权失败时返回：

```json
{
  "type": "auth-failed"
}
```

Patina 在收到 `auth-ok` 前不会发送业务快照。鉴权等待期间如果本机状态变化，Patina 只保留最后一份待发送快照。收到 `auth-ok` 后，立即发送这份最新快照。

Worker 可发送：

```json
{
  "type": "ping"
}
```

Patina 会回复：

```json
{
  "type": "pong"
}
```

Patina 不要求 Worker 使用任何特定存储。Worker 可以只用内存维护当前状态，也可以自行写入 `D1`、`KV` 或其他存储。这个选择不属于 Patina 的实现边界。

<a id="5-快照消息"></a>

## 快照消息

业务消息统一使用 `snapshot`。

```json
{
  "type": "snapshot",
  "version": 1,
  "machineId": "machine-xxxxxxxxxxxxxxxx",
  "sampledAtMs": 1781680000000,
  "presence": "active",
  "appName": "Visual Studio Code",
  "iconHash": "png:12345678",
  "iconData": "data:image/png;base64,..."
}
```

字段说明：

- `type`：固定为 `snapshot`。
- `version`：当前为 `1`。
- `machineId`：当前机器 ID。
- `sampledAtMs`：本机采样时间戳，单位为毫秒。
- `presence`：只会是 `active` 或 `afk`。
- `appName`：当前前台应用展示名。
- `iconHash`：当前图标的稳定哈希。
- `iconData`：PNG data URL 或 `null`。当前发送端保留这个字段，不发送图标内容时为 `null`；接收端也应兼容字段缺省。

`presence` 规则：

- `active`：Patina 当前认为追踪状态活跃。
- `afk`：Patina 当前认为用户无操作或不处于活跃追踪状态。
- `offline` 不由 Patina 发送，应由 Worker 根据超时自行判定。

<a id="6-图标发送规则"></a>

## 图标发送规则

Patina 沿用现有 PNG data URL 图标，不新增 WebP 编码链路。

发送规则：

- 每次新建连接并完成鉴权后，第一条 `snapshot` 带当前可用的图标内容；没有图标时 `iconHash` 为 `png:none`，`iconData` 为 `null`。
- 同一个 `WebSocket` 连接生命周期内，如果 `iconHash` 没变，后续快照不重发图标内容，`iconData` 为 `null`。
- 同一个连接内，如果 `iconHash` 变化，下一条快照重新携带当前可用图标；图标不可用时仍为 `null`。
- 普通心跳不重发图标内容，除非心跳时发现图标已变化且有可用图标。

这样 Worker 不需要假设自己保留了上一次连接的图标缓存。即使 Worker 冷启动、路由到新实例，Patina 重连后的首帧也会重新提供当前可用图标。

<a id="7-发送时机"></a>

## 发送时机

Patina 会在这些时机发送 `snapshot`：

- 连接鉴权成功后，立即发送一条全量快照。
- `presence`、`appName` 或 `iconHash` 任一变化时，发送变化快照。
- 如果状态没有变化，每 60 秒发送一条轻量快照作为心跳。

`sampledAtMs` 来自当前 tracking 快照，不是 Worker 收到消息的时间；接收端应使用自身记录的 `lastReceivedAtMs` 判断连接是否持续收到消息。

<a id="8-worker-离线判定"></a>

## Worker 离线判定

Patina 不发送 `offline`。

Worker 推荐按每个 `machineId` 维护最近收到消息的时间。超过 150 到 180 秒没有收到该机器消息时，把它标记为 `offline`。

这个阈值允许漏掉 2 到 3 次 60 秒心跳，能容忍短暂网络抖动。

<a id="9-重连行为"></a>

## 重连行为

连接失败、鉴权失败、Worker 主动关闭或网络断开后，Patina 会进入重连。

退避序列：

```text
1s -> 2s -> 5s -> 10s -> 30s
```

30 秒封顶，并带少量随机抖动。

重连成功并重新收到 `auth-ok` 后，会重新走首帧全量逻辑。也就是说，重连后的第一条业务快照会按[图标规则](#6-图标发送规则)提供当前可用图标。

<a id="10-worker-状态建议"></a>

## Worker 状态建议

Worker 应以 `machineId` 作为机器主键。

推荐 Worker 侧状态结构至少包含：

- `machineId`
- `presence`
- `appName`
- `sampledAtMs`
- `lastReceivedAtMs`
- `iconHash`
- `iconData`

当收到同一 `machineId` 的新快照时，更新状态字段与 `lastReceivedAtMs`。图标缓存按[图标发送规则](#6-图标发送规则)处理：哈希未变且 `iconData` 为 `null` 时沿用已有图标；哈希改变为 `png:none` 时应按接收端的展示规则处理无图标状态。这个功能本身不需要历史队列。示例 Worker 的缓存行为见[实现与示例边界](#实现与示例边界)。

Worker 是否把当前状态持久化，取决于展示链路需求。内置示例通过 Durable Object 保持最新状态跨实例恢复；自定义接收端可以采用不同存储，但必须自行说明留存和清理行为。

<a id="11-安全边界"></a>

## 安全边界

`Token` 由用户自行设置。Patina 只负责把它放进 `auth` 消息。

建议：

- Worker 只接受 `wss://` 连接。
- `Token` 使用足够长的随机字符串。
- Worker 不把令牌写进日志。
- Worker 对不合法消息直接关闭连接或忽略。
- Worker 不把 `iconData` 当作可信 HTML 渲染。

Patina 发送的数据只代表当前状态，但仍可能暴露正在使用的软件名称。公网展示前应确认屏幕内容符合使用者预期。
## 实现与示例边界

发送端字段与时序由 [Rust bridge](../../src-tauri/src/engine/remote_status_bridge/mod.rs)实现；[示例 Worker](./remote-status-bridge-worker/src/index.js)保存最新状态。示例收到 `iconData: null` 或缺省时保留该机器先前的图标，因此无图标输入不保证清掉旧图标；自定义接收端需要按自身展示要求处理 `iconHash` 变化。部署结果仍需按[使用指南](./remote-status-bridge.md#确认连接与快照)验证，源码核对不代表远端部署已验收。
