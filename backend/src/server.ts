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
import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { config, sttConfigured } from "./config.js";
import {
  listCodeRepos,
  codeRepoPath,
  listAppProjects,
  appProject,
  chatsDir,
  seedIfEmpty,
} from "./projects.js";
import {
  createDeviceCode,
  approveUserCode,
  pollToken,
  isValidToken,
  setConsent,
  hasConsent,
  isOverBudget,
  allowRequest,
  deleteAccount,
  addReport,
  setPushToken,
} from "./auth.js";
import { getOrCreateSession, disposeSession, type UserSession } from "./user-session.js";
import { transcribe, SttNotConfiguredError } from "./stt.js";
import { pushConfigured } from "./config.js";
import { loadCred, isConnected, credStatus, setCred, validToken } from "./claude-cred.js";

const execFileP = promisify(execFile);
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

await mkdir(config.workspaceDir, { recursive: true });
await seedWorkspaceIfEmpty(config.workspaceDir);
await mkdir(config.chatsDir, { recursive: true });
if (config.demoMode) await seedIfEmpty();
await loadCred();

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

/** Compact relative time for list subtitles, e.g. "5 min ago", "2 d ago". */
function relTime(ms?: number): string {
  if (!ms) return "";
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
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
    return json(res, 200, { demoMode: config.demoMode, stt: sttConfigured(), push: pushConfigured(), claude: isConnected() });
  }

  // --- Connect Claude (paste your subscription token once) ---------------
  if (path === "/connect" && req.method === "GET") {
    return serveFile(res, "connect.html", "text/html; charset=utf-8");
  }
  if (path === "/connect/status" && req.method === "GET") {
    return json(res, 200, credStatus());
  }
  if (path === "/connect" && req.method === "POST") {
    const { token, secret } = await readBody(req);
    if (config.adminSecret && String(secret ?? "") !== config.adminSecret) {
      return json(res, 403, { error: "wrong admin secret" });
    }
    if (!validToken(String(token ?? ""))) {
      return json(res, 400, { error: "invalid token (expected sk-ant-oat… or sk-ant-api…)" });
    }
    await setCred(String(token));
    return json(res, 200, { ...credStatus(), adminRequired: Boolean(config.adminSecret) });
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
    disposeSession(String(token ?? "")); // stop any running Claude turn
    const existed = deleteAccount(String(token ?? ""));
    return json(res, 200, { deleted: existed });
  }

  // --- Client ------------------------------------------------------------
  // There is one client: the round-watch GUI. Every entry point serves it so
  // that testing always looks exactly like the watch. (/test kept as an alias.)
  if (path === "/" || path === "/watch" || path === "/test") {
    return serveFile(res, "watch.html", "text/html; charset=utf-8");
  }

  res.writeHead(404).end("not found");
});

