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
import {
  listSessions,
  getSessionMessages,
  renameSession,
  deleteSession,
  forkSession,
} from "@anthropic-ai/claude-agent-sdk";
import { config, sttConfigured, mcpConfigured, mcpServers } from "./config.js";
import {
  listCodeRepos,
  codeRepoPath,
  listAppProjects,
  appProject,
  chatsDir,
  seedIfEmpty,
  safeName,
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
import { loadCred, isConnected, credStatus, setCred, validToken, probeAccount } from "./claude-cred.js";

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

// Per-surface model / effort / setting-sources. Chats run a fast small model;
// Claude Code loads the repo's CLAUDE.md (settingSources: ['project']).
type Surface = "chat" | "project" | "code";
function applyScope(us: UserSession, surface: Surface): void {
  us.model = config.models[surface] || undefined;
  us.effort = config.effort[surface] || undefined;
  us.settingSources = surface === "code" ? ["project"] : undefined;
}

/** Pull the visible text out of a stored SessionMessage's raw `message`. */
function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => (b as { type?: string })?.type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join("")
      .trim();
  }
  return "";
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
  // No wildcard CORS: the watch/login/connect pages are all same-origin, so we
  // don't want other websites reading account/connection state cross-origin.
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
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
    // Same-origin app: reply to preflight without granting cross-origin access.
    res.writeHead(204, { "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" }).end();
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
  // Verify the connected credential and report who it's authenticated as.
  if (path === "/connect/account" && req.method === "GET") {
    const account = await probeAccount();
    return json(res, 200, { connected: isConnected(), account });
  }
  // QR that opens the /connect page on the phone (shown on the watch when Claude
  // isn't connected yet — the second login step after device pairing).
  if (path === "/connect/qr" && req.method === "GET") {
    const url = `${baseUrl(req)}/connect`;
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    return json(res, 200, { url, qr_data_url: qrDataUrl });
  }
  if (path === "/connect" && req.method === "POST") {
    const { token, secret } = await readBody(req);
    if (config.adminSecret && String(secret ?? "") !== config.adminSecret) {
      return json(res, 403, { error: "wrong admin secret" });
    }
    if (!validToken(String(token ?? ""))) {
      return json(res, 400, { error: "invalid token — expected an sk-ant-… token from `claude setup-token`" });
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

const wss = new WebSocketServer({
  server,
  path: "/ws",
  // Reject cross-origin browser connections (CSWSH). A native watch app sends no
  // Origin header (allowed); a browser must be same-origin as Host.
  verifyClient: (info: { origin?: string; req: IncomingMessage }) => {
    if (!info.origin) return true; // native client / non-browser
    try {
      return new URL(info.origin).host === info.req.headers.host;
    } catch {
      return false;
    }
  },
});

wss.on("connection", (ws: WebSocket) => {
  let us: UserSession | null = null;
  let token = "";
  let audio: { mime: string; chunks: Buffer[]; bytes: number } | null = null;
  const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // hard cap so a stuck recorder can't OOM us

  // Direct send for request/response acks (only meaningful while connected).
  // Claude's streamed events go through us.emit (buffered + pushed when detached).
  const send = (event: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };

  // Connection + consent + budget checks WITHOUT consuming a rate-limit slot.
  const guardNoRate = (): boolean => {
    if (!isConnected()) { send({ type: "error", message: "Claude not connected — open /connect on your phone" }); return false; }
    if (!hasConsent(token)) { send({ type: "needs_consent" }); return false; }
    if (config.demoMode && isOverBudget(token, config.demoBudgetUsd)) { send({ type: "error", message: "demo budget spent" }); return false; }
    return true;
  };
  // Full guard for an actual prompt — also consumes one rate-limit slot.
  const guard = (): boolean => {
    if (!guardNoRate()) return false;
    if (!allowRequest(token, config.rateLimitPerMin)) { send({ type: "error", message: "rate limit — wait a moment" }); return false; }
    return true;
  };
  // Control commands (account/usage/models/settings) need consent but must not
  // eagerly spawn a CLI or run for an un-consented user.
  const controlOk = (): boolean => isConnected() && hasConsent(token);

  const runPrompt = (text: string) => {
    if (!us?.claude || !guard()) return;
    send({ type: "accepted" });
    us.claude.prompt(text);
  };

  // Render a resumed session's prior messages so the chat opens with history,
  // not an empty feed (getSessionMessages).
  const replayHistory = async (sessionId: string | undefined, dir: string) => {
    if (!sessionId) return;
    try {
      const msgs = await getSessionMessages(sessionId, { dir, limit: 40 });
      const items = msgs
        .filter((m) => m.type === "user" || m.type === "assistant")
        .map((m) => ({ role: m.type, text: extractText(m.message) }))
        .filter((it) => it.text);
      if (items.length) send({ type: "history", items });
    } catch {
      /* no history / unreadable */
    }
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
        // Re-auth on the same socket (token switch): release the previous session
        // from this socket so it isn't orphaned.
        if (us) us.detach(ws);
        token = msg.token as string;
        us = getOrCreateSession(token);
        us.attach(ws); // reconnect flushes anything buffered while away
        if (!us.claude) {
          us.cwd = config.chatsDir;
          us.contextLabel = "Claude";
          us.systemPrompt = undefined;
          applyScope(us, "chat");
          us.rebuildClaude();
        }
        send({ type: "authed", consented: hasConsent(token), demoMode: config.demoMode, push: pushConfigured(), claude: isConnected(), planMode: us.planMode });
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
        applyScope(us, "chat");
        us.rebuildClaude();
        send({ type: "chat_opened", context: us.contextLabel, kind: "chat" });
        return;

      case "open_chat": {
        const sid = safeName(String(msg.id ?? ""));
        if (!sid) return send({ type: "error", message: "invalid session id" });
        us.cwd = chatsDir();
        us.contextLabel = "Conversation";
        us.systemPrompt = undefined;
        applyScope(us, "chat");
        us.rebuildClaude(sid);
        send({ type: "chat_opened", context: us.contextLabel, kind: "chat" });
        await replayHistory(sid, us.cwd);
        return;
      }

      case "open_project": {
        const proj = await appProject(String(msg.id ?? ""));
        if (!proj) return send({ type: "error", message: "invalid project" });
        us.cwd = proj.path;
        us.contextLabel = proj.name;
        us.systemPrompt = proj.instructions || undefined;
        applyScope(us, "project");
        const last = await listSessions({ dir: us.cwd, limit: 1 }).catch(() => []);
        us.rebuildClaude(last[0]?.sessionId);
        send({ type: "chat_opened", context: us.contextLabel, kind: "project" });
        await replayHistory(last[0]?.sessionId, us.cwd);
        return;
      }

      case "open_code": {
        const repo = codeRepoPath(String(msg.id ?? ""));
        if (!repo) return send({ type: "error", message: "invalid repo" });
        us.cwd = repo;
        us.contextLabel = String(msg.id);
        us.systemPrompt = undefined;
        applyScope(us, "code");
        const last = await listSessions({ dir: us.cwd, limit: 1 }).catch(() => []);
        us.rebuildClaude(last[0]?.sessionId);
        send({ type: "chat_opened", context: us.contextLabel, kind: "code" });
        await replayHistory(last[0]?.sessionId, us.cwd);
        return;
      }

      // --- Runtime controls (SDK streaming-input methods) -----------------
      case "stop":
        await us.claude?.interrupt();
        send({ type: "stopped" });
        return;

      case "confirm":
        us.claude?.resolveConfirm(String(msg.id ?? ""), Boolean(msg.allow));
        return;

      case "plan_mode":
        us.planMode = Boolean(msg.on);
        await us.claude?.setPermissionMode(us.planMode ? "plan" : "acceptEdits");
        send({ type: "plan_mode", on: us.planMode });
        return;

      case "set_model":
        us.model = String(msg.model ?? "") || undefined;
        await us.claude?.setModel(us.model);
        send({ type: "model_set", model: us.model ?? null });
        return;

      case "usage": {
        const usage = controlOk() ? await us.claude?.contextUsage() : null;
        send({ type: "usage_result", usage: usage ?? null });
        return;
      }

      case "rewind": {
        const result = await us.claude?.rewindLast();
        send({ type: "rewind_result", ...(result ?? { ok: false, error: "no session" }) });
        return;
      }

      // Watch replies with a sensor value the read_health/get_location tool asked for.
      case "watch_reply":
        us.claude?.resolveQuery(String(msg.id ?? ""), msg.data);
        return;

      case "models": {
        const models = controlOk() ? (await us.claude?.models()) ?? [] : [];
        send({ type: "models_result", models });
        return;
      }

      case "plan_usage": {
        const usage = controlOk() ? await us.claude?.planUsage() : null;
        send({ type: "plan_usage_result", usage: usage ?? null });
        return;
      }

      // --- Account & settings ---------------------------------------------
      case "account": {
        const account = controlOk() ? await us.claude?.accountInfo() : null;
        send({ type: "account_result", account: account ?? null });
        return;
      }

      case "settings_get":
        send({
          type: "settings_result",
          language: us.language,
          model: us.model ?? null,
          planMode: us.planMode,
          notifications: us.notifications,
        });
        return;

      case "set_language":
        await us.setLanguage(String(msg.lang ?? ""));
        send({ type: "language_set", lang: us.language });
        return;

      case "set_notifications":
        us.notifications = Boolean(msg.on);
        send({ type: "notifications_set", on: us.notifications });
        return;

      // --- Session management (Chats): rename / delete / branch ------------
      case "rename_session": {
        const sid = safeName(String(msg.id ?? ""));
        if (!sid) return send({ type: "error", message: "invalid session id" });
        try {
          await renameSession(sid, String(msg.title ?? "").slice(0, 120), { dir: chatsDir() });
          send({ type: "session_renamed", id: sid, title: msg.title });
        } catch (err) {
          send({ type: "error", message: `rename failed: ${String(err).slice(0, 80)}` });
        }
        return;
      }

      case "delete_session": {
        const sid = safeName(String(msg.id ?? ""));
        if (!sid) return send({ type: "error", message: "invalid session id" });
        try {
          await deleteSession(sid, { dir: chatsDir() });
          send({ type: "session_deleted", id: sid });
        } catch (err) {
          send({ type: "error", message: `delete failed: ${String(err).slice(0, 80)}` });
        }
        return;
      }

      case "branch_session": {
        const sidB = safeName(String(msg.id ?? ""));
        if (!sidB) return send({ type: "error", message: "invalid session id" });
        try {
          const fork = await forkSession(sidB, { dir: chatsDir() });
          us.cwd = chatsDir();
          us.contextLabel = "Branch";
          us.systemPrompt = undefined;
          applyScope(us, "chat");
          us.rebuildClaude(fork.sessionId);
          send({ type: "chat_opened", context: us.contextLabel, kind: "chat" });
          await replayHistory(fork.sessionId, us.cwd);
        } catch (err) {
          send({ type: "error", message: `branch failed: ${String(err).slice(0, 80)}` });
        }
        return;
      }

      case "report":
        addReport(String(msg.reason ?? "user_report"), String(msg.text ?? ""));
        send({ type: "reported" });
        return;

      // --- Voice pipeline (fas 2) -----------------------------------------
      case "audio_start":
        if (!guardNoRate()) return; // don't buffer for an unconnected/unconsented user
        audio = { mime: String(msg.mime ?? "audio/webm"), chunks: [], bytes: 0 };
        return;

      case "audio_chunk":
        if (audio && typeof msg.data === "string") {
          const chunk = Buffer.from(msg.data, "base64");
          audio.bytes += chunk.length;
          if (audio.bytes > MAX_AUDIO_BYTES) { audio = null; send({ type: "error", message: "recording too long" }); return; }
          audio.chunks.push(chunk);
        }
        return;

      case "audio_end": {
        if (!audio) return;
        const buf = Buffer.concat(audio.chunks);
        const mime = audio.mime;
        audio = null;
        // guardNoRate here; the single rate-limit slot is consumed by runPrompt below.
        if (!guardNoRate()) return;
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
          else send({ type: "error", message: "transcription failed" });
        }
        return;
      }
    }
  });

  // Socket dropped: keep the Claude turn running server-side so it can finish and
  // push a notification. The session is torn down only after an idle grace period.
  ws.on("close", () => us?.detach(ws));
  ws.on("error", () => us?.detach(ws));
});

