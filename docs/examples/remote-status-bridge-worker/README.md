# Patina 远程推送 Worker

此目录提供 Cloudflare Worker 接收端。部署前先阅读[使用指南的公开读取与留存边界](../remote-status-bridge.md#公开展示与留存)。本文件持有示例部署和 HTTP 路由；WebSocket 消息由[接收协议](../remote-status-protocol.md)维护。

## 部署

需要具备 Worker 与 Durable Object 部署权限的 Cloudflare 账号和 Node/npm 环境。可使用[使用指南中的一键部署入口](../remote-status-bridge.md)，也可在本目录执行：

```bash
npm install
npx wrangler login
npx wrangler secret put REMOTE_STATUS_BRIDGE_TOKEN
npm run deploy
```

Token 应与 Patina 中填写的值一致。部署配置由 [wrangler.jsonc](wrangler.jsonc) 拥有，命令由 [package.json](package.json) 拥有。部署完成后按使用指南配置 Patina，并通过快照接收时间确认连接。

## 本地开发

在本目录执行以下命令；复制命令使用 PowerShell：

```powershell
npm install
Copy-Item -LiteralPath .dev.vars.example -Destination .dev.vars
```

在 `.dev.vars` 中配置测试 Token，然后执行 `npm run dev` 启动接收端。使用独立测试客户端和虚构状态验证本地接收，不发送私人活动数据。开发环境的绑定和远端生产存储应分别核对，本地接收成功不代表远端部署已经通过验收。

<a id="12-示例-worker-接口"></a>

## 示例 Worker 接口

本节描述仓库内置示例 Worker 的接口。自定义 Worker 只要遵守 `/ws` 的 `WebSocket` 协议即可，不必照搬 `/state`。

<a id="121-路由总览"></a>

### 路由总览

| 路由 | 方法 | 用途 | 请求头 | 请求体 | 响应 |
| --- | --- | --- | --- | --- | --- |
| `/state` | `GET` | 读取当前机器状态快照 | 无特殊要求 | 无 | `application/json` |
| `/ws` | `GET` + `WebSocket` upgrade | Patina 推送状态 | `Upgrade: websocket` 等 `WebSocket` 握手头 | HTTP 请求体为空；业务数据走 `WebSocket` 消息 | `101 Switching Protocols` |

<a id="122-http-路由示例"></a>

### HTTP 路由示例

读取当前状态 JSON：

```sh
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

<a id="123-websocket-握手示例"></a>

### WebSocket 握手示例

`/ws` 不是普通 HTTP JSON 接口。Patina 连接时会先发起 `WebSocket` upgrade。下面的 `curl` 只能用于检查 Worker 是否接受 upgrade，不能完整模拟后续 `auth` 和 `snapshot` 消息。

以下多行命令使用 POSIX shell；PowerShell 中使用 `curl.exe` 并将参数写在同一行。

```sh
curl -i --http1.1 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://<your-worker-host>/ws
```

成功时应返回 `101 Switching Protocols`。

<a id="124-websocket-消息示例"></a>

### WebSocket 消息示例

消息顺序、鉴权响应、`snapshot` 字段和首帧图标规则统一见[接收协议](../remote-status-protocol.md#4-worker-侧最低要求)。`101` 只证明升级成功，收到 `auth-ok` 后仍需观察 `/state` 中本机的 `lastReceivedAtMs` 更新，才能判断快照链路已经工作。

## 验证与故障定位

部署后按[使用指南](../remote-status-bridge.md#确认连接与快照)验证当前机器的接收时间；使用虚构测试状态时也应检查断线前后的变化。`/state` 允许公开跨域读取，不将 Token 放进该 URL。`/ws` 返回 `426` 表示没有进行 WebSocket upgrade；鉴权或消息格式失败按[协议](../remote-status-protocol.md#4-worker-侧最低要求)定位。密钥与部署问题先核对当前环境和绑定，避免把本地测试凭据覆盖到生产。