// ---------------------------------------------------------------------------
// WebSocket server — authenticated Claude Code stream
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  let us: UserSession | null = null;
  let token = "";
  let audio: { mime: string; chunks: Buffer[] } | null = null;

  // Direct send for request/response acks (only meaningful while connected).
  // Claude's streamed events go through us.emit (buffered + pushed when detached).
  const send = (event: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };

  const guard = (): boolean => {
    if (!isConnected()) { send({ type: "error", message: "Claude not connected — open /connect on your phone" }); return false; }
    if (!hasConsent(token)) { send({ type: "needs_consent" }); return false; }
    if (!allowRequest(token, config.rateLimitPerMin)) { send({ type: "error", message: "rate limit — wait a moment" }); return false; }
    if (config.demoMode && isOverBudget(token, config.demoBudgetUsd)) { send({ type: "error", message: "demo budget spent" }); return false; }
    return true;
  };

  const runPrompt = (text: string) => {
    if (!us?.claude || !guard()) return;
    send({ type: "accepted" });
    us.claude.prompt(text);
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
        us = getOrCreateSession(token);
        us.attach(ws); // reconnect flushes anything buffered while away
        if (!us.claude) {
          us.cwd = config.chatsDir;
          us.contextLabel = "Claude";
          us.systemPrompt = undefined;
          us.rebuildClaude();
        }
        send({ type: "authed", consented: hasConsent(token), demoMode: config.demoMode, push: pushConfigured(), claude: isConnected() });
      } else {
        send({ type: "error", message: "invalid or expired token" });
        ws.close();
      }
      return;
    }

    if (!us) return send({ type: "error", message: "not authenticated" });

    switch (msg.type) {
      case "consent":
        setConsent(token);
        send({ type: "consented" });
        return;

      // Watch registers its Huawei Push Kit device token for background alerts.
      case "register_push":
        if (typeof msg.pushToken === "string") {
          us.pushToken = msg.pushToken;
          setPushToken(token, msg.pushToken);
          send({ type: "registered" });
        }
        return;

      // App tells us it went to background/foreground so we know when to push.
      case "background": us.setForeground(false); return;
      case "foreground": us.setForeground(true); return;

      case "prompt":
        if (typeof msg.text === "string") runPrompt(msg.text);
        return;

      // --- Navigation: the three Claude surfaces --------------------------
      case "list": {
        const scope = String(msg.scope ?? "");
        try {
          if (scope === "chats") {
            const sessions = await listSessions({ dir: chatsDir(), limit: 30 }).catch(() => []);
            const items = sessions.map((s) => ({
              id: s.sessionId,
              title: s.customTitle || s.summary || s.firstPrompt || "Conversation",
              subtitle: relTime(s.lastModified),
            }));
            send({ type: "list_result", scope, items });
          } else if (scope === "projects") {
            const items = (await listAppProjects()).map((p) => ({
              id: p.id,
              title: p.name,
              subtitle: "project",
            }));
            send({ type: "list_result", scope, items });
          } else if (scope === "code") {
            const repos = await listCodeRepos();
            const items = await Promise.all(
              repos.map(async (r) => {
                const last = await listSessions({ dir: r.path, limit: 1 }).catch(() => []);
                return {
                  id: r.id,
                  title: r.title,
                  subtitle: last[0] ? relTime(last[0].lastModified) : "no work yet",
                };
              }),
            );
            send({ type: "list_result", scope, items });
          } else {
            send({ type: "error", message: "unknown scope" });
          }
        } catch (err) {
          send({ type: "error", message: `list failed: ${String(err).slice(0, 80)}` });
        }
        return;
      }

      case "new_chat":
        us.cwd = chatsDir();
        us.contextLabel = "New chat";
        us.systemPrompt = undefined;
        us.rebuildClaude();
        send({ type: "chat_opened", context: us.contextLabel, kind: "chat" });
        return;

      case "open_chat":
        us.cwd = chatsDir();
        us.contextLabel = "Conversation";
        us.systemPrompt = undefined;
        us.rebuildClaude(String(msg.id ?? ""));
        send({ type: "chat_opened", context: us.contextLabel, kind: "chat" });
        return;

      case "open_project": {
        const proj = await appProject(String(msg.id ?? ""));
        if (!proj) return send({ type: "error", message: "invalid project" });
        us.cwd = proj.path;
        us.contextLabel = proj.name;
        us.systemPrompt = proj.instructions || undefined;
        const last = await listSessions({ dir: us.cwd, limit: 1 }).catch(() => []);
        us.rebuildClaude(last[0]?.sessionId);
        send({ type: "chat_opened", context: us.contextLabel, kind: "project" });
        return;
      }

      case "open_code": {
        const repo = codeRepoPath(String(msg.id ?? ""));
        if (!repo) return send({ type: "error", message: "invalid repo" });
        us.cwd = repo;
        us.contextLabel = String(msg.id);
        us.systemPrompt = undefined;
        const last = await listSessions({ dir: us.cwd, limit: 1 }).catch(() => []);
        us.rebuildClaude(last[0]?.sessionId);
        send({ type: "chat_opened", context: us.contextLabel, kind: "code" });
        return;
      }

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

  // Socket dropped: keep the Claude turn running server-side so it can finish and
  // push a notification. The session is torn down only after an idle grace period.
  ws.on("close", () => us?.detach());
  ws.on("error", () => us?.detach());
});

server.listen(config.port, () => {
  console.log(`Backend listening on :${config.port}`);
  console.log(`  workspace:  ${config.workspaceDir}`);
  console.log(`  model:      ${config.model ?? "(SDK default)"}`);
  console.log(`  demoMode:   ${config.demoMode}`);
  console.log(`  stt:        ${sttConfigured() ? "configured" : "not configured"}`);
  console.log(`  push:       ${pushConfigured() ? "configured" : "not configured (logs instead)"}`);
  const cs = credStatus();
  console.log(`  claude:     ${cs.connected ? `${cs.kind} (${cs.source})` : "NOT connected — open /connect"}`);
});
