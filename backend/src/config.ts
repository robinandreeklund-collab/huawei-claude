// Central runtime configuration, read once from the environment.

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Persistent base directory. On an ephemeral host (Cloud Run, Render free) /tmp is
// wiped on restart. Point DATA_DIR at a mounted disk to keep chats/projects/code
// history, the connected credential, and the CLI's own session store across
// restarts. When set, the per-surface dirs and CRED_FILE default under it, and the
// CLI's config dir (CLAUDE_CONFIG_DIR, where conversation transcripts live) too.
const dataDir = process.env.DATA_DIR || "";
const under = (name: string, fallback: string): string =>
  dataDir ? `${dataDir.replace(/\/$/, "")}/${name}` : fallback;

// Make the CLI persist its session transcripts on the durable disk as well, so
// resume/history survives a redeploy. (The SDK's sessionStore mirror is the other
// option; a mounted disk is simpler and needs no adapter.)
if (dataDir && !process.env.CLAUDE_CONFIG_DIR) {
  process.env.CLAUDE_CONFIG_DIR = under("claude-config", "/tmp/claude-config");
}

export const config = {
  port: num(process.env.PORT, 8080),
  model: process.env.CLAUDE_MODEL || undefined, // global override; wins over per-surface models
  workspaceDir: process.env.WORKSPACE_DIR || "/tmp/workspace",
  dataDir,

  // The app mirrors Claude's three surfaces, each app-native in this backend:
  //   Chats       — plain Claude conversations (no repo)      → chatsDir
  //   Projects    — named projects with their own context     → projectsDir/<id>
  //   Claude Code — code sessions in real git repos           → codeDir/<repo>
  chatsDir: process.env.CHATS_DIR || under("chats", "/tmp/chats"),
  projectsDir: process.env.PROJECTS_DIR || under("projects", "/tmp/projects"),
  codeDir: process.env.CODE_DIR || under("code", "/tmp/code"),

  // Per-surface model + reasoning effort. A watch wants fast, glanceable answers
  // in Chats (small model, low effort) and full understanding in Claude Code
  // (default/larger model, higher effort). Empty string => inherit the SDK default.
  // The global CLAUDE_MODEL, if set, overrides all three.
  models: {
    chat: process.env.CHAT_MODEL ?? "claude-haiku-4-5-20251001",
    project: process.env.PROJECT_MODEL ?? "",
    code: process.env.CODE_MODEL ?? "",
  },
  // Effort is off by default (empty) so nothing breaks on a model that doesn't
  // support it; set CHAT_EFFORT=low / CODE_EFFORT=high to opt in.
  effort: {
    chat: process.env.CHAT_EFFORT ?? "",
    project: process.env.PROJECT_EFFORT ?? "",
    code: process.env.CODE_EFFORT ?? "",
  },

  // Resilience: try these models if the primary is overloaded (comma-separated),
  // and a hard turn cap so a single long session can't run away.
  fallbackModel: process.env.FALLBACK_MODEL || "",
  maxTurns: num(process.env.MAX_TURNS, 0), // 0 => unset
  // API-side token budget (alpha, beta header). 0 => off.
  taskBudgetTokens: num(process.env.TASK_BUDGET_TOKENS, 0),

  // Real next-prompt suggestions from the model, and periodic progress summaries
  // for long turns (used for the status line and the push notification body).
  promptSuggestions: bool(process.env.PROMPT_SUGGESTIONS, true),
  agentProgress: bool(process.env.AGENT_PROGRESS, true),
  // SessionStart hook that tells Claude to keep answers short and glanceable
  // (it's driving a small round watch screen). Disable with WATCH_GUIDANCE=false.
  watchGuidance: bool(process.env.WATCH_GUIDANCE, true),
  // Give Claude in-process tools to act on the watch (vibrate/notify/timer/health/
  // location). This is what makes the watch an agent surface, not just a terminal.
  watchTools: bool(process.env.WATCH_TOOLS, true),
  // Enable SKILL.md skills (e.g. pdf, docx). "all" | comma-list | "" (off).
  skills: process.env.SKILLS || "",

  // Login / settings policy (passed to the SDK's `settings` layer).
  //  - forceSubscription: lock the login method to Claude Pro/Max ("claudeai")
  //    so the backend never silently falls back to Console/API billing.
  //  - denyRules: declarative permission deny rules, e.g. "Bash(git push:*)".
  //  - coAuthored: include the Co-authored-by trailer in commits Claude makes.
  //  - language: default language for Claude's replies (per-user overridable).
  forceSubscription: bool(process.env.FORCE_SUBSCRIPTION, true),
  denyRules: list(process.env.DENY_RULES),
  coAuthored: bool(process.env.CO_AUTHORED, true),
  language: process.env.CLAUDE_LANGUAGE || "",

  // "Connect Claude" page: paste your `claude setup-token` credential once instead
  // of setting it as an env var. Optional ADMIN_SECRET gates who may set it.
  credFile: process.env.CRED_FILE || under("claude-cred.json", "/tmp/claude-cred.json"),
  adminSecret: process.env.ADMIN_SECRET || "",

  // Tool safety. disallowedTools removes tools entirely from the model's context.
  // sandbox isolates command execution (needs bubblewrap on Linux; degrades
  // gracefully when unavailable). checkpointing lets Claude Code sessions be
  // rewound (undo) via rewindFiles().
  disallowedTools: list(process.env.DISALLOWED_TOOLS),
  sandbox: bool(process.env.SANDBOX, false),
  checkpointing: bool(process.env.CHECKPOINTING, true),

  // MCP servers (GitHub, Jira, …) as a JSON object, e.g.
  //   MCP_CONFIG={"github":{"type":"http","url":"https://…","headers":{"Authorization":"Bearer …"}}}
  // Passed straight to the Agent SDK's mcpServers option. Empty => none.
  mcpConfigJson: process.env.MCP_CONFIG || "",

  // Demo / sandbox mode — used for the instance an AppGallery reviewer tests
  // against. Isolated workspace, seeded example repo, hard budget + rate caps.
  demoMode: bool(process.env.DEMO_MODE, false),
  demoBudgetUsd: num(process.env.DEMO_BUDGET_USD, 1.0),
  rateLimitPerMin: num(process.env.RATE_LIMIT_PER_MIN, 12),

  // Huawei Push Kit (background notifications to the watch). Unset => logs instead.
  push: {
    appId: process.env.HUAWEI_PUSH_APP_ID || "",
    clientId: process.env.HUAWEI_PUSH_CLIENT_ID || "",
    clientSecret: process.env.HUAWEI_PUSH_CLIENT_SECRET || "",
    detachedTtlMs: num(process.env.DETACHED_TTL_MS, 10 * 60 * 1000),
  },

  // Speech-to-text (fas 2). Any OpenAI-compatible /audio/transcriptions endpoint.
  stt: {
    apiUrl: process.env.STT_API_URL || "",
    apiKey: process.env.STT_API_KEY || "",
    model: process.env.STT_MODEL || "whisper-1",
    language: process.env.STT_LANGUAGE || "sv",
  },
};

/** Parsed MCP server config (validated JSON object), or empty when unset/invalid. */
export function mcpServers(): Record<string, unknown> {
  if (!config.mcpConfigJson) return {};
  try {
    const parsed = JSON.parse(config.mcpConfigJson);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    console.warn("[mcp] MCP_CONFIG is not valid JSON — ignoring");
    return {};
  }
}

export const sttConfigured = (): boolean =>
  Boolean(config.stt.apiUrl && config.stt.apiKey);

export const pushConfigured = (): boolean =>
  Boolean(config.push.appId && config.push.clientId && config.push.clientSecret);

export const mcpConfigured = (): boolean => Object.keys(mcpServers()).length > 0;

/**
 * SDK `settings` object built from config, with an optional per-user language.
 * Empty keys are omitted so we never override a lower-precedence source with a blank.
 */
export function buildSettings(language?: string): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  if (config.forceSubscription) s.forceLoginMethod = "claudeai";
  if (config.denyRules.length) s.permissions = { deny: config.denyRules };
  s.includeCoAuthoredBy = config.coAuthored;
  const lang = language || config.language;
  if (lang) s.language = lang;
  return s;
}
