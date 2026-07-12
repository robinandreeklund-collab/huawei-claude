// Runnable "model A" demo — drives a real hosted Claude Code session on a GitHub
// repo through Managed Agents, streaming the agent's output to the terminal the
// same way the watch would render it.
//
// Run (needs an API key + a GitHub token — billed per usage, not Max):
//   ANTHROPIC_API_KEY=sk-ant-api... \
//   GITHUB_TOKEN=ghp_... \
//   REPO_URL=https://github.com/you/your-repo \
//   PROMPT="Summarize this repo and list the top 3 things to improve." \
//   node dist/cma-demo.js
//
// Optional: BRANCH=main  CMA_MODEL=claude-opus-4-8  AUTO_ALLOW=1

import {
  ensureProvisioned,
  createSession,
  sendMessage,
  streamEvents,
  confirmTool,
  type CmaConfig,
} from "./cma.js";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const repoUrl = process.env.REPO_URL;
  const ghToken = process.env.GITHUB_TOKEN;

  if (!apiKey || !apiKey.startsWith("sk-ant-api")) {
    console.error("Set ANTHROPIC_API_KEY to a Console API key (sk-ant-api…). CMA is billed per use, not Max.");
    process.exit(1);
  }
  if (!repoUrl || !ghToken) {
    console.error("Set REPO_URL (https://github.com/owner/repo) and GITHUB_TOKEN (a GitHub PAT).");
    process.exit(1);
  }

  const prompt =
    process.env.PROMPT ||
    "List the files in this repository and summarize what it does in two sentences.";
  const autoAllow = /^(1|true|yes|on)$/i.test(process.env.AUTO_ALLOW || "");
  const cfg: CmaConfig = { apiKey, model: process.env.CMA_MODEL || "claude-sonnet-5" };

  console.log("→ Provisioning agent + environment (once, cached in cma-ids.json)…");
  const p = await ensureProvisioned(cfg, "./cma-ids.json");
  console.log(`  agent=${p.agentId}  env=${p.environmentId}`);

  console.log(`→ Creating session on ${repoUrl}…`);
  const s = await createSession(
    cfg,
    p,
    { url: repoUrl, token: ghToken, branch: process.env.BRANCH },
    "demo-user",
  );
  console.log(`  session=${s.id}`);
  console.log(`  trace:  https://platform.claude.com/workspaces/default/sessions/${s.id}\n`);

  const abort = new AbortController();

  // Stream-first: open the stream before sending the prompt so no events are missed.
  const streaming = (async () => {
    for await (const ev of streamEvents(cfg, s.id, abort.signal)) {
      switch (ev.type) {
        case "agent.message":
          for (const b of ev.content || []) if (b.type === "text" && b.text) process.stdout.write(b.text);
          break;
        case "agent.tool_use":
        case "agent.mcp_tool_use": {
          const ask = ev.evaluated_permission === "ask";
          process.stdout.write(`\n  ⌘ ${ev.name}${ask ? " — needs confirmation" : ""}\n`);
          if (ask && ev.id) {
            await confirmTool(cfg, s.id, ev.id, autoAllow, autoAllow ? undefined : "Denied from the watch demo.");
            process.stdout.write(`  ${autoAllow ? "✓ allowed" : "✗ denied"} ${ev.name}\n`);
          }
          break;
        }
        case "session.status_idle":
          if (ev.stop_reason?.type !== "requires_action") {
            console.log("\n\n— turn done —");
            abort.abort();
            return;
          }
          break;
        case "session.status_terminated":
          console.log("\n\n— session terminated —");
          abort.abort();
          return;
        case "session.error":
          console.log(`\n[error] ${ev.error?.message ?? "unknown"}`);
          break;
      }
    }
  })();

  await sendMessage(cfg, s.id, prompt);
  try {
    await streaming;
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
}

main().catch((e) => {
  console.error("\nDemo failed:", (e as Error).message);
  // Set the code and let Node drain handles cleanly (avoids a libuv teardown
  // assertion on Windows when exiting mid-socket-close).
  process.exitCode = 1;
});
