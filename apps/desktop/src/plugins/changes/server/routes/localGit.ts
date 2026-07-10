import { Hono } from 'hono'
import { z } from 'zod'
import type { LocalChange } from '../../../../core/shared/terminal'
import { bridgeSlot, viaBridge } from '../../../../core/server/bridge'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { respondError } from '../../../../core/server/respond'

// Local-changes review (docs/panes.md): the ChangesPane's working-tree status/diff/blob reads and
// stage/commit/discard/push actions. Was the `local:*` IPC channels (inventories §1a); now task-
// scoped HTTP behind the LocalGitBridge (main/localGit.ts). Pure-Node → works in dev:node.

export type LocalScope = 'unstaged' | 'staged'
export type GitActionResult = { ok: boolean; reason?: string }
export type LocalGitBridge = {
  changes(taskId: string): Promise<LocalChange[]>
  diff(taskId: string, path: string, scope: LocalScope): Promise<{ patch: string } | { error: string }>
  blob(taskId: string, path: string, ref?: string): Promise<{ text: string } | { error: string }>
  stage(taskId: string, path: string): Promise<GitActionResult>
  unstage(taskId: string, path: string): Promise<GitActionResult>
  discard(taskId: string, path: string, untracked?: boolean): Promise<GitActionResult>
  commit(taskId: string, message: string): Promise<GitActionResult>
  stageAll(taskId: string): Promise<GitActionResult>
  unstageAll(taskId: string): Promise<GitActionResult>
  discardAll(taskId: string): Promise<GitActionResult>
  push(taskId: string): Promise<GitActionResult>
}

export const localGitBridgeSlot = bridgeSlot<LocalGitBridge>()
export const setLocalGitBridge = localGitBridgeSlot.set

// Stage/discard/commit run git against the worktree, so path/message bodies are validated (§1).
const pathBody = z.object({ path: z.string().min(1) })
const discardBody = z.object({ path: z.string().min(1), untracked: z.boolean().optional() })
const commitBody = z.object({ message: z.string() })

const id = (c: { req: { param(k: string): string } }) => c.req.param('id')

export const localGit = new Hono<AppEnv>()
  .get('/:id/local/changes', (c) => viaBridge(c, localGitBridgeSlot, (b) => b.changes(id(c))))
  .get('/:id/local/diff', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    return viaBridge(c, localGitBridgeSlot, (b) => b.diff(id(c), path, c.req.query('scope') === 'staged' ? 'staged' : 'unstaged'))
  })
  .get('/:id/local/blob', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    return viaBridge(c, localGitBridgeSlot, (b) => b.blob(id(c), path, c.req.query('ref') ?? undefined))
  })
  .post('/:id/local/stage', async (c) => {
    const p = pathBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, localGitBridgeSlot, (b) => b.stage(id(c), p.data.path))
  })
  .post('/:id/local/unstage', async (c) => {
    const p = pathBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, localGitBridgeSlot, (b) => b.unstage(id(c), p.data.path))
  })
  .post('/:id/local/discard', async (c) => {
    const p = discardBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, localGitBridgeSlot, (b) => b.discard(id(c), p.data.path, p.data.untracked))
  })
  .post('/:id/local/commit', async (c) => {
    const p = commitBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, localGitBridgeSlot, (b) => b.commit(id(c), p.data.message))
  })
  .post('/:id/local/stage-all', (c) => viaBridge(c, localGitBridgeSlot, (b) => b.stageAll(id(c))))
  .post('/:id/local/unstage-all', (c) => viaBridge(c, localGitBridgeSlot, (b) => b.unstageAll(id(c))))
  .post('/:id/local/discard-all', (c) => viaBridge(c, localGitBridgeSlot, (b) => b.discardAll(id(c))))
  .post('/:id/local/push', (c) => viaBridge(c, localGitBridgeSlot, (b) => b.push(id(c))))
