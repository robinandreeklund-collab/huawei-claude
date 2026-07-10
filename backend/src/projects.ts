// Projects (repos Claude Code works in) and code browsing within a project.
//
// A "project" is a direct subdirectory of config.projectsDir. The three watch
// modes map to:
//   Projects → listProjects()          (pick which repo to work in)
//   Chats    → listSessions({ dir })    (past conversations for that repo; SDK)
//   Code     → listFiles(dir)           (browse the repo's files)

import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, relative, sep } from "node:path";
import { config } from "./config.js";

const execFileP = promisify(execFile);

export interface ProjectInfo {
  id: string; // directory name
  title: string;
  path: string;
}

/** Reject anything that isn't a plain, single-segment directory name. */
function safeName(id: string): string | null {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return id;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  try {
    const entries = await readdir(config.projectsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ id: e.name, title: e.name, path: join(config.projectsDir, e.name) }));
  } catch {
    return [];
  }
}

export function projectPath(id: string): string | null {
  const name = safeName(id);
  return name ? join(config.projectsDir, name) : null;
}

export interface FileEntry {
  id: string; // path relative to project root
  title: string; // basename
  dir: string; // parent dir (relative), "" for root
}

/** List a project's files — git-tracked when possible, else a bounded readdir. */
export async function listFiles(cwd: string, limit = 300): Promise<FileEntry[]> {
  let rels: string[] = [];
  try {
    const { stdout } = await execFileP("git", ["ls-files"], { cwd });
    rels = stdout.split("\n").filter(Boolean);
  } catch {
    rels = await walk(cwd, cwd, limit);
  }
  return rels.slice(0, limit).map((r) => {
    const parts = r.split(sep);
    return { id: r, title: parts[parts.length - 1], dir: parts.slice(0, -1).join("/") };
  });
}

async function walk(root: string, dir: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set([".git", "node_modules", "dist", ".DS_Store"]);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (skip.has(e.name)) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(root, abs, limit)));
    else out.push(relative(root, abs));
    if (out.length >= limit) break;
  }
  return out;
}

/** Read a file within the project, with a path-traversal guard. */
export async function readSnippet(cwd: string, rel: string, maxBytes = 4096): Promise<string | null> {
  if (rel.includes("..")) return null;
  const abs = join(cwd, rel);
  const rp = relative(cwd, abs);
  if (rp.startsWith("..") || rp.includes(`..${sep}`)) return null;
  try {
    const buf = await readFile(abs);
    return buf.subarray(0, maxBytes).toString("utf8");
  } catch {
    return null;
  }
}

/** Seed a couple of example projects for the demo instance. */
export async function seedProjectsIfEmpty(): Promise<void> {
  try {
    const existing = await listProjects();
    if (existing.length > 0) return;
    await mkdir(config.projectsDir, { recursive: true });
    await makeProject("todo-api", {
      "README.md": "# todo-api\n\nA tiny example project for the watch demo.\n",
      "index.js": "export const routes = ['GET /todos', 'POST /todos'];\n",
      "src/db.js": "export const items = [];\n",
    });
    await makeProject("watch-face", {
      "README.md": "# watch-face\n\nAnother example project.\n",
      "face.ts": "export const tick = () => Date.now();\n",
    });
    console.log(`Seeded example projects at ${config.projectsDir}`);
  } catch {
    /* best effort */
  }
}

async function makeProject(name: string, files: Record<string, string>): Promise<void> {
  const dir = join(config.projectsDir, name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(abs.slice(0, abs.lastIndexOf(sep)), { recursive: true });
    await writeFile(abs, content);
  }
  await execFileP("git", ["init", "-q"], { cwd: dir }).catch(() => {});
  await execFileP("git", ["add", "-A"], { cwd: dir }).catch(() => {});
  await execFileP(
    "git",
    ["-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-qm", "seed"],
    { cwd: dir },
  ).catch(() => {});
}

export async function ensureDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
