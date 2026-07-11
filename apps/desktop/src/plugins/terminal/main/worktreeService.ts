import { eq } from 'drizzle-orm'
import { type AppDatabase, schema } from '../../../core/server/db'
import { getRepoPath } from '../../../core/main/repoPaths'
import { isDir, loadTask, resolveTaskCwd } from '../../../core/main/taskWorktree'
import { currentBranch, removeWorktree, worktreePorcelain } from '../../../core/main/worktrees'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type { z } from 'zod'
import type { WorktreeStatusSchema } from '../../../core/shared/publicApi/terminal'

// WorktreeService (docs/next/api/terminal-git-files.md §5). Task-scoped worktree status + lazy
// create/adopt/remove, reusing the same resolveTaskCwd/removeWorktree primitives as the UI. The
// taskId is the capability; no caller-supplied path is accepted.

type WorktreeStatus = z.infer<typeof WorktreeStatusSchema>

export class WorktreeService {
  constructor(private readonly db: AppDatabase) {}

  private async baseCheckout(owner: string, name: string): Promise<string | undefined> {
    const mapped = await getRepoPath(this.db, owner, name)
    return mapped?.path && isDir(mapped.path) ? mapped.path : undefined
  }

  async status(taskId: string): Promise<WorktreeStatus> {
    const t = await loadTask(this.db, taskId)
    if (!t) throw new PublicApiError('not_found', 'Task not found')
    const wt = t.worktreePath
    if (!wt) return { taskId, worktreePath: null, isWorktree: false, branch: null, dirty: false, dirtyCount: 0, missing: false }
    if (!isDir(wt)) return { taskId, worktreePath: wt, isWorktree: true, branch: null, dirty: false, dirtyCount: 0, missing: true }
    const porcelain = await worktreePorcelain(wt).catch(() => ({ dirty: false, count: 0 }))
    const branch = await currentBranch(wt).catch(() => null)
    return { taskId, worktreePath: wt, isWorktree: true, branch, dirty: porcelain.dirty, dirtyCount: porcelain.count, missing: false }
  }

  async create(taskId: string): Promise<WorktreeStatus> {
    const t = await loadTask(this.db, taskId)
    if (!t) throw new PublicApiError('not_found', 'Task not found')
    const base = await this.baseCheckout(t.repoOwner, t.repoName)
    if (!base) throw new PublicApiError('conflict', 'No local checkout is mapped for this repository')
    const { isWorktree } = await resolveTaskCwd(this.db, t, base)
    if (!isWorktree) throw new PublicApiError('conflict', 'Could not create the worktree')
    return this.status(taskId)
  }

  // Adopt the repo's current checkout as the task's working directory (the 'current-checkout' mode).
  async adoptCheckout(taskId: string): Promise<WorktreeStatus & { branch: string | null }> {
    const t = await loadTask(this.db, taskId)
    if (!t) throw new PublicApiError('not_found', 'Task not found')
    const base = await this.baseCheckout(t.repoOwner, t.repoName)
    if (!base) throw new PublicApiError('conflict', 'No local checkout is mapped for this repository')
    await this.db.update(schema.tasks).set({ worktreePath: base, updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId))
    const status = await this.status(taskId)
    return { ...status, branch: status.branch }
  }

  async remove(taskId: string, force: boolean): Promise<void> {
    const t = await loadTask(this.db, taskId)
    if (!t) throw new PublicApiError('not_found', 'Task not found')
    if (!t.worktreePath) return
    const base = await this.baseCheckout(t.repoOwner, t.repoName)
    // Adopted checkouts (worktreePath === base) are not removable git worktrees; just detach.
    if (base && t.worktreePath !== base && isDir(t.worktreePath)) {
      const res = await removeWorktree(base, t.worktreePath, force)
      if (!res.ok) throw new PublicApiError('dirty_worktree', res.reason)
    }
    await this.db.update(schema.tasks).set({ worktreePath: null, updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId))
  }
}
