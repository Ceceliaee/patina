# 远程推送使用文档

本仓库提供一键部署到 Cloudflare Worker 的示例模板，用来快速搭一个**无需服务器**的远程状态接收服务。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Ceceliaee/patina/tree/main/docs/examples/remote-status-bridge-worker)

快速部署：

1. 点击 `Deploy to Cloudflare`。
2. 在部署页填写 `REMOTE_STATUS_BRIDGE_TOKEN`。
3. 部署完成后记下 Worker 域名。
4. 打开 Patina `设置 -> 服务 -> 远程推送`。
5. 填写接收地址：`wss://<your-worker-host>/ws`。
6. 填写和 Worker 相同的 `Token`。
7. 打开远程推送开关并保存。

示例 Worker 位于 `docs/examples/remote-status-bridge-worker`。使用 Durable Object 持久化每台机器的最新状态，并在实例恢复时读取；不保存状态历史序列，也不使用独立的 D1 或 KV。

部署前需要可部署 Worker 和 Durable Object 的 Cloudflare 账号。手动部署与本地开发入口见[示例目录 README](./remote-status-bridge-worker/README.md)。账号权限、服务限制与费用以所用账号为准。

**此示例用于公开状态展示。** Token 只保护 `/ws` 上传鉴权；`/state` 无读取鉴权且允许跨域读取。最新状态包含机器标识、应用名称、图标与时间戳。关闭 Patina 推送或断开连接不会删除远端状态，离线标记也不是删除；示例没有自动过期删除或清理接口。仅供自己读取的需求需要另行实现读取鉴权；需要删除留存数据时，应通过 Cloudflare 的存储管理能力处理并核实结果。

## 1. 功能定位

远程推送把本机当前追踪状态发到用户自己的 `WebSocket` 服务，比如 Cloudflare Worker。

这条链路只发当前状态，不发历史记录，也不直接接入远端数据库。本项目只负责 `Windows -> Worker` 这一段。Worker 后面要怎么转发到网页或别的展示系统，由 Worker 项目自己处理。

它不会替代现有能力：

- 网页记录仍通过本机 HTTP 浏览器桥接链路处理。
- 本地 SQLite 仍是 Patina 历史记录、设置、备份和恢复的主数据源。

## 2. 适用场景

适合这些场景：

- 在公网屏幕上只读展示当前正在使用的应用。
- 多台 Windows 机器分别推送状态，由同一个 Worker 汇总后展示。
- 希望外部系统只知道当前状态，不拿到本地历史记录。

它不解决这些问题：

- 同步历史时间记录。
- 跨设备合并本地数据库。
- 远端恢复、补历史或做团队报表。

## 3. 开启方式

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

## 4. Worker 侧最低要求

Worker 必须提供一个可升级为 `WebSocket` 的地址。这个地址可以是 Cloudflare Worker，也可以是用户自己的源站。

使用仓库内置示例时，把 Patina 的 `接收地址` 设置为：

```text
wss://<your-worker-host>/ws
```

再把 Worker 的 `REMOTE_STATUS_BRIDGE_TOKEN` secret 设置成和 Patina `Token` 相同的值。

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

## 5. 快照消息

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
- `iconData`：可选字段，值为现有 PNG data URL。

`presence` 规则：

- `active`：Patina 当前认为追踪状态活跃。
- `afk`：Patina 当前认为用户无操作或不处于活跃追踪状态。
- `offline` 不由 Patina 发送，应由 Worker 根据超时自行判定。

## 6. 图标发送规则

Patina 沿用现有 PNG data URL 图标，不新增 WebP 编码链路。

发送规则：

- 每次新建连接并完成鉴权后，第一条 `snapshot` 必须带 `iconData`。
- 同一个 `WebSocket` 连接生命周期内，如果 `iconHash` 没变，后续快照默认不带 `iconData`。
- 同一个连接内，如果 `iconHash` 变化，下一条快照会再次带 `iconData`。
- 普通心跳默认不带 `iconData`，除非心跳时发现图标已经变化。

这样 Worker 不需要假设自己保留了上一次连接的图标缓存。即使 Worker 冷启动、路由到新实例，Patina 重连后的首帧也会重新带图标。

## 7. 发送时机

Patina 会在这些时机发送 `snapshot`：

- 连接鉴权成功后，立即发送一条全量快照。
- `presence`、`appName` 或 `iconHash` 任一变化时，发送变化快照。
- 如果状态没有变化，每 60 秒发送一条轻量快照作为心跳。

心跳也会刷新 `sampledAtMs`。Worker 可用它更新最后在线时间。

## 8. Worker 离线判定

Patina 不发送 `offline`。

Worker 推荐按每个 `machineId` 维护最近收到消息的时间。超过 150 到 180 秒没有收到该机器消息时，把它标记为 `offline`。

这个阈值允许漏掉 2 到 3 次 60 秒心跳，能容忍短暂网络抖动。

## 9. 重连行为

连接失败、鉴权失败、Worker 主动关闭或网络断开后，Patina 会进入重连。