server.listen(config.port, () => {
  console.log(`Backend listening on :${config.port}`);
  console.log(`  data dir:   ${config.dataDir || "(ephemeral /tmp)"}`);
  console.log(`  model:      ${config.model ?? `chat=${config.models.chat || "default"} code=${config.models.code || "default"}`}`);
  console.log(`  fallback:   ${config.fallbackModel || "(none)"}`);
  console.log(`  demoMode:   ${config.demoMode}`);
  console.log(`  suggest:    ${config.promptSuggestions}  progress: ${config.agentProgress}`);
  console.log(`  sandbox:    ${config.sandbox}  checkpointing: ${config.checkpointing}`);
  console.log(`  watchTools: ${config.watchTools}  skills: ${config.skills || "off"}`);
  console.log(`  login:      ${config.forceSubscription ? "subscription-forced" : "auto"}  lang: ${config.language || "auto"}  denyRules: ${config.denyRules.length}`);
  console.log(`  mcp:        ${mcpConfigured() ? Object.keys(mcpServers()).join(", ") : "none"}`);
  console.log(`  stt:        ${sttConfigured() ? "configured" : "not configured"}`);
  console.log(`  push:       ${pushConfigured() ? "configured" : "not configured (logs instead)"}`);
  const cs = credStatus();
  console.log(`  claude:     ${cs.connected ? `${cs.kind} (${cs.source})` : "NOT connected — open /connect"}`);
});
