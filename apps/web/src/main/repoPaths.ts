import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { eq, and } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { RepoPath, RepoPathResult } from '../shared/terminal'

const exec = promisify(execFile)

export async function getRepoPath(db: AppDatabase, owner: string, repo: string): Promise<RepoPath | null> {
  const rows = await db
    .select()
    .from(schema.repoPaths)
    .where(and(eq(schema.repoPaths.owner, owner), eq(schema.repoPaths.repo, repo)))
  const row = rows[0]
  return row
    ? { owner: row.owner, repo: row.repo, path: row.path, runCommand: row.runCommand, devPort: row.devPort, editorCommand: row.editorCommand, runTargets: row.runTargets }
    : null
}

// Persist the per-repo run-target list (docs/next 13 §A — the DB fallback below a committed
// .acorn/config.toml). Accepts a JSON RunTarget[] string; blank clears. Shape-validated here so a
// bad save is rejected with a reason instead of surfacing later as a config error row.
export async function setRunTargets(db: AppDatabase, owner: string, repo: string, json: string): Promise<RepoPathResult> {
  const existing = await getRepoPath(db, owner, repo)
  if (!existing) return { ok: false, reason: 'Map a local checkout for this repo first.' }
  const value = json.trim() || null
  if (value) {
    try {
      const arr = JSON.parse(value) as unknown
      if (!Array.isArray(arr)) return { ok: false, reason: 'Run targets must be a JSON array.' }
      for (const t of arr) {
        const o = t as Record<string, unknown>
        if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id.trim() || typeof o.command !== 'string' || !o.command.trim())
          return { ok: false, reason: 'Each run target needs an "id" and a "command".' }
        if (o.url && o.urlCommand) return { ok: false, reason: `Target "${o.id}": pick one of "url" / "urlCommand".` }
      }
    } catch {
      return { ok: false, reason: 'Invalid JSON.' }
    }
  }
  await db
    .update(schema.repoPaths)
    .set({ runTargets: value, updatedAt: Date.now() })
    .where(and(eq(schema.repoPaths.owner, owner), eq(schema.repoPaths.repo, repo)))
  return { ok: true, repoPath: { ...existing, runTargets: value } }
}

// Save the per-repo external-editor command (docs/next 01 P2). Blank clears back to the global
// default. Not validated here — resolution (PATH probe) happens at launch, where failure surfaces.
export async function setEditorCommand(db: AppDatabase, owner: string, repo: string, editorCommand: string): Promise<RepoPathResult> {
  const existing = await getRepoPath(db, owner, repo)
  if (!existing) return { ok: false, reason: 'Map a local checkout for this repo first.' }
  const value = editorCommand.trim() || null
  await db
    .update(schema.repoPaths)
    .set({ editorCommand: value, updatedAt: Date.now() })
    .where(and(eq(schema.repoPaths.owner, owner), eq(schema.repoPaths.repo, repo)))
  return { ok: true, repoPath: { ...existing, editorCommand: value } }
}

// Save the per-repo dev-server config (docs/workspaces P5). The repo must already be mapped (its
// path is required); returns the updated mapping or an error for the UI.
export async function setRunConfig(db: AppDatabase, owner: string, repo: string, runCommand: string, devPort: number): Promise<RepoPathResult> {
  if (!runCommand.trim()) return { ok: false, reason: 'Run command is required.' }
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) return { ok: false, reason: 'Port must be 1–65535.' }
  const existing = await getRepoPath(db, owner, repo)
  if (!existing) return { ok: false, reason: 'Map a local checkout for this repo first.' }
  await db
    .update(schema.repoPaths)
    .set({ runCommand: runCommand.trim(), devPort, updatedAt: Date.now() })
    .where(and(eq(schema.repoPaths.owner, owner), eq(schema.repoPaths.repo, repo)))
  return { ok: true, repoPath: { ...existing, runCommand: runCommand.trim(), devPort } }
}

// Does a remote URL point at github.com/<owner>/<repo>? Accept https + ssh forms and an optional
// .git suffix; match case-insensitively (GitHub owners/repos are case-insensitive). Anchoring on
// a trailing boundary stops `owner/repo` from matching `owner/repo-2`.
export function remoteMatches(remotes: string, owner: string, repo: string): boolean {
  const re = new RegExp(`github\\.com[:/]${escapeRe(owner)}/${escapeRe(repo)}(\\.git)?(\\s|$)`, 'i')
  return re.test(remotes)
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Validate then persist a checkout for owner/repo (vNext §9 step 3): absolute existing dir, has a
// .git entry (dir or worktree file), and a GitHub remote matching owner/repo.
export async function setRepoPath(db: AppDatabase, owner: string, repo: string, path: string): Promise<RepoPathResult> {
  if (!isAbsolute(path)) return { ok: false, reason: 'Path must be absolute.' }
  if (!isDir(path)) return { ok: false, reason: 'Directory does not exist.' }
  if (!existsSync(join(path, '.git'))) return { ok: false, reason: 'Not a git checkout (no .git).' }

  let remotes: string
  try {
    const { stdout } = await exec('git', ['-C', path, 'remote', '-v'], { timeout: 5000 })
    remotes = stdout
  } catch {
    return { ok: false, reason: 'Could not read git remotes.' }
  }
  if (!remoteMatches(remotes, owner, repo)) {
    return { ok: false, reason: `No GitHub remote for ${owner}/${repo} in this checkout.` }
  }

  const now = Date.now()
  await db
    .insert(schema.repoPaths)
    .values({ owner, repo, path, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [schema.repoPaths.owner, schema.repoPaths.repo], set: { path, updatedAt: now } })
  return { ok: true, repoPath: (await getRepoPath(db, owner, repo))! }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