退避序列：

```text
1s -> 2s -> 5s -> 10s -> 30s
```

30 秒封顶，并带少量随机抖动。

重连成功并重新收到 `auth-ok` 后，会重新走首帧全量逻辑。也就是说，重连后的第一条业务快照仍会带 `iconData`。

## 10. Worker 状态建议

Worker 应以 `machineId` 作为机器主键。

推荐 Worker 侧状态结构至少包含：

- `machineId`
- `presence`
- `appName`
- `sampledAtMs`
- `lastReceivedAtMs`
- `iconHash`
- `iconData`

当收到同一 `machineId` 的新快照时，用新值覆盖旧值。这个功能本身不需要历史队列。

Worker 是否把当前状态持久化，取决于展示链路需求。内置示例通过 Durable Object 保持最新状态跨实例恢复；自定义接收端可以采用不同存储，但必须自行说明留存和清理行为。

## 11. 安全边界

`Token` 由用户自行设置。Patina 只负责把它放进 `auth` 消息。

建议：

- Worker 只接受 `wss://` 连接。
- `Token` 使用足够长的随机字符串。
- Worker 不把令牌写进日志。
- Worker 对不合法消息直接关闭连接或忽略。
- Worker 不把 `iconData` 当作可信 HTML 渲染。

Patina 发送的数据只代表当前状态，但仍可能暴露正在使用的软件名称。公网展示前应确认屏幕内容符合使用者预期。

## 12. 示例 Worker 接口

本节描述仓库内置示例 Worker 的接口。自定义 Worker 只要遵守 `/ws` 的 `WebSocket` 协议即可，不必照搬 `/state`。

### 12.1 路由总览

| 路由 | 方法 | 用途 | 请求头 | 请求体 | 响应 |
| --- | --- | --- | --- | --- | --- |
| `/state` | `GET` | 读取当前机器状态快照 | 无特殊要求 | 无 | `application/json` |
| `/ws` | `GET` + `WebSocket` upgrade | Patina 推送状态 | `Upgrade: websocket` 等 `WebSocket` 握手头 | HTTP 请求体为空；业务数据走 `WebSocket` 消息 | `101 Switching Protocols` |

### 12.2 HTTP 路由示例

读取当前状态 JSON：

```bash
curl -s https://<your-worker-host>/state
```

`/state` 响应示例：

```json
{
  "updatedAtMs": 1781680000000,
  "machines": [
    {
      "machineId": "machine-xxxxxxxxxxxxxxxx",
      "sampledAtMs": 1781680000000,
      "presence": "active",
      "appName": "Visual Studio Code",
      "iconHash": "png:12345678",
      "iconData": "data:image/png;base64,...",
      "lastReceivedAtMs": 1781680000000
    }
  ]
}
```

收到有效快照后，`machines` 应出现对应 `machineId`，`lastReceivedAtMs` 随新快照更新。`machines` 为空通常表示尚无已保存快照；已有状态可能来自先前连接，不能只看非空就判定当前连接成功。

### 12.3 WebSocket 握手示例

`/ws` 不是普通 HTTP JSON 接口。Patina 连接时会先发起 `WebSocket` upgrade。下面的 `curl` 只能用于检查 Worker 是否接受 upgrade，不能完整模拟后续 `auth` 和 `snapshot` 消息。

```bash
curl -i --http1.1 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://<your-worker-host>/ws
```

成功时应返回 `101 Switching Protocols`。

### 12.4 WebSocket 消息示例

| 阶段 | 方向 | 消息体 | 说明 |
| --- | --- | --- | --- |
| 鉴权 | Patina -> Worker | `{"type":"auth","token":"Token"}` | 连接建立后第一条消息 |
| 鉴权成功 | Worker -> Patina | `{"type":"auth-ok"}` | Patina 收到后才会发送快照 |
| 鉴权失败 | Worker -> Patina | `{"type":"auth-failed"}` | Patina 会断开并进入重连 |
| 状态快照 | Patina -> Worker | 见下方 `snapshot` 示例 | 当前前台应用状态 |
| 心跳探测 | Worker -> Patina | `{"type":"ping"}` | 可选 |
| 心跳响应 | Patina -> Worker | `{"type":"pong"}` | 收到 `ping` 后回复 |

`snapshot` 消息体示例：

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

`iconData` 是可选字段。新连接鉴权成功后的第一条 `snapshot` 会带 `iconData`；同一连接内图标未变化时，后续快照通常只带 `iconHash`。

## 13. 排障

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

- 确认 Worker 保存了首帧中的 `iconData`。
- 确认 Worker 在收到新 `iconHash` 且带 `iconData` 的快照时更新缓存。
- 确认 Worker 冷启动或实例切换后，等待 Patina 重连首帧刷新图标。

修改配置后仍走旧连接：

- 保存设置后旧连接会关闭。
- 如果新配置完整，Patina 会按新配置重连。
- Worker 侧可通过 `Token` 或日志确认新连接是否生效。
