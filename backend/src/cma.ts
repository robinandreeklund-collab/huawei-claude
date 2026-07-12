// Managed Agents (CMA) client — the "model A" cloud path.
//
// Drives Anthropic-hosted Claude Code sessions tied to GitHub repos via an
// API key (sk-ant-api…). This is billed per usage — NOT a Max subscription.
// The watch backend can list, create, resume, and stream these sessions, giving
// a public product: everyone controls real Claude Code on their own repos from
// their wrist. See docs: https://platform.claude.com/docs/en/managed-agents

const API_BASE = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const BETA = "managed-agents-2026-04-01";

export interface CmaConfig {
  apiKey: string;
  model?: string; // default claude-sonnet-5
  agentName?: string;
  envName?: string;
}

export interface Provisioned {
  agentId: string;
  agentVersion: number;
  environmentId: string;
}

export interface RepoRef {
  url: string; // https://github.com/owner/repo
  token: string; // GitHub PAT (contents read, or read+write for pushes)
  branch?: string;
}

export interface SessionSummary {
  id: string;
  title?: string;
  status: string;
  updatedAt?: string;
}

/** One CMA event off the SSE stream (thin — only the fields we map). */
export interface CmaEvent {
  type: string;
  content?: Array<{ type: string; text?: string }>;
  name?: string;
  id?: string;
  evaluated_permission?: string;
  stop_reason?: { type?: string };
  error?: { message?: string };
  [k: string]: unknown;
}

function headers(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": BETA,
    "content-type": "application/json",
  };
}

async function apiCall(apiKey: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: headers(apiKey),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = json?.error?.message || text || `HTTP ${res.status}`;
    throw new Error(`CMA ${method} ${path} → ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  return json;
}

// --- Provisioning: one Agent + one Environment, created once and cached -------

async function createAgent(cfg: CmaConfig): Promise<{ id: string; version: number }> {
  const j = await apiCall(cfg.apiKey, "POST", "/v1/agents", {
    name: cfg.agentName || "Watch Claude Code",
    model: cfg.model || "claude-sonnet-5",
    system:
      "You are Claude Code, driven from a smartwatch. Keep user-facing messages " +
      "short and glanceable — do the work with your tools and summarize the outcome " +
      "in one or two sentences. Lead with what happened. Ask for confirmation only " +
      "on destructive or irreversible actions.",
    tools: [{ type: "agent_toolset_20260401" }],
  });
  return { id: j.id, version: j.version };
}

async function createEnvironment(cfg: CmaConfig): Promise<string> {
  const j = await apiCall(cfg.apiKey, "POST", "/v1/environments", {
    name: cfg.envName || "watch-cc-env",
    config: { type: "cloud", networking: { type: "unrestricted" } },
  });
  return j.id;
}

/** Create the agent + environment once; reuse their IDs from a cache file. */
export async function ensureProvisioned(cfg: CmaConfig, cacheFile: string): Promise<Provisioned> {
  const { readFile, writeFile } = await import("node:fs/promises");
  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as Provisioned;
    if (cached.agentId && cached.environmentId) return cached;
  } catch {
    /* not provisioned yet */
  }
  const agent = await createAgent(cfg);
  const environmentId = await createEnvironment(cfg);
  const p: Provisioned = { agentId: agent.id, agentVersion: agent.version, environmentId };
  await writeFile(cacheFile, JSON.stringify(p, null, 2)).catch(() => {});
  return p;
}

// --- Sessions -----------------------------------------------------------------

export async function createSession(
  cfg: CmaConfig,
  p: Provisioned,
  repo: RepoRef | undefined,
  userId: string,
  title?: string,
): Promise<{ id: string }> {
  const j = await apiCall(cfg.apiKey, "POST", "/v1/sessions", {
    agent: { type: "agent", id: p.agentId, version: p.agentVersion },
    environment_id: p.environmentId,
    title: title || (repo ? repo.url.replace(/\/+$/, "").split("/").pop() : "Claude Code"),
    // A repo is optional — without one the agent runs in an empty /workspace
    // container (still a valid coding session); with one it works on real code.
    ...(repo
      ? {
          resources: [
            {
              type: "github_repository",
              url: repo.url,
              authorization_token: repo.token,
              ...(repo.branch ? { checkout: { type: "branch", name: repo.branch } } : {}),
            },
          ],
        }
      : {}),
    metadata: { app: "watch-cc", user: userId },
  });
  return { id: j.id };
}

/** List this app's sessions for a user (newest first), for the watch's list. */
export async function listSessions(cfg: CmaConfig, userId?: string): Promise<SessionSummary[]> {
  const j = await apiCall(cfg.apiKey, "GET", "/v1/sessions");
  const items = (j.data || []) as any[];
  const mine = items.filter(
    (s) => s?.metadata?.app === "watch-cc" && (!userId || s?.metadata?.user === userId),
  );
  return mine
    .map((s) => ({ id: s.id, title: s.title, status: s.status, updatedAt: s.updated_at }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function sendMessage(cfg: CmaConfig, sessionId: string, text: string): Promise<void> {
  await apiCall(cfg.apiKey, "POST", `/v1/sessions/${sessionId}/events`, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  });
}

export async function confirmTool(
  cfg: CmaConfig,
  sessionId: string,
  toolUseId: string,
  allow: boolean,
  denyMessage?: string,
): Promise<void> {
  await apiCall(cfg.apiKey, "POST", `/v1/sessions/${sessionId}/events`, {
    events: [
      {
        type: "user.tool_confirmation",
        tool_use_id: toolUseId,
        result: allow ? "allow" : "deny",
        ...(denyMessage && !allow ? { deny_message: denyMessage } : {}),
      },
    ],
  });
}

export async function interrupt(cfg: CmaConfig, sessionId: string): Promise<void> {
  await apiCall(cfg.apiKey, "POST", `/v1/sessions/${sessionId}/events`, {
    events: [{ type: "user.interrupt" }],
  });
}

/** Replay the past events of a session (for resume — the watch's history). */
export async function listEvents(cfg: CmaConfig, sessionId: string): Promise<CmaEvent[]> {
  const j = await apiCall(cfg.apiKey, "GET", `/v1/sessions/${sessionId}/events`);
  return (j.data || []) as CmaEvent[];
}

/** Live event stream (SSE). Open this BEFORE sending a message so no events are
 *  missed. Yields parsed CMA events; ignores heartbeats. */
export async function* streamEvents(
  cfg: CmaConfig,
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<CmaEvent> {
  const res = await fetch(`${API_BASE}/v1/sessions/${sessionId}/events/stream`, {
    headers: headers(cfg.apiKey),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`CMA stream ${sessionId} → ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE events are separated by a blank line.
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          yield JSON.parse(data) as CmaEvent;
        } catch {
          /* heartbeat / non-JSON */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
