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
  return row ? { owner: row.owner, repo: row.repo, path: row.path } : null
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
  return { ok: true, repoPath: { owner, repo, path } }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
