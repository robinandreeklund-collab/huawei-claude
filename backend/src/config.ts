// Central runtime configuration, read once from the environment.

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  model: process.env.CLAUDE_MODEL || undefined, // undefined => SDK/CLI default
  workspaceDir: process.env.WORKSPACE_DIR || "/tmp/workspace",

  // Each subdirectory of projectsDir is a "project" (a repo Claude Code works in).
  // The active project's directory is the cwd for chats and code browsing.
  projectsDir: process.env.PROJECTS_DIR || "/tmp/projects",

  // Demo / sandbox mode — used for the instance an AppGallery reviewer tests
  // against. Isolated workspace, seeded example repo, hard budget + rate caps,
  // and no access to the operator's real repo or key beyond what env provides.
  demoMode: bool(process.env.DEMO_MODE, false),
  demoBudgetUsd: Number(process.env.DEMO_BUDGET_USD ?? 1.0),
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 12),

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
