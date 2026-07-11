// Wraps a single Claude Code session (Claude Agent SDK) behind a simple
// push/emit interface. Each connected watch gets one ClaudeSession.
//
// query() takes a streaming input (AsyncIterable of SDKUserMessage), which lets
// us keep one long-lived Claude Code conversation per connection and feed it new
// prompts as the user speaks/types. Streaming input mode also unlocks the runtime
// control methods (interrupt, setModel, setPermissionMode, getContextUsage,
// rewindFiles) used by the watch.

import {
  query,
  getSessionMessages,
  type Query,
  type SDKUserMessage,
  type SDKMessage,
  type CanUseTool,
  type PermissionMode,
  type HookCallbackMatcher,
} from "@anthropic-ai/claude-agent-sdk";
import { moderate, FILTERED_NOTICE } from "./moderation.js";
import { spawnEnv } from "./claude-cred.js";
import { createWatchToolServer } from "./watch-tools.js";

type Emit = (event: Record<string, unknown>) => void;

interface SessionOpts {
  cwd: string;
  model?: string;
  /** Reasoning effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' (empty => inherit). */
  effort?: string;
  /** Resume an existing Claude conversation by session UUID. */
  resume?: string;
  /** Custom system prompt (used to carry a Project's instructions/context). */
  systemPrompt?: string;
  /** 'plan' = read-only planning; 'acceptEdits' = auto-accept file edits (default). */
  permissionMode?: PermissionMode;
  /** Comma-separated fallback models tried when the primary is overloaded. */
  fallbackModel?: string;
  /** Hard turn cap (0 => unset). */
  maxTurns?: number;
  /** Hard USD budget for the whole session query (0 => unset). */
  maxBudgetUsd?: number;
  /** API-side token budget so the model paces itself (0 => off). */
  taskBudgetTokens?: number;
  /** Ask the model to emit a predicted next prompt after each turn. */
  promptSuggestions?: boolean;
  /** Periodic progress summaries for long turns. */
  agentProgress?: boolean;
  /** MCP servers to expose as tools. */
  mcpServers?: Record<string, unknown>;
  /** Tools removed entirely from the model's context. */
  disallowedTools?: string[];
  /** Sandbox command execution (degrades gracefully if unavailable). */
  sandbox?: boolean;
  /** Enable file checkpointing so the session can be rewound (undo). */
  checkpointing?: boolean;
  /** Which filesystem setting sources to load (e.g. ['project'] to read CLAUDE.md). */
  settingSources?: ("user" | "project" | "local")[];
  /** Inject a SessionStart hint to keep answers short/glanceable for the watch. */
  watchGuidance?: boolean;
  /** Give Claude tools to act on the watch (vibrate/notify/timer/health/location). */
  watchTools?: boolean;
  /** Enable SKILL.md skills: 'all' or a list of skill names. */
  skills?: string[] | "all";
  /** Inline Settings object (login policy, permission rules, language, …). */
  settings?: Record<string, unknown>;
  /** Like `settings` but evaluated at start() time (picks up late changes). */
  settingsProvider?: () => Record<string, unknown>;
  /** Called with the per-turn cost so the server can enforce a budget cap. */
  onCost?: (usd: number) => void;
  /** Called when moderation filters a message, for the report log. */
  onFiltered?: (reason: string, text: string) => void;
  /** Called with the model's predicted next prompt. */
  onSuggestion?: (text: string) => void;
  /** Called with a short progress summary while a long turn runs. */
  onProgress?: (text: string) => void;
}

