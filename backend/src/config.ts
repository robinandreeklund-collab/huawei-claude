// Central runtime configuration, read once from the environment.

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  model: process.env.CLAUDE_MODEL || undefined, // undefined => SDK/CLI default
  workspaceDir: process.env.WORKSPACE_DIR || "/tmp/workspace",

  // The app mirrors Claude's three surfaces, each app-native in this backend:
  //   Chats       — plain Claude conversations (no repo)      → chatsDir
  //   Projects    — named projects with their own context     → projectsDir/<id>
  //   Claude Code — code sessions in real git repos           → codeDir/<repo>
  chatsDir: process.env.CHATS_DIR || "/tmp/chats",
  projectsDir: process.env.PROJECTS_DIR || "/tmp/projects",
  codeDir: process.env.CODE_DIR || "/tmp/code",

  // "Connect Claude" page: paste your `claude setup-token` credential once instead
  // of setting it as an env var. Stored here (survives restarts only if CRED_FILE
  // is on a persistent disk). Optional ADMIN_SECRET gates who may set it.
  credFile: process.env.CRED_FILE || "/tmp/claude-cred.json",
  adminSecret: process.env.ADMIN_SECRET || "",

  // Demo / sandbox mode — used for the instance an AppGallery reviewer tests
  // against. Isolated workspace, seeded example repo, hard budget + rate caps,
  // and no access to the operator's real repo or key beyond what env provides.
  demoMode: bool(process.env.DEMO_MODE, false),
  demoBudgetUsd: Number(process.env.DEMO_BUDGET_USD ?? 1.0),
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 12),

  // Huawei Push Kit (background notifications to the watch). When Claude finishes
  // a turn while the app is backgrounded/disconnected, the backend pushes a
  // notification so the watch vibrates and alerts. Real integration, gated on
  // these credentials (from AppGallery Connect). Unset => logs instead of sends.
  push: {
    appId: process.env.HUAWEI_PUSH_APP_ID || "",
    clientId: process.env.HUAWEI_PUSH_CLIENT_ID || "",
    clientSecret: process.env.HUAWEI_PUSH_CLIENT_SECRET || "",
    // Idle grace before a detached (backgrounded) session's Claude run is torn down.
    detachedTtlMs: Number(process.env.DETACHED_TTL_MS ?? 10 * 60 * 1000),
  },

  // Speech-to-text (fas 2). Any OpenAI-compatible /audio/transcriptions endpoint
  // works: OpenAI Whisper, a self-hosted whisper.cpp server, Groq, etc.
  stt: {
    apiUrl: process.env.STT_API_URL || "", // e.g. https://api.openai.com/v1/audio/transcriptions
    apiKey: process.env.STT_API_KEY || "",
    model: process.env.STT_MODEL || "whisper-1",
    language: process.env.STT_LANGUAGE || "sv",
  },
};

export const sttConfigured = (): boolean =>
  Boolean(config.stt.apiUrl && config.stt.apiKey);

export const pushConfigured = (): boolean =>
  Boolean(config.push.appId && config.push.clientId && config.push.clientSecret);
