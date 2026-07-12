// The three Claude surfaces, app-native in this backend.
//
//   Chats       — plain Claude conversations, one neutral dir (config.chatsDir).
//                 The conversation list is the Agent SDK's listSessions() there.
//   Projects    — named projects with their own context/instructions. Each is a
//                 subdirectory of config.projectsDir holding a project.json.
//   Claude Code — real git repos under config.codeDir; each is a code session you
//                 resume. This is where "working in this repo" shows up.

import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { config } from "./config.js";

const execFileP = promisify(execFile);

/** Reject anything that isn't a plain, single-segment directory name. */
export function safeName(id: string): string | null {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return id;
}

async function subdirs(base: string): Promise<string[]> {
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function gitInit(dir: string): Promise<void> {
  await execFileP("git", ["init", "-q"], { cwd: dir }).catch(() => {});
  await execFileP("git", ["add", "-A"], { cwd: dir }).catch(() => {});
  await execFileP(
    "git",
    ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-qm", "seed"],
    { cwd: dir },
  ).catch(() => {});
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(abs.slice(0, abs.lastIndexOf(sep)), { recursive: true });
    await writeFile(abs, content);
  }
}

// --- Claude Code: git repos --------------------------------------------------

export interface CodeRepo {
  id: string;
  title: string;
  path: string;
}

export async function listCodeRepos(): Promise<CodeRepo[]> {
  return (await subdirs(config.codeDir)).map((name) => ({
    id: name,
    title: name,
    path: join(config.codeDir, name),
  }));
}

export function codeRepoPath(id: string): string | null {
  const name = safeName(id);
  return name ? join(config.codeDir, name) : null;
}

// --- Claude Code: the real CLI history store (~/.claude/projects) -------------
//
// This is what the Claude Code app/CLI records: one subdirectory per project you
// have worked in (the directory name is the cwd with separators replaced), each
// holding session transcripts (<session-id>.jsonl). Running the backend on the
// same machine lets the watch list and resume *every* project you have real
// history for — not just repos seeded on the server.

/** Where the Claude Code CLI keeps its per-project session transcripts. */
export function claudeProjectsDir(): string {
  const cfg = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(cfg, "projects");
}

export interface CodeHistoryItem {
  id: string; // the encoded project-dir name (safe, single segment)
  title: string; // human-readable project name (ai-title, else the folder name)
  path: string; // the real cwd the sessions ran in
  branch?: string; // last-known git branch
  sessionId?: string; // newest session's id (for resume)
  lastModified: number; // mtime of the newest transcript
}

/** Read the newest transcript in a project dir and pull out cwd/title/branch.
 *  The encoded dir name is lossy, so the real cwd is recovered from the
 *  transcript records (user/attachment rows carry `cwd` and `gitBranch`). */
async function readProjectMeta(projDir: string): Promise<CodeHistoryItem | null> {
  const dir = join(claudeProjectsDir(), projDir);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  // Newest transcript by mtime.
  let newest = files[0];
  let lastModified = 0;
  for (const f of files) {
    const st = await stat(join(dir, f)).catch(() => null);
    if (st && st.mtimeMs > lastModified) {
      lastModified = st.mtimeMs;
      newest = f;
    }
  }

  let cwd: string | undefined;
  let title: string | undefined;
  let branch: string | undefined;
  try {
    const content = await readFile(join(dir, newest), "utf8");
    for (const line of content.split("\n")) {
      if (!line) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (!cwd && typeof rec.cwd === "string") {
        cwd = rec.cwd;
        if (typeof rec.gitBranch === "string") branch = rec.gitBranch;
      }
      if (!title) {
        const t = (rec.type === "ai-title" && rec.title) || (rec.type === "summary" && rec.summary);
        if (typeof t === "string" && t.trim()) title = t.trim();
      }
      if (cwd && title) break;
    }
  } catch {
    /* unreadable transcript — fall through */
  }
  if (!cwd) return null; // no usable project path

  return {
    id: projDir,
    title: title || basename(cwd.replace(/[/\\]+$/, "")) || cwd,
    path: cwd,
    branch,
    sessionId: newest.replace(/\.jsonl$/, ""),
    lastModified,
  };
}

/** Every project with Claude Code history on this machine, newest first. */
export async function listCodeHistory(): Promise<CodeHistoryItem[]> {
  const dirs = await subdirs(claudeProjectsDir());
  const metas = await Promise.all(dirs.map((d) => readProjectMeta(d)));
  return metas
    .filter((m): m is CodeHistoryItem => m !== null)
    .sort((a, b) => b.lastModified - a.lastModified);
}

/** Resolve an encoded project-dir id back to its real cwd (for open/resume). */
export async function codeHistoryCwd(id: string): Promise<string | null> {
  const name = safeName(id);
  if (!name) return null;
  const meta = await readProjectMeta(name);
  return meta?.path ?? null;
}

// --- Projects: named contexts ------------------------------------------------

export interface AppProject {
  id: string;
  name: string;
  instructions: string;
  path: string;
}

export async function listAppProjects(): Promise<AppProject[]> {
  const out: AppProject[] = [];
  for (const name of await subdirs(config.projectsDir)) {
    const path = join(config.projectsDir, name);
    let meta: { name?: string; instructions?: string } = {};
    try {
      meta = JSON.parse(await readFile(join(path, "project.json"), "utf8"));
    } catch {
      /* no metadata */
    }
    out.push({ id: name, name: meta.name || name, instructions: meta.instructions || "", path });
  }
  return out;
}

export async function appProject(id: string): Promise<AppProject | null> {
  const name = safeName(id);
  if (!name) return null;
  return (await listAppProjects()).find((p) => p.id === name) ?? null;
}

// --- Chats: one neutral conversation dir -------------------------------------

export function chatsDir(): string {
  return config.chatsDir;
}

// --- Demo seeding ------------------------------------------------------------

export async function seedIfEmpty(): Promise<void> {
  await mkdir(config.chatsDir, { recursive: true }).catch(() => {});
  await gitInit(config.chatsDir); // so listSessions has a project key here

  if ((await listCodeRepos()).length === 0) {
    await mkdir(config.codeDir, { recursive: true }).catch(() => {});
    const repos: Record<string, Record<string, string>> = {
      "todo-api": {
        "README.md": "# todo-api\n\nExample repo for the Claude Code demo.\n",
        "index.js": "export const routes = ['GET /todos', 'POST /todos'];\n",
      },
      "watch-face": {
        "README.md": "# watch-face\n\nAnother example repo.\n",
        "face.ts": "export const tick = () => Date.now();\n",
      },
    };
    for (const [name, files] of Object.entries(repos)) {
      const dir = join(config.codeDir, name);
      await writeFiles(dir, files);
      await gitInit(dir);
    }
    console.log(`Seeded example Claude Code repos at ${config.codeDir}`);
  }

  if ((await listAppProjects()).length === 0) {
    await mkdir(config.projectsDir, { recursive: true }).catch(() => {});
    const dir = join(config.projectsDir, "research");
    await writeFiles(dir, {
      "project.json": JSON.stringify(
        {
          name: "Research",
          instructions:
            "You are a research assistant for this project. Be concise and cite sources when you can.",
        },
        null,
        2,
      ),
    });
    await gitInit(dir);
    console.log(`Seeded example project at ${config.projectsDir}`);
  }
}
