import { Hono } from 'hono'
import { z } from 'zod'
import { routeCapability, setRouteTestCapability, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

// Editor pane (docs/workspaces-and-tasks.md): read/write/list files on the task's worktree. Was the `editor:*`
// IPC channels; now task-scoped HTTP behind the EditorBridge (main/editor.ts).
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

export const EDITOR = routeCapability<EditorBridge>('editor.route')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setEditorBridge = (bridge: EditorBridge | null): void => setRouteTestCapability(EDITOR, bridge)

// Write touches the filesystem, so the body is validated (the privileged-boundary contract).
const writeBody = z.object({ path: z.string().min(1), content: z.string() })

export const editor = new Hono<AppEnv>()
  .get('/:id/editor/root', (c) => viaBridge(c, EDITOR, async (b) => ({ root: await b.root(c.req.param('id')) })))
  .get('/:id/editor/files', (c) => viaBridge(c, EDITOR, (b) => b.files(c.req.param('id'))))
  // relPath rides a query param ('' = worktree root); the bridge validates it, so no schema here.
  .get('/:id/editor/list', (c) => viaBridge(c, EDITOR, (b) => b.list(c.req.param('id'), c.req.query('path') ?? '')))
  .get('/:id/editor/read', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, async (b) => ({ text: await b.read(c.req.param('id'), path) }))
  })
  .put('/:id/editor/file', async (c) => {
    const parsed = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) => b.write(c.req.param('id'), parsed.data.path, parsed.data.content))
  })
