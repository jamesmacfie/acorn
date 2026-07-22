import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import type { PullConflicts } from '../../../../core/shared/api'
import { getDb } from '../../../../core/server/db'
import { getRepoPath } from '../../../../core/main/repoPaths'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'

const exec = promisify(execFile)

// GitHub exposes no per-file conflict data — only the `mergeable` enum on the PR. To list the files
// that conflict we run a trial merge with `git merge-tree` in the repo's mapped local checkout
// (docs/github-integration.md). When the repo has no local checkout (browse-only), we return
// `available:false` and the UI just says conflicts exist without enumerating them. The client gates
// this to CONFLICTING PRs, so the fetch + network hop only happen when there's actually a conflict.

// git-legal ref chars only, and never a leading dash (so a ref can't be read as a flag). The PR
// number is validated as an integer separately.
const isValidRef = (ref: string): boolean => !ref.startsWith('-') && /^[A-Za-z0-9._/-]+$/.test(ref)

// `git merge-tree --write-tree --name-only <base> <head>` prints the merged tree oid on line 0, then
// one conflicting path per line until a blank line (informational messages follow). ponytail: plain
// text parse, not `-z` — a path with an embedded newline is a non-case for real branch content.
export function parseConflictNames(stdout: string): string[] {
  const lines = stdout.split('\n')
  const files: string[] = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') break
    files.push(lines[i])
  }
  return files
}

export const pullConflicts = new Hono<AppEnv>().get('/:owner/:repo/pulls/:number/conflicts', async (c) => {
  getUser(c) // gate on auth, like the other /api/repos reads
  const db = getDb(c.env)
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return respondError(c, 400, 'bad_number')
  const base = c.req.query('base') ?? ''

  const unavailable: PullConflicts = { available: false, files: [] }
  const mapped = await getRepoPath(db, owner, repo)
  if (!mapped || !isValidRef(base)) return c.json(unavailable)
  const checkout = mapped.path

  // Fetch the base branch tip and the PR head into throwaway per-PR refs (never touching the
  // checkout's own branches). `pull/<n>/head` resolves fork heads too. Best-effort — a network or
  // fetch failure degrades to "unavailable" rather than erroring the PR screen.
  const baseRef = `refs/acorn/conflict/${number}/base`
  const headRef = `refs/acorn/conflict/${number}/head`
  try {
    await exec('git', ['-C', checkout, 'fetch', '--no-tags', '--quiet', 'origin', `+refs/heads/${base}:${baseRef}`, `+refs/pull/${number}/head:${headRef}`], { timeout: 60_000 })
  } catch {
    return c.json(unavailable)
  }

  try {
    // Exit 0 → the trial merge is clean (GitHub's CONFLICTING was stale); no conflicting files.
    await exec('git', ['-C', checkout, 'merge-tree', '--write-tree', '--name-only', baseRef, headRef], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
    return c.json({ available: true, files: [] } satisfies PullConflicts)
  } catch (e) {
    // Exit 1 → conflicts; the conflicting paths are on stdout. Anything else → couldn't compute.
    const err = e as { code?: unknown; stdout?: unknown }
    if (err.code === 1 && typeof err.stdout === 'string') {
      return c.json({ available: true, files: parseConflictNames(err.stdout) } satisfies PullConflicts)
    }
    return c.json(unavailable)
  }
})
