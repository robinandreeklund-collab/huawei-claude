// Per-user session that OUTLIVES the WebSocket connection.
//
// This is what makes "put your wrist down, get a buzz when Claude is done" real:
// a long Claude Code turn keeps running server-side even after the watch app
// backgrounds and the socket drops. Events emitted while detached are buffered
// (flushed when the app reconnects) and, on turn completion, a Push Kit
// notification is sent so the watch vibrates and alerts.

import type { WebSocket } from "ws";
import { config, mcpServers } from "./config.js";
import { ClaudeSession } from "./claude-session.js";
import { addSpend, addReport, getPushToken } from "./auth.js";
import { notify } from "./pushkit.js";

type Event = Record<string, unknown>;

const MAX_BUFFER = 400;

export class UserSession {
  claude: ClaudeSession | null = null;
  ws: WebSocket | null = null;
  foreground = false;
  pushToken?: string;

  // Navigation/context state — persists across reconnects so a resumed app
  // returns to the same working context.
  cwd = config.chatsDir;
  contextLabel = "Claude";
  systemPrompt?: string;
  model?: string;
  effort?: string;
  settingSources?: ("user" | "project" | "local")[];
  planMode = false;

  private buffer: Event[] = [];
  private lastAssistant = "";
  private lastProgress = "";
  private idleTimer: NodeJS.Timeout | null = null;
  private onDispose: () => void;

  constructor(
    public readonly token: string,
    onDispose: () => void,
  ) {
    this.pushToken = getPushToken(token);
    this.onDispose = onDispose;
  }

  // --- Connection lifecycle -------------------------------------------------

  attach(ws: WebSocket): void {
    this.ws = ws;
    this.foreground = true;
    this.clearIdle();
    this.flush(); // catch the reopened app up on anything it missed
    // Re-sync the CLI after a transport gap so any pending confirmation the loop
    // is blocked on is redelivered to us (reinitialize).
    void this.claude?.reinitialize();
  }

  /** Socket dropped (app backgrounded/closed). Keep Claude running. */
  detach(): void {
    this.ws = null;
    this.foreground = false;
    this.armIdle();
  }

  setForeground(active: boolean): void {
    this.foreground = active;
    if (active) this.flush();
  }

  private live(): boolean {
    return this.ws?.readyState === 1 && this.foreground;
  }

  private wsSend(ev: Event): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(ev));
  }

  private flush(): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    for (const ev of this.buffer) this.wsSend(ev);
    this.buffer = [];
  }

  // --- Claude event routing -------------------------------------------------

  /** The emit callback handed to ClaudeSession. */
  emit = (ev: Event): void => {
    if (ev.type === "assistant" && !ev.filtered) this.lastAssistant += `${ev.text ?? ""} `;

    // Live token-stream events are only useful in real time. When detached we
    // drop them (the buffered final `assistant` event carries the full text) so
    // a long streamed answer can't flood the buffer and evict real events.
    const transient =
      ev.type === "stream_start" || ev.type === "stream_delta" ||
      ev.type === "stream_end" || ev.type === "stream_filter" ||
      ev.type === "progress" || ev.type === "watch_query";

    if (this.live()) this.wsSend(ev);
    else if (!transient) {
      this.buffer.push(ev);
      if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    }

    if (ev.type === "turn_done") {
      if (!this.live()) this.pushSummary();
      this.lastAssistant = "";
    }
  };

  private pushSummary(): void {
    // Prefer the model's latest progress summary, fall back to the last answer.
    const body =
      this.lastProgress.trim().slice(0, 140) ||
      this.lastAssistant.trim().slice(0, 140) ||
      "The response is ready.";
    notify(this.pushToken, {
      title: `Claude · ${this.contextLabel}`,
      body,
      data: { token: this.token, context: this.contextLabel },
    });
  }

  // --- Claude session ------------------------------------------------------

  rebuildClaude(resume?: string): void {
    this.claude?.close();
    this.lastProgress = "";
    this.claude = new ClaudeSession(this.emit, {
      cwd: this.cwd,
      // config.model (global CLAUDE_MODEL) overrides the per-surface model.
      model: config.model || this.model || undefined,
      effort: this.effort || undefined,
      permissionMode: this.planMode ? "plan" : "acceptEdits",
      fallbackModel: config.fallbackModel || undefined,
      maxTurns: config.maxTurns || undefined,
      maxBudgetUsd: config.demoMode ? config.demoBudgetUsd : undefined,
      taskBudgetTokens: config.taskBudgetTokens || undefined,
      promptSuggestions: config.promptSuggestions,
      agentProgress: config.agentProgress,
      watchGuidance: config.watchGuidance,
      watchTools: config.watchTools,
      skills: config.skills === "all" ? "all" : config.skills ? config.skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      mcpServers: mcpServers(),
      disallowedTools: config.disallowedTools,
      sandbox: config.sandbox,
      checkpointing: config.checkpointing,
      ...(this.settingSources ? { settingSources: this.settingSources } : {}),
      ...(resume ? { resume } : {}),
      ...(this.systemPrompt ? { systemPrompt: this.systemPrompt } : {}),
      onCost: (usd) => addSpend(this.token, usd),
      onFiltered: (reason, text) => addReport(`auto:${reason}`, text),
      onSuggestion: (text) => this.emit({ type: "suggestion", text }),
      onProgress: (text) => { this.lastProgress = text; this.emit({ type: "progress", text }); },
    });
  }

  // --- Idle teardown -------------------------------------------------------

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.dispose(), config.push.detachedTtlMs);
  }
  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
  dispose(): void {
    this.clearIdle();
    this.claude?.close();
    this.claude = null;
    this.onDispose();
  }
}

// Registry keyed by user token — one persistent session per user.
const registry = new Map<string, UserSession>();

export function getOrCreateSession(token: string): UserSession {
  let us = registry.get(token);
  if (!us) {
    us = new UserSession(token, () => registry.delete(token));
    registry.set(token, us);
  }
  return us;
}

export function disposeSession(token: string): void {
  registry.get(token)?.dispose();
}
