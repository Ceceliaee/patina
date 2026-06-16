# Patina Remote Status Bridge Worker

Minimal Cloudflare Worker for Patina remote status bridge.

It receives Patina `snapshot` messages over WebSocket, keeps the latest state in memory, and exposes a tiny read-only status page.

## Routes

- `/ws`: WebSocket endpoint for Patina.
- `/`: Minimal live dashboard.
- `/state`: Current state as JSON.
- `/events`: Server-sent events used by the dashboard.

## Setup

1. Deploy this Worker.
2. Set `REMOTE_STATUS_BRIDGE_TOKEN` to a random value.
3. In Patina, set the Worker URL to `wss://<your-worker-host>/ws`.
4. In Patina, set the connection token to the same value.

## Local Development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

## Deploy

```bash
npm install
npm run deploy
```

This sample uses in-memory state only. It does not use D1, KV, Durable Objects, or Grafana Live.
