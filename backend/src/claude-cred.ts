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

/** Accepts a Claude Code subscription token (sk-ant-oat…) or an API key (sk-ant-api…). */
export function validToken(token: string): boolean {
  return /^sk-ant-(oat|api)\w*-/.test(token.trim()) && token.trim().length > 24;
}

export async function setCred(token: string): Promise<void> {
  current = token.trim();
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
  let q: { accountInfo?: () => Promise<unknown>; close?: () => void } | null = null;
  try {
    q = query({ prompt: idlePrompt(), options: { env: spawnEnv(), permissionMode: "plan" } }) as unknown as {
      accountInfo?: () => Promise<unknown>;
      close?: () => void;
    };
    const info = await Promise.race([
      q?.accountInfo?.() ?? Promise.resolve(null),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
    ]);
    cachedAccount = info ?? null;
    return cachedAccount;
  } catch {
    return null;
  } finally {
    try {
      q?.close?.();
    } catch {
      /* ignore */
    }
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
