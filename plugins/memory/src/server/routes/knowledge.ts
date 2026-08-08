import { Hono } from 'hono'
import { z } from 'zod'
import type { Context } from 'hono'
import type { NoteLocation } from '@acorn/protocol/notes.ts'
import { routeCapability, setRouteTestCapability, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { isTaskConfined, requireDevice } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

// Memory's route surface plus a one-release compatibility alias for the notes routes. The notes
// plugin owns the current `/v2/p/notes/*` namespace; these `/v2/p/memory/*/notes` paths remain only
// for clients and agent prompts that may have retained the old URL. Both surfaces use the same
// NotesStore capability, so the alias cannot create a second source of truth.

export type KnowledgeBridge = {
  memoryList(repo?: string): Promise<unknown>
  memorySearch(query: string, repo?: string, type?: string): Promise<unknown>
  memoryAdd(taskId: string, p: { scope: 'repo' | 'private'; name: string; description: string; type: string; body: string }): Promise<unknown>
  memoryProposals(taskId?: string): Promise<unknown>
  memoryResolveProposal(id: string, approved: boolean, edited?: { name: string; type: string; description: string; body: string }): Promise<unknown>
  notesList(location: NoteLocation): Promise<unknown>
  notesRead(location: NoteLocation, slug: string): Promise<unknown>
  notesCreate(location: NoteLocation, title: string, kind?: string): Promise<unknown>
  notesWrite(location: NoteLocation, slug: string, body: string): Promise<unknown>
  notesSetIncluded(location: NoteLocation, slug: string, included: boolean): Promise<unknown>
  notesSetTitle(location: NoteLocation, slug: string, title: string): Promise<unknown>
  notesRemove(location: NoteLocation, slug: string): Promise<unknown>
}

export const KNOWLEDGE = routeCapability<KnowledgeBridge>('memory.knowledgeRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setKnowledgeBridge = (bridge: KnowledgeBridge | null): void => setRouteTestCapability(KNOWLEDGE, bridge)

// Everything that writes a memory file / note gets a validated body (the privileged-boundary contract).
const editedShape = z.object({ name: z.string(), type: z.string(), description: z.string(), body: z.string() })
const addBody = z.object({ scope: z.enum(['repo', 'private']), name: z.string(), description: z.string(), type: z.string(), body: z.string() })
const resolveBody = z.object({ approved: z.boolean(), edited: editedShape.optional() })
const createBody = z.object({ title: z.string(), kind: z.string().optional() })
const writeBody = z.object({ body: z.string() })
const includedBody = z.object({ included: z.boolean() })
const titleBody = z.object({ title: z.string().trim().min(1) })
const workspaceLocation = (id: string): NoteLocation => (id === 'global' ? { scope: 'global' } : { scope: 'workspace', workspaceId: id })
const taskLocation = (id: string): NoteLocation => ({ scope: 'task', taskId: id })

// Pin the proposal list to a confined caller's own task, the way plugins/agents' `confineFilter` pins
// its session roster. `GET /memory/proposals` with no `?task=` returns EVERY pending proposal on the
// node with bodies included, and with a `?task=` it honoured whatever was asked for — so an agent could
// read the pending memory writes of every other task by asking nicely.
//
// null means refuse: the caller named a task that is not its own, or is confined and carries no task at
// all. Silently rewriting the filter would answer a question nobody asked, which is the same reasoning
// managed.ts records.
const confineTaskQuery = (c: Context<AppEnv>): { taskId?: string } | null => {
  const asked = c.req.query('task') ?? undefined
  if (!isTaskConfined(c)) return { taskId: asked }
  const own = c.get('principal')?.taskId
  if (!own) return null
  if (asked && asked !== own) return null
  return { taskId: own }
}

export const knowledge = new Hono<AppEnv>()
  .use('/workspaces/:wsId/notes/*', requireDevice)
  // --- memory ---
  .get('/memory', (c) => viaBridge(c, KNOWLEDGE, (b) => b.memoryList(c.req.query('repo') ?? undefined)))
  .get('/memory/search', (c) => {
    const q = c.req.query('q')
    if (!q) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.memorySearch(q, c.req.query('repo') ?? undefined, c.req.query('type') ?? undefined))
  })
  .get('/memory/proposals', (c) => {
    const filter = confineTaskQuery(c)
    // 404 rather than 403, matching every other confinement denial in this codebase: the answer must not
    // reveal whether the task the caller named exists.
    if (!filter) return respondError(c, 404, 'not_found')
    return viaBridge(c, KNOWLEDGE, (b) => b.memoryProposals(filter.taskId))
  })
  .post('/memory/proposals/:id/resolve', requireDevice, async (c) => {
    const p = resolveBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.memoryResolveProposal(c.req.param('id'), p.data.approved, p.data.edited))
  })
  .post('/tasks/:id/memory', async (c) => {
    const p = addBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.memoryAdd(c.req.param('id'), p.data))
  })
  // --- notes compatibility alias (the current routes live in plugins/notes) ---
  .get('/workspaces/:wsId/notes', (c) => viaBridge(c, KNOWLEDGE, (b) => b.notesList(workspaceLocation(c.req.param('wsId')))))
  .get('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, KNOWLEDGE, (b) => b.notesRead(workspaceLocation(c.req.param('wsId')), c.req.param('slug'))))
  .post('/workspaces/:wsId/notes', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesCreate(workspaceLocation(c.req.param('wsId')), p.data.title, p.data.kind))
  })
  .put('/workspaces/:wsId/notes/:slug', async (c) => {
    const p = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesWrite(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), p.data.body))
  })
  .post('/workspaces/:wsId/notes/:slug/included', async (c) => {
    const p = includedBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesSetIncluded(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), p.data.included))
  })
  .post('/workspaces/:wsId/notes/:slug/title', async (c) => {
    const p = titleBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesSetTitle(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), p.data.title))
  })
  .delete('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, KNOWLEDGE, (b) => b.notesRemove(workspaceLocation(c.req.param('wsId')), c.req.param('slug'))))
  .get('/tasks/:id/notes', (c) => viaBridge(c, KNOWLEDGE, (b) => b.notesList(taskLocation(c.req.param('id')))))
  .get('/tasks/:id/notes/:slug', (c) => viaBridge(c, KNOWLEDGE, (b) => b.notesRead(taskLocation(c.req.param('id')), c.req.param('slug'))))
  .post('/tasks/:id/notes', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesCreate(taskLocation(c.req.param('id')), p.data.title, p.data.kind))
  })
  .put('/tasks/:id/notes/:slug', async (c) => {
    const p = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesWrite(taskLocation(c.req.param('id')), c.req.param('slug'), p.data.body))
  })
  .post('/tasks/:id/notes/:slug/included', async (c) => {
    const p = includedBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesSetIncluded(taskLocation(c.req.param('id')), c.req.param('slug'), p.data.included))
  })
  .post('/tasks/:id/notes/:slug/title', async (c) => {
    const p = titleBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, KNOWLEDGE, (b) => b.notesSetTitle(taskLocation(c.req.param('id')), c.req.param('slug'), p.data.title))
  })
  .delete('/tasks/:id/notes/:slug', (c) => viaBridge(c, KNOWLEDGE, (b) => b.notesRemove(taskLocation(c.req.param('id')), c.req.param('slug'))))
