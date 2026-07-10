// Huawei Push Kit client — real background notifications to the watch.
//
// Flow: OAuth2 client_credentials → access token → POST the notification to
// Push Kit's send API for the device's push token. This is the production path;
// it activates as soon as HUAWEI_PUSH_* credentials (from AppGallery Connect)
// are set. Without them, notify() logs what it *would* have sent so the rest of
// the pipeline is fully testable.
//
// Note: the HarmonyOS push payload may need minor field tweaks (category /
// target-user-type) once verified on a real Watch Ultimate 2 — marked below.

import { config, pushConfigured } from "./config.js";

const OAUTH_URL = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
const SEND_URL = () => `https://push-api.cloud.huawei.com/v2/${config.push.appId}/messages:send`;

let cachedToken = "";
let tokenExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.push.clientId,
    client_secret: config.push.clientSecret,
  });
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`push oauth failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>; // deep-link context (e.g. which chat to open)
}

export type PushResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

/** Send one notification to a device push token. */
export async function sendPush(pushToken: string, msg: PushMessage): Promise<PushResult> {
  if (!pushConfigured()) {
    console.log(`[push:skip] would notify → ${msg.title}: ${msg.body}`);
    return { status: "skipped", reason: "push not configured" };
  }
  if (!pushToken) return { status: "skipped", reason: "no device token" };

  try {
    const accessToken = await getAccessToken();
    const payload = {
      validate_only: false,
      message: {
        notification: { title: msg.title, body: msg.body },
        // `data` is delivered to the app for deep-linking / context.
        data: JSON.stringify(msg.data ?? {}),
        // HarmonyOS target. Verify these fields on-device (Watch Ultimate 2):
        android: {
          category: "IM",
          notification: { title: msg.title, body: msg.body, click_action: { type: 3 } },
        },
        token: [pushToken],
      },
    };
    const res = await fetch(SEND_URL(), {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { status: "error", error: `send failed (${res.status}): ${(await res.text()).slice(0, 160)}` };
    return { status: "sent" };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

/** Fire-and-forget wrapper used by the session layer. */
export function notify(pushToken: string | undefined, msg: PushMessage): void {
  if (!pushToken) {
    if (!pushConfigured()) console.log(`[push:skip] would notify → ${msg.title}: ${msg.body}`);
    return;
  }
  sendPush(pushToken, msg)
    .then((r) => {
      if (r.status === "error") console.error(`[push:error] ${r.error}`);
      else if (r.status === "sent") console.log(`[push:sent] ${msg.title}`);
    })
    .catch((e) => console.error(`[push:error] ${e}`));
}
