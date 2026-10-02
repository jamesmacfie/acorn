import { Hono } from 'hono'
import { z } from 'zod'
import { BridgeError, type AppEnv, respondError, routeCapability, routeCapabilityFor, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
import type { EditorLineMarkerSet } from '../../contract/lineMarkers'
import { imageTypeForPath } from '../../contract/imagePreview'

// Editor pane: read, write, and list files on the task's worktree. Task-scoped HTTP behind the
// EditorBridge (../editor.ts). The bridge confines every relative path to the worktree root
// (docs/security.md § Process, path, and configuration controls), so a traversal or symlink escape is
// a 403 and an unmapped repo is a 404. See server/routes/editor.test.ts.

export type EditorEntry = { name: string; dir: boolean }
import type { EditorWriteResult } from '../../contract/api'
export type { EditorWriteResult } from '../../contract/api'
export type EditorBridge = {
  root(taskId: string): Promise<string | null>
  list(taskId: string, relPath: string): Promise<EditorEntry[]>
  files(taskId: string): Promise<string[]>
  read(taskId: string, relPath: string): Promise<string> // throws BridgeError(403/404) on escape/missing
  readImage(taskId: string, relPath: string): Promise<Uint8Array>
  lineMarkers(taskId: string, relPath: string): Promise<EditorLineMarkerSet[]>
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
  .get('/:id/editor/image', async (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    const type = imageTypeForPath(path)
    if (!type) return respondError(c, 422, 'unsupported_image')
    const bridge = routeCapabilityFor(c, EDITOR)
    if (!bridge) return respondError(c, 503, 'bridge-unavailable')
    try {
      const bytes = await bridge.readImage(c.req.param('id'), path)
      return c.body(Uint8Array.from(bytes), 200, {
        'content-type': type,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      })
    } catch (error) {
      if (error instanceof BridgeError) return respondError(c, error.status, error.code, error.message ? [error.message] : undefined)
      throw error
    }
  })
  .get('/:id/editor/line-markers', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) => b.lineMarkers(c.req.param('id'), path))
  })
  .put('/:id/editor/file', async (c) => {
    const parsed = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) => b.write(c.req.param('id'), parsed.data.path, parsed.data.content))
  })
