// In-process MCP server that gives Claude tools to ACT ON THE WATCH.
//
// This is what turns the watch from a passive terminal into an agent surface:
// Claude can vibrate it, show a notification, start a timer, or read the wearer's
// heart rate / location. Action tools emit a `watch_action` event to the connected
// watch; query tools do a request/response round-trip (`watch_query` → the watch
// replies with a value the tool returns to Claude).
//
// On the real device these map to Sensor Service Kit / Vibrator / Notification Kit
// (see docs/ondevice-notifications.md); the browser demo simulates them.

import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

type Emit = (event: Record<string, unknown>) => void;
type QueryWatch = (kind: string) => Promise<unknown>;

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

export function createWatchToolServer(emit: Emit, queryWatch: QueryWatch) {
  const vibrate = tool(
    "vibrate",
    "Vibrate the user's watch to get their attention (e.g. when a task is done).",
    { pattern: z.enum(["short", "double", "long"]).optional().describe("Haptic pattern") },
    async (args) => {
      emit({ type: "watch_action", action: "vibrate", pattern: args.pattern ?? "short" });
      return ok(`Buzzed the watch (${args.pattern ?? "short"}).`);
    },
  );

  const notify = tool(
    "notify",
    "Show a notification banner on the user's watch.",
    { title: z.string().describe("Short title"), body: z.string().optional().describe("Optional detail") },
    async (args) => {
      emit({ type: "watch_action", action: "notify", title: args.title, body: args.body ?? "" });
      return ok("Notification shown on the watch.");
    },
  );

  const setTimer = tool(
    "set_timer",
    "Start a visible countdown timer on the user's watch. It buzzes when it ends.",
    {
      seconds: z.number().int().positive().max(86400).describe("Duration in seconds"),
      label: z.string().optional().describe("What the timer is for"),
    },
    async (args) => {
      emit({ type: "watch_action", action: "timer", seconds: args.seconds, label: args.label ?? "" });
      return ok(`Timer started for ${args.seconds}s${args.label ? ` (${args.label})` : ""}.`);
    },
  );

  const readHealth = tool(
    "read_health",
    "Read the user's current heart rate (bpm) and today's step count from the watch.",
    {},
    async () => {
      const data = await queryWatch("health");
      return ok(JSON.stringify(data));
    },
  );

  const getLocation = tool(
    "get_location",
    "Get the watch's current approximate location (latitude, longitude, place).",
    {},
    async () => {
      const data = await queryWatch("location");
      return ok(JSON.stringify(data));
    },
  );

  return createSdkMcpServer({
    name: "watch",
    version: "1.0.0",
    instructions:
      "Tools to act on the user's Huawei watch: vibrate, notify, set a timer, and " +
      "read heart rate / steps / location. Use them proactively when helpful — e.g. " +
      "buzz when a long task finishes, or start a timer when the user asks.",
    tools: [vibrate, notify, setTimer, readHealth, getLocation],
  });
}
