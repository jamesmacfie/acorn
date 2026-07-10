import { Hono } from 'hono'
import { z } from 'zod'
import { bridgeSlot, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Editor pane (docs/workspaces): read/write/list files on the task's worktree. Was the `editor:*`
// IPC channels (inventories §1a); now task-scoped HTTP behind the EditorBridge (main/editor.ts).
// The bridge confines every relative path to the worktree root, so traversal/symlink escapes are
// rejected (403) and an unmapped repo is a 404 — see server/routes/editor.test.ts.

export type EditorEntry = { name: string; dir: boolean }
export type EditorWriteResult = { ok: boolean; reason?: string }
export type EditorBridge = {
  root(taskId: string): Promise<string | null>
  list(taskId: string, relPath: string): Promise<EditorEntry[]>
  files(taskId: string): Promise<string[]>
  read(taskId: string, relPath: string): Promise<string> // throws BridgeError(403/404) on escape/missing
  write(taskId: string, relPath: string, content: string): Promise<EditorWriteResult>
}

export const editorBridgeSlot = bridgeSlot<EditorBridge>()
export const setEditorBridge = editorBridgeSlot.set

// Write touches the filesystem, so the body is validated (Phase 3 §1).
const writeBody = z.object({ path: z.string().min(1), content: z.string() })

export const editor = new Hono<AppEnv>()
  .get('/:id/editor/root', (c) => viaBridge(c, editorBridgeSlot, async (b) => ({ root: await b.root(c.req.param('id')) })))
  .get('/:id/editor/files', (c) => viaBridge(c, editorBridgeSlot, (b) => b.files(c.req.param('id'))))
  // relPath rides a query param ('' = worktree root); the bridge validates it, so no schema here.
  .get('/:id/editor/list', (c) => viaBridge(c, editorBridgeSlot, (b) => b.list(c.req.param('id'), c.req.query('path') ?? '')))
  .get('/:id/editor/read', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    return viaBridge(c, editorBridgeSlot, async (b) => ({ text: await b.read(c.req.param('id'), path) }))
  })
  .put('/:id/editor/file', async (c) => {
    const parsed = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, editorBridgeSlot, (b) => b.write(c.req.param('id'), parsed.data.path, parsed.data.content))
  })
