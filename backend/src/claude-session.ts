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

type Emit = (event: Record<string, unknown>) => void;

interface SessionOpts {
  cwd: string;
  model?: string;
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

  private forward(message: SDKMessage): void {
    if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            const verdict = moderate(block.text);
            if (verdict.flagged) {
              this.opts.onFiltered?.(verdict.reason ?? "flagged", block.text);
              this.emit({ type: "assistant", text: FILTERED_NOTICE, filtered: true });
            } else {
              this.emit({ type: "assistant", text: block.text });
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
