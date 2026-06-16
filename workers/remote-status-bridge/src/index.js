const HEARTBEAT_OFFLINE_AFTER_MS = 180_000;

const machines = new Map();
const eventClients = new Set();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return handleWebSocket(request, env);
    }

    if (url.pathname === "/state") {
      return jsonResponse(buildState());
    }

    if (url.pathname === "/events") {
      return handleEvents();
    }

    if (url.pathname === "/") {
      return new Response(renderDashboard(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

function handleWebSocket(request, env) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  const session = {
    authenticated: false,
    token: env.REMOTE_STATUS_BRIDGE_TOKEN ?? "",
  };

  server.accept();
  server.addEventListener("message", (event) => {
    handleSocketMessage(server, session, event.data);
  });
  server.addEventListener("close", () => {
    broadcastState();
  });
  server.addEventListener("error", () => {
    tryClose(server, 1011, "socket error");
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

function handleSocketMessage(socket, session, rawData) {
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

    const previous = machines.get(snapshot.machineId);
    machines.set(snapshot.machineId, {
      ...previous,
      ...snapshot,
      iconData: snapshot.iconData ?? previous?.iconData ?? null,
      lastReceivedAtMs: Date.now(),
    });
    broadcastState();
    return;
  }

  if (message.type === "ping") {
    socket.send(JSON.stringify({ type: "pong" }));
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

function handleEvents() {
  let client;
  let interval;
  const stream = new ReadableStream({
    start(controller) {
      client = {
        send(payload) {
          controller.enqueue(encodeSse(payload));
        },
      };

      eventClients.add(client);
      client.send(buildState());

      interval = setInterval(() => {
        client.send(buildState());
      }, 30_000);
    },
    cancel() {
      clearInterval(interval);
      eventClients.delete(client);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    },
  });
}

function buildState() {
  const now = Date.now();
  return {
    updatedAtMs: now,
    machines: Array.from(machines.values())
      .map((machine) => ({
        ...machine,
        presence: now - machine.lastReceivedAtMs > HEARTBEAT_OFFLINE_AFTER_MS
          ? "offline"
          : machine.presence,
      }))
      .sort((left, right) => left.machineId.localeCompare(right.machineId)),
  };
}

function broadcastState() {
  const state = buildState();
  for (const client of eventClients) {
    try {
      client.send(state);
    } catch {
      eventClients.delete(client);
    }
  }
}

function encodeSse(payload) {
  return new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
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

function renderDashboard() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Patina Remote Status Bridge</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: Canvas;
      color: CanvasText;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 20px;
      font-size: 24px;
    }
    .grid {
      display: grid;
      gap: 12px;
    }
    .machine {
      display: grid;
      grid-template-columns: 44px 1fr auto;
      gap: 12px;
      align-items: center;
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 8px;
      padding: 12px;
    }
    img {
      width: 36px;
      height: 36px;
      object-fit: contain;
    }
    .name {
      font-weight: 650;
    }
    .meta {
      margin-top: 4px;
      color: color-mix(in srgb, CanvasText 62%, transparent);
      font-size: 13px;
    }
    .presence {
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 12px;
      background: color-mix(in srgb, CanvasText 10%, transparent);
    }
    .empty {
      color: color-mix(in srgb, CanvasText 62%, transparent);
    }
  </style>
</head>
<body>
  <main>
    <h1>Patina Remote Status Bridge</h1>
    <div id="machines" class="grid"><p class="empty">Waiting for snapshots...</p></div>
  </main>
  <script>
    const container = document.getElementById("machines");
    const events = new EventSource("/events");
    events.addEventListener("state", (event) => render(JSON.parse(event.data)));

    function render(state) {
      if (!state.machines.length) {
        container.innerHTML = '<p class="empty">Waiting for snapshots...</p>';
        return;
      }
      container.innerHTML = state.machines.map((machine) => {
        const icon = machine.iconData
          ? '<img alt="" src="' + escapeHtml(machine.iconData) + '">'
          : '<div></div>';
        return '<section class="machine">'
          + icon
          + '<div><div class="name">' + escapeHtml(machine.appName || "Unknown") + '</div>'
          + '<div class="meta">' + escapeHtml(machine.machineId) + ' · ' + new Date(machine.sampledAtMs).toLocaleString() + '</div></div>'
          + '<span class="presence">' + escapeHtml(machine.presence) + '</span>'
          + '</section>';
      }).join("");
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[char]));
    }
  </script>
</body>
</html>`;
}
