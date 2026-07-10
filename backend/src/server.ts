// Relay backend for the Huawei Watch Claude Code client.
//
//   HTTP:  device-flow endpoints + the mobile login page + a browser test client
//   WSS:   authenticated stream that drives a Claude Code session per connection
//
// One process serves both HTTP and WebSocket on a single port (Cloud Run friendly).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import {
  createDeviceCode,
  approveUserCode,
  pollToken,
  isValidToken,
} from "./auth.js";
import { ClaudeSession } from "./claude-session.js";

const PORT = Number(process.env.PORT ?? 8080);
const MODEL = process.env.CLAUDE_MODEL || undefined; // undefined => SDK/CLI default
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/tmp/workspace";
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

await mkdir(WORKSPACE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function baseUrl(req: IncomingMessage): string {
  // Cloud Run terminates TLS and sets x-forwarded-proto.
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host ?? `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function serveFile(res: ServerResponse, name: string, type: string): Promise<void> {
  try {
    const buf = await readFile(join(PUBLIC_DIR, name));
    res.writeHead(200, { "content-type": type });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", baseUrl(req));
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    }).end();
    return;
  }

  // Health check for Cloud Run.
  if (path === "/healthz") return json(res, 200, { ok: true });

  // --- Device flow -------------------------------------------------------
  if (path === "/device/code" && req.method === "POST") {
    const dc = createDeviceCode(baseUrl(req));
    const qrDataUrl = await QRCode.toDataURL(dc.verification_uri_complete, {
      margin: 1,
      width: 320,
    });
    return json(res, 200, { ...dc, qr_data_url: qrDataUrl });
  }

  if (path === "/device/token" && req.method === "POST") {
    const { device_code } = await readBody(req);
    const result = pollToken(String(device_code ?? ""));
    const status = result.status === "expired_token" ? 400 : 200;
    return json(res, status, result);
  }

  // --- Mobile login page + approval -------------------------------------
  if (path === "/login" && req.method === "GET") {
    return serveFile(res, "login.html", "text/html; charset=utf-8");
  }

  if (path === "/login" && req.method === "POST") {
    const { user_code } = await readBody(req);
    const ok = approveUserCode(String(user_code ?? ""));
    return json(res, ok ? 200 : 400, { approved: ok });
  }

  // --- Browser test client ----------------------------------------------
  if (path === "/" || path === "/test") {
    return serveFile(res, "test-client.html", "text/html; charset=utf-8");
  }

  res.writeHead(404).end("not found");
});

// ---------------------------------------------------------------------------
// WebSocket server — authenticated Claude Code stream
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  let session: ClaudeSession | null = null;
  let authed = false;

  const send = (event: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send({ type: "error", message: "invalid json" });
    }

    if (msg.type === "auth") {
      if (isValidToken(msg.token as string | undefined)) {
        authed = true;
        session = new ClaudeSession(send, { cwd: WORKSPACE_DIR, model: MODEL });
        send({ type: "authed" });
      } else {
        send({ type: "error", message: "invalid or expired token" });
        ws.close();
      }
      return;
    }

    if (!authed || !session) {
      return send({ type: "error", message: "not authenticated" });
    }

    if (msg.type === "prompt" && typeof msg.text === "string") {
      send({ type: "accepted" });
      session.prompt(msg.text);
    }
  });

  ws.on("close", () => session?.close());
  ws.on("error", () => session?.close());
});

server.listen(PORT, () => {
  console.log(`Backend listening on :${PORT}`);
  console.log(`  workspace: ${WORKSPACE_DIR}`);
  console.log(`  model:     ${MODEL ?? "(SDK default)"}`);
});
