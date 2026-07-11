// "Connect Claude" credential — how the backend authenticates to Claude.
//
// You run `claude setup-token` once (logs in with your Claude Pro/Max) and paste
// the resulting sk-ant-oat01-... token into the /connect page. It is stored here
// and injected into the environment of every Claude Code process the backend
// spawns — so no API key and no editing Render env vars.
//
// Falls back to the CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY env vars if no
// token has been connected.

import { readFile, writeFile } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";

let current: string | null = null;
let cachedAccount: unknown = null;

export async function loadCred(): Promise<void> {
  try {
    const raw = await readFile(config.credFile, "utf8");
    const data = JSON.parse(raw) as { token?: string };
    if (data.token) current = data.token;
  } catch {
    /* none stored yet */
  }
}

// Clean up a pasted token: strip zero-width/BOM characters and surrounding
// quotes/brackets/whitespace that a phone clipboard sometimes adds.
export function sanitizeToken(token: string): string {
  return String(token)
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "") // zero-width + BOM + nbsp
    .trim()
    .replace(/^["'`<(\[]+|["'`>)\]]+$/g, "")
    .trim();
}

/**
 * Accepts any Claude credential — a subscription token (sk-ant-oat…), an API key
 * (sk-ant-api…), or any other well-formed sk-ant-… token. We only sanity-check the
 * shape; the real check is whether it actually authenticates (see probeAccount).
 */
export function validToken(token: string): boolean {
  const t = sanitizeToken(token);
  return t.startsWith("sk-ant-") && t.length >= 24 && !/\s/.test(t);
}

export async function setCred(token: string): Promise<void> {
  current = sanitizeToken(token);
  cachedAccount = null; // re-verify against the new credential on next probe
  await writeFile(config.credFile, JSON.stringify({ token: current }), { mode: 0o600 }).catch(() => {});
}

// Never-yielding prompt: keeps the query's input stream open so the CLI stays up
// long enough to answer the accountInfo() control request, without sending a turn.
async function* idlePrompt(): AsyncGenerator<never> {
  await new Promise<void>(() => {}); // never resolves
}

/**
 * Verify the connected credential by asking Claude who it's authenticated as.
 * Returns { email, subscriptionType, apiProvider, … } or null if it can't verify.
 * Result is cached until the credential changes.
 */
export async function probeAccount(force = false): Promise<unknown> {
  if (cachedAccount && !force) return cachedAccount;
  if (!isConnected()) return null;
  let q: (AsyncIterable<unknown> & { accountInfo?: () => Promise<unknown>; close?: () => void }) | null = null;
  try {
    q = query({ prompt: idlePrompt(), options: { env: spawnEnv(), permissionMode: "plan" } }) as unknown as
      AsyncIterable<unknown> & { accountInfo?: () => Promise<unknown>; close?: () => void };
    // Drive the message loop in the background so the CLI initializes and the
    // accountInfo() control request can be answered (without it, accountInfo hangs).
    const drain = (async () => { try { for await (const _ of q as AsyncIterable<unknown>) { /* discard */ } } catch { /* closed */ } })();
    const info = await Promise.race([
      (q.accountInfo?.() ?? Promise.resolve(null)).catch(() => null), // no late unhandled rejection
      new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    cachedAccount = info ?? null;
    void drain;
    return cachedAccount;
  } catch {
    return null;
  } finally {
    try { q?.close?.(); } catch { /* ignore */ }
  }
}

export type CredKind = "subscription" | "apikey" | null;
export interface CredStatus {
  connected: boolean;
  source: "stored" | "env" | "none";
  kind: CredKind;
}

function kindOf(token: string): CredKind {
  return token.startsWith("sk-ant-oat") ? "subscription" : "apikey";
}

export function credStatus(): CredStatus {
  if (current) return { connected: true, source: "stored", kind: kindOf(current) };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { connected: true, source: "env", kind: "subscription" };
  if (process.env.ANTHROPIC_API_KEY) return { connected: true, source: "env", kind: "apikey" };
  return { connected: false, source: "none", kind: null };
}

export const isConnected = (): boolean => credStatus().connected;

/**
 * Full environment for a spawned Claude Code process. Starts from process.env,
 * then applies the connected token (removing the conflicting variable so the
 * chosen credential wins).
 */
export function spawnEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) base[k] = v;
  if (current) {
    if (kindOf(current) === "subscription") {
      base.CLAUDE_CODE_OAUTH_TOKEN = current;
      delete base.ANTHROPIC_API_KEY;
    } else {
      base.ANTHROPIC_API_KEY = current;
      delete base.CLAUDE_CODE_OAUTH_TOKEN;
    }
  }
  return base;
}
