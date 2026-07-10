// Relay backend for the Huawei Watch Claude Code client.
//
//   HTTP:  device-flow endpoints, mobile login page, browser test client,
//          round-watch GUI demo, compliance endpoints (report, account deletion)
//   WSS:   authenticated stream that drives a Claude Code session per connection,
//          with consent gating, budget + rate caps, content moderation, and voice.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { config, sttConfigured } from "./config.js";
import {
  createDeviceCode,
  approveUserCode,
  pollToken,
  isValidToken,
  setConsent,
  hasConsent,
  addSpend,
  isOverBudget,
  allowRequest,
  deleteAccount,
  addReport,
} from "./auth.js";
import { ClaudeSession } from "./claude-session.js";
import { transcribe, SttNotConfiguredError } from "./stt.js";

const execFileP = promisify(execFile);
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

await mkdir(config.workspaceDir, { recursive: true });
await seedWorkspaceIfEmpty(config.workspaceDir);

// In demo mode the reviewer's actions must never touch a real repo — a fresh,
// seeded, isolated workspace is used instead.
async function seedWorkspaceIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    if (entries.length > 0) return;
    await writeFile(
      join(dir, "README.md"),
      "# Example project\n\nA small sandbox repo for the watch relay demo.\n",
    );
    await writeFile(
      join(dir, "hello.js"),
      "export const hello = (name) => `Hello, ${name}!`;\n",
    );
    await execFileP("git", ["init", "-q"], { cwd: dir }).catch(() => {});
    await execFileP("git", ["add", "-A"], { cwd: dir }).catch(() => {});
    await execFileP(
      "git",
      ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-qm", "seed"],
      { cwd: dir },
    ).catch(() => {});
    console.log(`Seeded example workspace at ${dir}`);
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function baseUrl(req: IncomingMessage): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host ?? `localhost:${config.port}`;
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
    res
      .writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type",
      })
      .end();
    return;
  }

  if (path === "/healthz") return json(res, 200, { ok: true });

  // Lets the client learn which features are available (mic, demo banner).
  if (path === "/meta") {
    return json(res, 200, { demoMode: config.demoMode, stt: sttConfigured() });
  }

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

  // --- Compliance endpoints ---------------------------------------------
  if (path === "/report" && req.method === "POST") {
    const { token, text, reason } = await readBody(req);
    if (!isValidToken(token as string)) return json(res, 401, { error: "unauthorized" });
    addReport(String(reason ?? "user_report"), String(text ?? ""));
    return json(res, 200, { reported: true });
  }
  if (path === "/account" && req.method === "DELETE") {
    const { token } = await readBody(req);
    const existed = deleteAccount(String(token ?? ""));
    return json(res, 200, { deleted: existed });
  }

  // --- Clients -----------------------------------------------------------
  if (path === "/watch") {
    return serveFile(res, "watch.html", "text/html; charset=utf-8");
  }
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
  let token = "";
  let audio: { mime: string; chunks: Buffer[] } | null = null;

  const send = (event: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };

  // Common gate for anything that spends model budget: consent, rate, budget.
  const guard = (): boolean => {
    if (!hasConsent(token)) {
      send({ type: "needs_consent" });
      return false;
    }
    if (!allowRequest(token, config.rateLimitPerMin)) {
      send({ type: "error", message: "rate limit — vänta en stund" });
      return false;
    }
    if (config.demoMode && isOverBudget(token, config.demoBudgetUsd)) {
      send({ type: "error", message: "demo-budget slut" });
      return false;
    }
    return true;
  };

  const runPrompt = (text: string) => {
    if (!session || !guard()) return;
    send({ type: "accepted" });
    session.prompt(text);
  };

  ws.on("message", async (raw, isBinary) => {
    if (isBinary) return; // audio arrives as base64 in JSON, not binary frames
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send({ type: "error", message: "invalid json" });
    }

    if (msg.type === "auth") {
      if (isValidToken(msg.token as string | undefined)) {
        token = msg.token as string;
        session = new ClaudeSession(send, {
          cwd: config.workspaceDir,
          model: config.model,
          onCost: (usd) => addSpend(token, usd),
          onFiltered: (reason, text) => addReport(`auto:${reason}`, text),
        });
        send({ type: "authed", consented: hasConsent(token), demoMode: config.demoMode });
      } else {
        send({ type: "error", message: "invalid or expired token" });
        ws.close();
      }
      return;
    }

    if (!session) return send({ type: "error", message: "not authenticated" });

    switch (msg.type) {
      case "consent":
        setConsent(token);
        send({ type: "consented" });
        return;

      case "prompt":
        if (typeof msg.text === "string") runPrompt(msg.text);
        return;

      case "report":
        addReport(String(msg.reason ?? "user_report"), String(msg.text ?? ""));
        send({ type: "reported" });
        return;

      // --- Voice pipeline (fas 2) -----------------------------------------
      case "audio_start":
        audio = { mime: String(msg.mime ?? "audio/webm"), chunks: [] };
        return;

      case "audio_chunk":
        if (audio && typeof msg.data === "string") {
          audio.chunks.push(Buffer.from(msg.data, "base64"));
        }
        return;

      case "audio_end": {
        if (!audio) return;
        const buf = Buffer.concat(audio.chunks);
        const mime = audio.mime;
        audio = null;
        if (!guard()) return;
        if (!sttConfigured()) {
          return send({ type: "stt_unavailable" });
        }
        send({ type: "transcribing" });
        try {
          const text = await transcribe(buf, mime);
          send({ type: "transcript", text });
          if (text) runPrompt(text);
        } catch (err) {
          if (err instanceof SttNotConfiguredError) send({ type: "stt_unavailable" });
          else send({ type: "error", message: "transkribering misslyckades" });
        }
        return;
      }
    }
  });

  ws.on("close", () => session?.close());
  ws.on("error", () => session?.close());
});

server.listen(config.port, () => {
  console.log(`Backend listening on :${config.port}`);
  console.log(`  workspace:  ${config.workspaceDir}`);
  console.log(`  model:      ${config.model ?? "(SDK default)"}`);
  console.log(`  demoMode:   ${config.demoMode}`);
  console.log(`  stt:        ${sttConfigured() ? "configured" : "not configured"}`);
});
