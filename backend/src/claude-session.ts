// Wraps a single Claude Code session (Claude Agent SDK) behind a simple
// push/emit interface. Each connected watch gets one ClaudeSession.
//
// query() takes a streaming input (AsyncIterable of SDKUserMessage), which lets
// us keep one long-lived Claude Code conversation per connection and feed it new
// prompts as the user speaks/types.

import {
  query,
  type Query,
  type SDKUserMessage,
  type SDKMessage,
  type CanUseTool,
} from "@anthropic-ai/claude-agent-sdk";
import { moderate, FILTERED_NOTICE } from "./moderation.js";
import { spawnEnv } from "./claude-cred.js";

type Emit = (event: Record<string, unknown>) => void;

interface SessionOpts {
  cwd: string;
  model?: string;
  /** Resume an existing Claude conversation by session UUID. */
  resume?: string;
  /** Custom system prompt (used to carry a Project's instructions/context). */
  systemPrompt?: string;
  /** Called with the per-turn cost so the server can enforce a budget cap. */
  onCost?: (usd: number) => void;
  /** Called when moderation filters a message, for the report log. */
  onFiltered?: (reason: string, text: string) => void;
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

export class ClaudeSession {
  private queue = new MessageQueue<SDKUserMessage>();
  private q: Query | null = null;
  private started = false;
  // Incremental moderation of the text currently being streamed, so flagged
  // content is cut off mid-stream instead of shown and then retracted.
  private streamBuf = "";
  private streamBlocked = false;

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
      // Prototype gate: surface it and deny. Real flow (spec §7) sends this to
      // the phone for an explicit "confirm" before allowing.
      this.emit({ type: "needs_confirmation", tool: toolName, command });
      return { behavior: "deny", message: "Blocked pending confirmation (prototype)" };
    }
    return { behavior: "allow", updatedInput: input };
  };

  private start(): void {
    this.started = true;
    this.q = query({
      prompt: this.queue,
      options: {
        cwd: this.opts.cwd,
        ...(this.opts.model ? { model: this.opts.model } : {}),
        ...(this.opts.resume ? { resume: this.opts.resume } : {}),
        ...(this.opts.systemPrompt ? { systemPrompt: this.opts.systemPrompt } : {}),
        env: spawnEnv(), // inject the connected Claude credential (subscription/API key)
        includePartialMessages: true, // stream assistant text token-by-token to the watch
        permissionMode: "acceptEdits",
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

  close(): void {
    this.queue.close();
    this.q?.close?.();
  }
}