// A minimal push-driven async queue turning discrete prompt() calls into the
// AsyncIterable the SDK expects.
class MessageQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private resolvers: ((v: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    let resolve;
    while ((resolve = this.resolvers.shift())) {
      resolve({ value: undefined as never, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift() as T;
        continue;
      }
      if (this.closed) return;
      const result = await new Promise<IteratorResult<T>>((r) =>
        this.resolvers.push(r),
      );
      if (result.done) return;
      yield result.value;
    }
  }
}

const DANGEROUS = /\b(git\s+push|rm\s+-rf|curl|wget|npm\s+publish)\b/;
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

// Used only if the watch never answers a sensor query (offline/backgrounded).
function fallbackReading(kind: string): Record<string, unknown> {
  if (kind === "location") return { lat: 59.33, lon: 18.06, place: "Stockholm", simulated: true };
  return { heartRate: 72, steps: 4200, simulated: true };
}

// Injected via a SessionStart hook so it applies to every surface (chats, projects,
// code) without disturbing a Project's own systemPrompt.
const WATCH_GUIDANCE =
  "You are being controlled from a small round smartwatch screen. Keep replies " +
  "short, glanceable and conversational — usually a sentence or two. Avoid long " +
  "code dumps; summarize what you did and offer to expand if asked.";

// A SessionStart hook that adds the watch guidance as extra context.
const watchGuidanceHook: HookCallbackMatcher = {
  hooks: [
    async () => ({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: WATCH_GUIDANCE },
    }),
  ],
};

export class ClaudeSession {
  private queue = new MessageQueue<SDKUserMessage>();
  private q: Query | null = null;
  private started = false;
  private sessionId: string | null = null;
  // Incremental moderation of the text currently being streamed, so flagged
  // content is cut off mid-stream instead of shown and then retracted.
  private streamBuf = "";
  private streamBlocked = false;
  // Pending phone confirmations for dangerous tool calls (spec §7).
  private pendingConfirm = new Map<string, { resolve: (allow: boolean) => void; timer: NodeJS.Timeout }>();
  private confirmSeq = 0;
  // Pending watch data queries (read_health / get_location round-trips).
  private pendingQuery = new Map<string, { resolve: (data: unknown) => void; timer: NodeJS.Timeout }>();
  private querySeq = 0;

  constructor(
    private readonly emit: Emit,
    private readonly opts: SessionOpts,
  ) {}

  /** Feed a new user prompt into the running Claude Code conversation. */
  prompt(text: string): void {
    if (!this.started) this.start();
    this.queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
  }

