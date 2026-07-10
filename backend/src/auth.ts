// Device Authorization Grant (RFC 8628-style) — prototype implementation.
//
// The watch asks for a device code, shows a QR that points the phone at the
// login page, the phone approves, and the watch polls until it receives a
// short-lived session token. State is kept in memory: fine for a single-instance
// prototype, NOT for a multi-instance Cloud Run deployment (see README).

import { randomBytes, randomUUID } from "node:crypto";

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete login
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours session token
const POLL_INTERVAL_S = 3;

type DeviceState = "pending" | "approved" | "expired";

interface DeviceRequest {
  deviceCode: string;
  userCode: string;
  state: DeviceState;
  createdAt: number;
  token?: string;
}

interface Session {
  token: string;
  createdAt: number;
}

// user_code (shown/typed on phone) -> device request
const byUserCode = new Map<string, DeviceRequest>();
// device_code (held by the watch) -> device request
const byDeviceCode = new Map<string, DeviceRequest>();
// token -> session
const sessions = new Map<string, Session>();

/** Human-friendly code shown on the watch / typed on the phone, e.g. "WXYZ-1234". */
function makeUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const pick = (n: number) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join("");
  return `${pick(4)}-${pick(4)}`;
}

function expireStale(): void {
  const now = Date.now();
  for (const [code, req] of byUserCode) {
    if (req.state !== "approved" && now - req.createdAt > DEVICE_CODE_TTL_MS) {
      req.state = "expired";
      byUserCode.delete(code);
      byDeviceCode.delete(req.deviceCode);
    }
  }
  for (const [token, s] of sessions) {
    if (now - s.createdAt > TOKEN_TTL_MS) sessions.delete(token);
  }
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** Step 1 — the watch requests a new device login. */
export function createDeviceCode(baseUrl: string): DeviceCodeResponse {
  expireStale();
  const deviceCode = randomUUID();
  const userCode = makeUserCode();
  const req: DeviceRequest = {
    deviceCode,
    userCode,
    state: "pending",
    createdAt: Date.now(),
  };
  byUserCode.set(userCode, req);
  byDeviceCode.set(deviceCode, req);

  const verificationUri = `${baseUrl}/login`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
    expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
    interval: POLL_INTERVAL_S,
  };
}

/** Step 3 — the phone approves the login for a given user_code. */
export function approveUserCode(userCode: string): boolean {
  expireStale();
  const req = byUserCode.get(userCode.trim().toUpperCase());
  if (!req || req.state === "expired") return false;
  req.state = "approved";
  req.token = randomUUID();
  sessions.set(req.token, { token: req.token, createdAt: Date.now() });
  return true;
}

export type TokenPoll =
  | { status: "authorization_pending" }
  | { status: "expired_token" }
  | { status: "approved"; access_token: string; expires_in: number };

/** Step 4 — the watch polls with its device_code until approved. */
export function pollToken(deviceCode: string): TokenPoll {
  expireStale();
  const req = byDeviceCode.get(deviceCode);
  if (!req) return { status: "expired_token" };
  if (req.state === "approved" && req.token) {
    return {
      status: "approved",
      access_token: req.token,
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    };
  }
  return { status: "authorization_pending" };
}

/** Validate a session token presented over the WebSocket. */
export function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  expireStale();
  return sessions.has(token);
}
