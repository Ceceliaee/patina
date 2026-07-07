import { DurableObject } from "cloudflare:workers";

const BRIDGE_OBJECT_NAME = "default";
const HEARTBEAT_OFFLINE_AFTER_MS = 180_000;
const MACHINES_STORAGE_KEY = "machines";
const STATE_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

export default {
  fetch(request, env) {
    const bridge = env.REMOTE_STATUS_BRIDGE.getByName(BRIDGE_OBJECT_NAME);
    return bridge.fetch(request);
  },
};

export class RemoteStatusBridge extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.machines = new Map();
    ctx.blockConcurrencyWhile(async () => {
      const storedMachines = await this.ctx.storage.get(MACHINES_STORAGE_KEY);
      if (storedMachines && typeof storedMachines === "object") {
        this.machines = new Map(Object.entries(storedMachines));
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/state") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: STATE_CORS_HEADERS,
        });
      }

      return jsonResponse(this.buildState());
    }

    return new Response("Not found", { status: 404 });
  }

  handleWebSocket(request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const session = {
      authenticated: false,
      token: this.env.REMOTE_STATUS_BRIDGE_TOKEN ?? "",
    };

    server.accept();
    server.addEventListener("message", (event) => {
      this.ctx.waitUntil(this.handleSocketMessage(server, session, event.data));
    });
    server.addEventListener("error", () => {
      tryClose(server, 1011, "socket error");
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSocketMessage(socket, session, rawData) {
    const message = parseJson(rawData);
    if (!message || typeof message.type !== "string") {
      tryClose(socket, 1003, "invalid json");
      return;
    }

    if (!session.authenticated) {
      handleAuthMessage(socket, session, message);
      return;
    }

    if (message.type === "snapshot") {
      const snapshot = normalizeSnapshot(message);
      if (!snapshot) {
        tryClose(socket, 1003, "invalid snapshot");
        return;
      }

      await this.saveSnapshot(snapshot);
      return;
    }

    if (message.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  }

  async saveSnapshot(snapshot) {
    const previous = this.machines.get(snapshot.machineId);
    const next = {
      ...previous,
      ...snapshot,
      iconData: snapshot.iconData ?? previous?.iconData ?? null,
      lastReceivedAtMs: Date.now(),
    };
    const nextMachines = new Map(this.machines);
    nextMachines.set(snapshot.machineId, next);

    await this.ctx.storage.put(MACHINES_STORAGE_KEY, Object.fromEntries(nextMachines));
    this.machines = nextMachines;
  }

  buildState() {
    const now = Date.now();
    return {
      updatedAtMs: now,
      machines: Array.from(this.machines.values())
        .map((machine) => ({
          ...machine,
          presence: now - machine.lastReceivedAtMs > HEARTBEAT_OFFLINE_AFTER_MS
            ? "offline"
            : machine.presence,
        }))
        .sort((left, right) => left.machineId.localeCompare(right.machineId)),
    };
  }
}

function handleAuthMessage(socket, session, message) {
  if (message.type !== "auth") {
    tryClose(socket, 1008, "auth required");
    return;
  }

  const expectedToken = String(session.token).trim();
  const receivedToken = typeof message.token === "string" ? message.token.trim() : "";

  if (!expectedToken || receivedToken !== expectedToken) {
    socket.send(JSON.stringify({ type: "auth-failed" }));
    tryClose(socket, 1008, "auth failed");
    return;
  }

  session.authenticated = true;
  socket.send(JSON.stringify({ type: "auth-ok" }));
}

function normalizeSnapshot(message) {
  if (message.version !== 1) return null;
  if (typeof message.machineId !== "string" || !message.machineId.trim()) return null;
  if (typeof message.sampledAtMs !== "number" || !Number.isFinite(message.sampledAtMs)) return null;
  if (message.presence !== "active" && message.presence !== "afk") return null;
  if (typeof message.appName !== "string") return null;
  if (typeof message.iconHash !== "string") return null;
  if (message.iconData !== undefined && typeof message.iconData !== "string" && message.iconData !== null) {
    return null;
  }

  return {
    machineId: message.machineId.trim(),
    sampledAtMs: Math.trunc(message.sampledAtMs),
    presence: message.presence,
    appName: message.appName,
    iconHash: message.iconHash,
    iconData: message.iconData ?? null,
  };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...STATE_CORS_HEADERS,
    },
  });
}

function parseJson(rawData) {
  try {
    return JSON.parse(typeof rawData === "string" ? rawData : new TextDecoder().decode(rawData));
  } catch {
    return null;
  }
}

function tryClose(socket, code, reason) {
  try {
    socket.close(code, reason);
  } catch {}
}