  private canUseTool: CanUseTool = async (toolName, input) => {
    const command = String((input as { command?: unknown }).command ?? "");
    if (toolName === "Bash" && DANGEROUS.test(command)) {
      // Real confirmation loop: surface it to the phone and wait for a decision.
      const id = `c${++this.confirmSeq}`;
      this.emit({ type: "needs_confirmation", id, tool: toolName, command });
      const allow = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          if (this.pendingConfirm.delete(id)) resolve(false);
        }, CONFIRM_TIMEOUT_MS);
        this.pendingConfirm.set(id, { resolve, timer });
      });
      return allow
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "Denied by user" };
    }
    return { behavior: "allow", updatedInput: input };
  };

  /** Resolve a pending confirmation from the client (allow/deny). */
  resolveConfirm(id: string, allow: boolean): void {
    const p = this.pendingConfirm.get(id);
    if (p) {
      clearTimeout(p.timer);
      this.pendingConfirm.delete(id);
      p.resolve(allow);
    }
  }

  // Ask the watch for a sensor value (read_health / get_location), falling back to
  // a simulated reading if the watch doesn't answer in time.
  private queryWatch = (kind: string): Promise<unknown> =>
    new Promise((resolve) => {
      const id = `w${++this.querySeq}`;
      const timer = setTimeout(() => {
        if (this.pendingQuery.delete(id)) resolve(fallbackReading(kind));
      }, 8000);
      this.pendingQuery.set(id, { resolve, timer });
      this.emit({ type: "watch_query", id, kind });
    });

  /** Resolve a pending watch data query with the value the watch reported. */
  resolveQuery(id: string, data: unknown): void {
    const p = this.pendingQuery.get(id);
    if (p) {
      clearTimeout(p.timer);
      this.pendingQuery.delete(id);
      p.resolve(data);
    }
  }

  private start(): void {
    this.started = true;
    const o = this.opts;
    // Merge user-configured MCP servers with the in-process "watch" tool server.
    const mcp: Record<string, unknown> = { ...(o.mcpServers ?? {}) };
    if (o.watchTools) mcp.watch = createWatchToolServer(this.emit, this.queryWatch);
    // Resolve settings at start time (so a language change before the first turn applies).
    const settings = o.settingsProvider ? o.settingsProvider() : o.settings;
    this.q = query({
      prompt: this.queue,
      options: {
        cwd: o.cwd,
        ...(o.model ? { model: o.model } : {}),
        ...(o.effort ? { effort: o.effort as never } : {}),
        ...(o.resume ? { resume: o.resume } : {}),
        ...(o.systemPrompt ? { systemPrompt: o.systemPrompt } : {}),
        ...(o.fallbackModel ? { fallbackModel: o.fallbackModel } : {}),
        ...(o.maxTurns ? { maxTurns: o.maxTurns } : {}),
        ...(o.maxBudgetUsd ? { maxBudgetUsd: o.maxBudgetUsd } : {}),
        ...(o.taskBudgetTokens ? { taskBudget: { total: o.taskBudgetTokens } } : {}),
        ...(Object.keys(mcp).length ? { mcpServers: mcp as never } : {}),
        ...(o.disallowedTools?.length ? { disallowedTools: o.disallowedTools } : {}),
        ...(o.sandbox ? { sandbox: { enabled: true, failIfUnavailable: false } } : {}),
        ...(o.checkpointing ? { enableFileCheckpointing: true } : {}),
        ...(o.settingSources ? { settingSources: o.settingSources } : {}),
        ...(o.skills ? { skills: o.skills } : {}),
        ...(settings && Object.keys(settings).length ? { settings: settings as never } : {}),
        ...(o.promptSuggestions ? { promptSuggestions: true } : {}),
        ...(o.agentProgress ? { agentProgressSummaries: true } : {}),
        ...(o.watchGuidance ? { hooks: { SessionStart: [watchGuidanceHook] } } : {}),
        env: spawnEnv(), // inject the connected Claude credential (subscription/API key)
        includePartialMessages: true, // stream assistant text token-by-token to the watch
        permissionMode: o.permissionMode ?? "acceptEdits",
        canUseTool: this.canUseTool,
      },
    });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (!this.q) return;
    try {
      for await (const message of this.q) this.forward(message);
    } catch (err) {
      this.emit({ type: "error", message: String(err) });
    }
  }

  // Live token stream (SDKPartialAssistantMessage). We forward text deltas so the
  // watch renders the answer word-by-word, running moderation on the growing text
  // so a flagged block is stopped before it's fully shown.
  private forwardStream(message: SDKMessage): void {
    if (message.type !== "stream_event") return;
    const ev = message.event as {
      type: string;
      content_block?: { type?: string };
      delta?: { type?: string; text?: string };
    };
    if (ev.type === "content_block_start") {
      if (ev.content_block?.type === "text") {
        this.streamBuf = "";
        this.streamBlocked = false;
        this.emit({ type: "stream_start" });
      }
    } else if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
        if (this.streamBlocked) return;
        this.streamBuf += ev.delta.text;
        if (moderate(this.streamBuf).flagged) {
          this.streamBlocked = true;
          this.emit({ type: "stream_filter" });
          return;
        }
        this.emit({ type: "stream_delta", text: ev.delta.text });
      }
    } else if (ev.type === "content_block_stop") {
      this.emit({ type: "stream_end" });
    }
  }

  private forward(message: SDKMessage): void {
    // Capture the session id from any message that carries it (for rewind).
    const sid = (message as { session_id?: string }).session_id;
    if (sid) this.sessionId = sid;

    if (message.type === "stream_event") {
      this.forwardStream(message);
    } else if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            const verdict = moderate(block.text);
            if (verdict.flagged) {
              this.opts.onFiltered?.(verdict.reason ?? "flagged", block.text);
              this.emit({ type: "assistant", text: FILTERED_NOTICE, filtered: true, streamed: true });
            } else {
              this.emit({ type: "assistant", text: block.text, streamed: true });
            }
          } else if (block.type === "tool_use") {
            this.emit({ type: "tool_use", name: block.name, input: block.input });
          }
        }
      }
    } else if (message.type === "system") {
      // Progress summaries for long turns (agentProgressSummaries).
      const m = message as { subtype?: string; summary?: string; description?: string; last_tool_name?: string };
      if (m.subtype === "task_progress") {
        const text = m.summary || m.description || m.last_tool_name || "";
        if (text) this.opts.onProgress?.(text);
      }
    } else if (message.type === "prompt_suggestion") {
      const s = (message as { suggestion?: string }).suggestion;
      if (s) this.opts.onSuggestion?.(s);
    } else if (message.type === "result") {
      this.opts.onCost?.(message.total_cost_usd);
      this.emit({
        type: "result",
        cost: message.total_cost_usd,
        result: message.subtype === "success" ? message.result : message.subtype,
      });
      this.emit({ type: "turn_done" });
    }
  }

  // --- Runtime controls (streaming-input mode) ------------------------------

  /** Start the CLI without sending a prompt, so control methods (account/usage/models) work. */
  ensureStarted(): void {
    if (!this.started) this.start();
  }

  /** Whether the underlying CLI query has been started (a prompt or control call happened). */
  isRunning(): boolean {
    return this.started;
  }

  // Race a control request against a timeout so a slow/hung CLI can't wedge the WS.
  private withTimeout<T>(p: Promise<T> | undefined, ms: number, fallback: T): Promise<T> {
    return Promise.race([
      (p ?? Promise.resolve(fallback)).catch(() => fallback),
      new Promise<T>((r) => setTimeout(() => r(fallback), ms)),
    ]);
  }

  /** Stop the current turn (barge-in). */
  async interrupt(): Promise<void> {
    await this.q?.interrupt?.().catch(() => {});
  }

  /** Authenticated account: email, subscription type, provider. Null if unavailable. */
  async accountInfo(): Promise<unknown> {
    this.ensureStarted();
    return this.withTimeout(this.q?.accountInfo?.(), 10000, null);
  }

  /** Apply settings live (e.g. language, permission rules). */
  async applyFlagSettings(settings: Record<string, unknown>): Promise<void> {
    this.ensureStarted();
    await this.q?.applyFlagSettings?.(settings as never).catch(() => {});
  }

  /** Switch permission mode live (e.g. toggle plan mode). */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.q?.setPermissionMode?.(mode).catch(() => {});
  }

  /** Switch model live. */
  async setModel(model?: string): Promise<void> {
    await this.q?.setModel?.(model).catch(() => {});
  }

  /** Context-window usage breakdown, or null if unavailable. */
  async contextUsage(): Promise<unknown> {
    this.ensureStarted();
    return this.withTimeout(this.q?.getContextUsage?.(), 8000, null);
  }

  /** Claude-plan rate-limit windows (5h / 7d), or null if unavailable / API key. */
  async planUsage(): Promise<unknown> {
    this.ensureStarted();
    const q = this.q as unknown as {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: () => Promise<unknown>;
    } | null;
    return this.withTimeout(q?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.(), 8000, null);
  }

  /** Available models for a picker, or [] if unavailable. */
  async models(): Promise<unknown[]> {
    this.ensureStarted();
    return this.withTimeout<unknown[]>(this.q?.supportedModels?.(), 8000, []);
  }

  /** Re-send the initialize request after a transport gap; redelivers pending confirmations. */
  async reinitialize(): Promise<void> {
    await this.q?.reinitialize?.().catch(() => {});
  }

  /** Undo the file changes from the most recent turn (rewind to last user message). */
  async rewindLast(): Promise<{ ok: boolean; error?: string; files?: number }> {
    if (!this.q || !this.sessionId) return { ok: false, error: "no session" };
    const msgs = await getSessionMessages(this.sessionId, { dir: this.opts.cwd }).catch(() => []);
    const users = msgs.filter((m) => m.type === "user");
    const target = users[users.length - 1];
    if (!target) return { ok: false, error: "nothing to undo" };
    try {
      const res = (await this.q.rewindFiles(target.uuid)) as { canRewind?: boolean; error?: string; filesChanged?: number };
      return { ok: Boolean(res.canRewind), error: res.error, files: res.filesChanged };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  close(): void {
    for (const p of this.pendingConfirm.values()) { clearTimeout(p.timer); p.resolve(false); }
    this.pendingConfirm.clear();
    for (const p of this.pendingQuery.values()) { clearTimeout(p.timer); p.resolve({ error: "session closed" }); }
    this.pendingQuery.clear();
    this.queue.close();
    this.q?.close?.();
  }
}
