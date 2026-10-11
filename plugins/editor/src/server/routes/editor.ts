import { Hono } from 'hono'
import { z } from 'zod'
import {
  BridgeError,
  type AppEnv,
  requireDevice,
  respondError,
  routeCapability,
  routeCapabilityFor,
  setRouteTestCapability,
  viaBridge,
} from '@acorn/plugin-api/node'
import type { EditorLineMarkerSet, EditorLineMarkerSnapshot } from '../../contract/lineMarkers'
import { imageTypeForPath } from '../../contract/imagePreview'
import type { EditorFileStatusSnapshot } from '../../contract/fileStatus'

// Editor pane: read, write, and list files on the task's worktree. Task-scoped HTTP behind the
// EditorBridge (../editor.ts). The bridge confines every relative path to the worktree root
// (docs/security/process-and-paths.md § Process, path, and configuration controls), so a traversal or symlink escape is
// a 403 and an unmapped repo is a 404. See server/routes/editor.test.ts.

import type {
  EditorEntry,
  EditorReadResult,
  EditorWriteResult,
  FileActionResult,
  FileTarget,
  IgnoreEntries,
  TrashAvailability,
} from '../../contract/api'
export type { EditorEntry } from '../../contract/api'
export type { EditorWriteResult } from '../../contract/api'
export type EditorBridge = {
  root(taskId: string): Promise<string | null>
  list(taskId: string, relPath: string): Promise<EditorEntry[]>
  ignored(taskId: string, relPath: string, names: string[]): Promise<IgnoreEntries>
  files(taskId: string): Promise<string[]>
  read(taskId: string, relPath: string): Promise<EditorReadResult> // throws BridgeError(403/404) on escape/missing
  readImage(taskId: string, relPath: string): Promise<Uint8Array>
  lineMarkers(taskId: string, relPath: string): Promise<EditorLineMarkerSet[]>
  markerSnapshot?(taskId: string, relPath: string, revision: string): Promise<EditorLineMarkerSnapshot>
  fileStatus(taskId: string): Promise<EditorFileStatusSnapshot>
  write(taskId: string, relPath: string, content: string, expectedRevision: string | null): Promise<EditorWriteResult>
  entry(taskId: string, path: string): Promise<FileTarget>
  trashAvailability(taskId: string): Promise<TrashAvailability>
  renameAvailability(): Promise<TrashAvailability>
  create(taskId: string, parent: FileTarget, name: string, kind: 'file' | 'folder'): Promise<FileActionResult>
  rename(taskId: string, source: FileTarget, name: string): Promise<FileActionResult>
  trash(taskId: string, source: FileTarget): Promise<FileActionResult>
}

export const EDITOR = routeCapability<EditorBridge>('editor.route')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setEditorBridge = (bridge: EditorBridge | null): void => setRouteTestCapability(EDITOR, bridge)

// Write touches the filesystem, so the body is validated (the privileged-boundary contract).
const writeBody = z.object({
  path: z.string().min(1),
  content: z.string(),
  expectedRevision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
})
const targetBody = z.object({
  path: z.string(),
  kind: z.enum(['file', 'folder', 'link']),
  identity: z.string().min(1),
  entryId: z.string().min(1),
  root: z.string().min(1),
})
const createBody = z.object({ parent: targetBody, name: z.string(), kind: z.enum(['file', 'folder']) })
const renameBody = z.object({ source: targetBody, name: z.string() })
const trashBody = z.object({ source: targetBody })
const ignoredBody = z.object({ path: z.string().max(4096), names: z.array(z.string().min(1).max(255)).max(10000) })

export const editor = new Hono<AppEnv>()
  .get('/:id/editor/root', (c) => viaBridge(c, EDITOR, async (b) => ({ root: await b.root(c.req.param('id')) })))
  .get('/:id/editor/files', (c) => viaBridge(c, EDITOR, (b) => b.files(c.req.param('id'))))
  .get('/:id/editor/file-status', (c) => viaBridge(c, EDITOR, (b) => b.fileStatus(c.req.param('id'))))
  // relPath rides a query param ('' = worktree root); the bridge validates it, so no schema here.
  .get('/:id/editor/list', (c) => viaBridge(c, EDITOR, (b) => b.list(c.req.param('id'), c.req.query('path') ?? '')))
  .post('/:id/editor/ignored', async (c) => {
    const parsed = ignoredBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) => b.ignored(c.req.param('id'), parsed.data.path, parsed.data.names))
  })
  .get('/:id/editor/read', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) => b.read(c.req.param('id'), path))
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
      if (error instanceof BridgeError)
        return respondError(c, error.status, error.code, error.message ? [error.message] : undefined)
      throw error
    }
  })
  .get('/:id/editor/line-markers', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    const revision = c.req.query('revision')
    if (revision !== undefined && !/^[a-f0-9]{64}$/.test(revision)) return respondError(c, 400, 'bad_request')
    // A request without a revision comes from a client that predates marker snapshots, and gets the
    // plain array it expects. Mixed-version path until 2026-12-31.
    return viaBridge(c, EDITOR, async (b) =>
      revision === undefined
        ? b.lineMarkers(c.req.param('id'), path)
        : (b.markerSnapshot?.(c.req.param('id'), path, revision) ?? { revision: null, markers: [] }),
    )
  })
  .put('/:id/editor/file', async (c) => {
    const parsed = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) =>
      b.write(c.req.param('id'), parsed.data.path, parsed.data.content, parsed.data.expectedRevision),
    )
  })
  .get('/:id/editor/entry', requireDevice, (c) =>
    viaBridge(c, EDITOR, (b) => b.entry(c.req.param('id'), c.req.query('path') ?? '')),
  )
  .get('/:id/editor/trash-availability', requireDevice, (c) =>
    viaBridge(c, EDITOR, (b) => b.trashAvailability(c.req.param('id'))),
  )
  .get('/:id/editor/rename-availability', requireDevice, (c) => viaBridge(c, EDITOR, (b) => b.renameAvailability()))
  .post('/:id/editor/create', requireDevice, async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) =>
      b.create(c.req.param('id'), parsed.data.parent, parsed.data.name, parsed.data.kind),
    )
  })
  .post('/:id/editor/rename', requireDevice, async (c) => {
    const parsed = renameBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) => b.rename(c.req.param('id'), parsed.data.source, parsed.data.name))
  })
  .post('/:id/editor/trash', requireDevice, async (c) => {
    const parsed = trashBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, EDITOR, (b) => b.trash(c.req.param('id'), parsed.data.source))
  })
