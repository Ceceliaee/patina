# Patina 远程推送 Worker

此目录提供 Cloudflare Worker 接收端。协议、留存、公开读取边界和排障由[远程推送使用指南](../remote-status-bridge.md)维护，部署前先阅读该说明。

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
