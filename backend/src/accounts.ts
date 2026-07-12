// Per-user accounts, each holding the user's OWN Anthropic API key.
//
// This is what makes the model-A product multi-tenant: every user brings their
// own sk-ant-api… key, so everything they do runs on THEIR Anthropic account
// and is billed to them — the app is just a client. A user creates an account
// on their phone (after scanning the watch's pairing QR) and pastes their key.
//
// Storage is a simple JSON file for the prototype. PRODUCTION must use a real
// datastore with the API key encrypted at rest (KMS / secret manager): the key
// is a live credential — treat it like a password, never log it, never return it.

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "./config.js";

export interface Account {
  id: string;
  name: string;
  email?: string;
  apiKey: string; // the user's own sk-ant-api… — their account, their billing
  createdAt: number;
}

const accountsFile =
  process.env.ACCOUNTS_FILE ||
  (config.dataDir ? `${config.dataDir.replace(/\/$/, "")}/accounts.json` : "/tmp/watch-accounts.json");

const accounts = new Map<string, Account>();
let loaded = false;

export async function loadAccounts(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(await readFile(accountsFile, "utf8")) as Account[];
    for (const a of raw) if (a?.id) accounts.set(a.id, a);
  } catch {
    /* none yet */
  }
}

async function persist(): Promise<void> {
  await writeFile(accountsFile, JSON.stringify([...accounts.values()], null, 2), { mode: 0o600 }).catch(
    () => {},
  );
}

/** An Anthropic Console API key (sk-ant-api…) — NOT a subscription token. */
export function isApiKey(key: string): boolean {
  const k = (key || "").trim();
  return k.startsWith("sk-ant-api") && k.length >= 24 && !/\s/.test(k);
}

export async function createAccount(input: {
  name: string;
  email?: string;
  apiKey: string;
}): Promise<Account> {
  await loadAccounts();
  const a: Account = {
    id: randomUUID(),
    name: (input.name || "").trim().slice(0, 80) || "Anonymous",
    email: input.email?.trim().slice(0, 200) || undefined,
    apiKey: input.apiKey.trim(),
    createdAt: Date.now(),
  };
  accounts.set(a.id, a);
  await persist();
  return a;
}

export function getAccount(id: string | undefined): Account | undefined {
  return id ? accounts.get(id) : undefined;
}

/** The user's own API key for their account (used for their CMA calls). */
export function apiKeyForAccount(id: string | undefined): string | undefined {
  const a = getAccount(id);
  return a && isApiKey(a.apiKey) ? a.apiKey : undefined;
}

export async function setAccountKey(id: string, apiKey: string): Promise<boolean> {
  await loadAccounts();
  const a = accounts.get(id);
  if (!a) return false;
  a.apiKey = apiKey.trim();
  await persist();
  return true;
}

/** Safe view — never leaks the API key. */
export function publicAccount(
  a: Account | undefined,
): { id: string; name: string; email?: string; hasKey: boolean } | null {
  if (!a) return null;
  return { id: a.id, name: a.name, email: a.email, hasKey: isApiKey(a.apiKey) };
}
