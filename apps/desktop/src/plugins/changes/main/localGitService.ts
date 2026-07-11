import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { z } from 'zod'
import type { AppDatabase } from '../../../core/server/db'
import { taskRoot } from '../../../core/main/taskWorktree'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type { CommitSchema, DiscardSchema, GitActionSchema, GitPathsSchema, GitStatusSchema } from '../../../core/shared/publicApi/git'
import {
  commitStaged,
  discardAll,
  discardFile,
  localChanges,
  localDiff,
  localFileBlob,
  pushBranch,
  stageAll,
  stageFile,
  unstageAll,
  unstageFile,
  type GitActionResult,
} from './localDiff'

// LocalGitService (docs/public-api.md). The public git surface over a task's
// confined worktree, built on the same pure functions the internal ChangesPane routes use — no
// duplicated git logic. Every op resolves the worktree server-side; the caller never supplies a cwd.

const exec = promisify(execFile)
const MAX_PATCH_BYTES = 5 * 1024 * 1024 // 5 MiB (§8)

type GitAction = z.infer<typeof GitActionSchema>

export class LocalGitService {
  constructor(private readonly db: AppDatabase) {}

  private async root(taskId: string): Promise<string> {
    const root = await taskRoot(this.db, taskId)
    if (!root) throw new PublicApiError('conflict', 'Task has no worktree yet')
    return root
  }

  // Turn the internal {ok,reason} result into a GitAction or a typed error.
  private action(result: GitActionResult): GitAction {
    if (!result.ok) throw new PublicApiError('conflict', result.reason)
    return { changed: true }
  }

  async status(taskId: string): Promise<z.infer<typeof GitStatusSchema>> {
    const root = await this.root(taskId)
    const changes = await localChanges(root).catch(() => [])
    let branch: string | null = null
    let ahead = 0
    let behind = 0
    try {
      const { stdout } = await exec('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 10_000 })
      branch = stdout.trim() || null
    } catch {
      // detached HEAD or empty repo → null branch
    }
    try {
      const { stdout } = await exec('git', ['-C', root, 'rev-list', '--left-right', '--count', '@{u}...HEAD'], { timeout: 10_000 })
      const [b, a] = stdout.trim().split(/\s+/).map((n) => Number(n) || 0)
      behind = b ?? 0
      ahead = a ?? 0
    } catch {
      // no upstream configured → 0/0
    }
    return { changes, branch, ahead, behind }
  }

  async diff(taskId: string, path: string, scope: 'staged' | 'unstaged'): Promise<{ patch: string }> {
    const root = await this.root(taskId)
    let patch: string
    try {
      patch = (await localDiff(root, path, scope, 1_000_000)).patch
    } catch (e) {
      throw new PublicApiError('bad_request', e instanceof Error ? e.message : 'diff failed')
    }
    if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) {
      throw new PublicApiError('response_too_large', 'Patch exceeds the 5 MiB response cap')
    }
    return { patch }
  }

  async blob(taskId: string, path: string, ref?: string): Promise<{ text: string }> {
    const root = await this.root(taskId)
    let text: string
    try {
      text = (await localFileBlob(root, path, ref ?? 'HEAD')).text
    } catch (e) {
      throw new PublicApiError('bad_request', e instanceof Error ? e.message : 'read failed')
    }
    if (Buffer.byteLength(text) > MAX_PATCH_BYTES) {
      throw new PublicApiError('response_too_large', 'Blob exceeds the 5 MiB response cap')
    }
    return { text }
  }

  async stage(taskId: string, sel: z.infer<typeof GitPathsSchema>): Promise<GitAction> {
    const root = await this.root(taskId)
    if (sel.selection === 'all') return this.action(await stageAll(root))
    return this.batch(sel.paths.map((p) => () => stageFile(root, p)))
  }

  async unstage(taskId: string, sel: z.infer<typeof GitPathsSchema>): Promise<GitAction> {
    const root = await this.root(taskId)
    if (sel.selection === 'all') return this.action(await unstageAll(root))
    return this.batch(sel.paths.map((p) => () => unstageFile(root, p)))
  }

  async discard(taskId: string, sel: z.infer<typeof DiscardSchema>): Promise<GitAction> {
    const root = await this.root(taskId)
    if (sel.selection === 'all') {
      return this.action(sel.includeUntracked ? await discardAll(root) : await stripTracked(root))
    }
    return this.batch(sel.paths.map((p) => () => discardFile(root, p.path, p.untracked)))
  }

  async commit(taskId: string, input: z.infer<typeof CommitSchema>): Promise<{ commitSha: string; summary?: string }> {
    const root = await this.root(taskId)
    const result = await commitStaged(root, input.message)
    if (!result.ok) throw new PublicApiError('conflict', result.reason)
    const { stdout } = await exec('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 10_000 })
    return { commitSha: stdout.trim(), summary: input.message.trim().split('\n')[0] }
  }

  async push(taskId: string): Promise<GitAction> {
    const root = await this.root(taskId)
    const result = await pushBranch(root)
    if (!result.ok) {
      const code = /upstream|no upstream|set-upstream/i.test(result.reason) ? 'upstream_not_configured' : 'conflict'
      throw new PublicApiError(code, result.reason)
    }
    return { changed: true }
  }

  // Run a batch of git actions as one operation: any failure is a non-2xx (no partial success).
  private async batch(actions: (() => Promise<GitActionResult>)[]): Promise<GitAction> {
    for (const act of actions) {
      const r = await act()
      if (!r.ok) throw new PublicApiError('conflict', r.reason)
    }
    return { changed: true }
  }
}

// Discard-all without untracked: reset --hard restores tracked files but leaves untracked in place.
// execFile (argv array, no shell), so `root` is never interpolated into a command string.
async function stripTracked(root: string): Promise<GitActionResult> {
  try {
    await exec('git', ['-C', root, 'reset', '--hard'], { timeout: 30_000 })
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, reason: (e.stderr || e.message || 'git failed').trim().slice(0, 400) }
  }
}
