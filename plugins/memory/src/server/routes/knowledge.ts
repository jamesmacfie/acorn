import { Hono } from 'hono'
import { z } from 'zod'
import type { Context } from 'hono'
import type { NoteLocation } from '@acorn/protocol/notes.ts'
import { bridgeSlot, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { isTaskConfined, requireDevice } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'

// Notes + memory (docs/notes-and-memory.md): the renderer's knowledge surface — was the
// `memory:*` and `notes:*` IPC channels. Distinct from the harness memory/notes
// bridges (the MCP agent surface): this is the human-facing pane (manual add, the proposal gate,
// note CRUD + inclusion). Backed by the same NotesStore + memory index in the main process, so it
// 503s under dev:node. Mounted at the plugin namespace root to carry /memory*, /tasks/:id/notes* and
// /workspaces/:wsId/notes* alike — hence the doubled /v2/p/memory/memory (see app/server/routes.ts).

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

export const knowledgeBridgeSlot = bridgeSlot<KnowledgeBridge>()
export const setKnowledgeBridge = knowledgeBridgeSlot.set

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
  // The workspace/global note surface is DEVICE ONLY, and phase3-notes.md had this exactly backwards: it
  // dismissed these routes as "workspace-scoped, not task-scoped" as a reason to skip a gate. A workspace
  // holds many tasks and `global` holds all of them, so workspace-scoped is BROADER than task scope, not
  // narrower — the widest surface in the router was the one left open.
  //
  // What a task-scoped agent could do with it: create, overwrite, retitle or delete a note in any
  // workspace or in `global`, and — the one that turns a leak into an injection — POST `included: true`.
  // An included global or workspace note is assembled into EVERY task's context block
  // (plugins/notes/src/node/index.ts), and the sibling-note compatibility filter cannot stop it, because
  // that filter keys on `originTaskId` and a note created for a non-task location has none. It also walks
  // straight past the `notes_write` tool-permission preference, which is enforced only on the agent-tool
  // surface in core's routes/agentTools.ts.
  //
  // An agent loses nothing it should have: `notes_list`/`notes_read`/`notes_write`/`notes_append` cover
  // all three scopes, resolve the workspace from the agent's OWN task rather than from a caller-supplied
  // id, stamp `author: 'agent'` with the session, are permission-checked per task, and cannot set
  // `included` at all.
  //
  // Whole subtree rather than the four writes: `GET /workspaces/:wsId/notes` enumerates every note in any
  // workspace with its body one read away, which is the same shape of leak as the roster Phase 3 filtered.
  // Measured — Hono's trailing `/*` matches zero segments, so this one mount also covers the bare
  // `/workspaces/:wsId/notes`; the test pins both so a Hono upgrade cannot quietly unmount half of it.
  .use('/workspaces/:wsId/notes/*', requireDevice)
  // --- memory ---
  .get('/memory', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryList(c.req.query('repo') ?? undefined)))
  .get('/memory/search', (c) => {
    const q = c.req.query('q')
    if (!q) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.memorySearch(q, c.req.query('repo') ?? undefined, c.req.query('type') ?? undefined))
  })
  .get('/memory/proposals', (c) => {
    const filter = confineTaskQuery(c)
    // 404 rather than 403, matching every other confinement denial in this codebase: the answer must not
    // reveal whether the task the caller named exists.
    if (!filter) return respondError(c, 404, 'not_found')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryProposals(filter.taskId))
  })
  // Device only, and this is the point of a proposal rather than a hardening afterthought.
  //
  // `memory_write`'s tool description promises the agent that what it writes is "proposed for human
  // review". Nothing enforced that: the path carries no `/tasks/:id`, so Phase 3's
  // `/v2/p/:plugin/tasks/:id*` mount never saw it, and the router added nothing — so an agent could
  // approve its own proposal, or approve ANY task's pending proposal with an attacker-chosen `edited`
  // body, which knowledgeIpc.ts then writes into that proposal's own worktree.
  //
  // Not `requireProviderAccess` (device ∪ service) and not a per-task confinement: the human at the
  // keyboard IS the gate. The service scope has no reason to resolve a proposal either — nothing in the
  // node's own loopback calls approves memory.
  .post('/memory/proposals/:id/resolve', requireDevice, async (c) => {
    const p = resolveBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryResolveProposal(c.req.param('id'), p.data.approved, p.data.edited))
  })
  .post('/tasks/:id/memory', async (c) => {
    const p = addBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryAdd(c.req.param('id'), p.data))
  })
  // --- notes (global/workspace compatibility path + first-class task scope) ---
  .get('/workspaces/:wsId/notes', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesList(workspaceLocation(c.req.param('wsId')))))
  .get('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesRead(workspaceLocation(c.req.param('wsId')), c.req.param('slug'))))
  .post('/workspaces/:wsId/notes', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesCreate(workspaceLocation(c.req.param('wsId')), p.data.title, p.data.kind))
  })
  .put('/workspaces/:wsId/notes/:slug', async (c) => {
    const p = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesWrite(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), p.data.body))
  })
  .post('/workspaces/:wsId/notes/:slug/included', async (c) => {
    const p = includedBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesSetIncluded(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), p.data.included))
  })
  .post('/workspaces/:wsId/notes/:slug/title', async (c) => {
    const p = titleBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesSetTitle(workspaceLocation(c.req.param('wsId')), c.req.param('slug'), p.data.title))
  })
  .delete('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesRemove(workspaceLocation(c.req.param('wsId')), c.req.param('slug'))))
  .get('/tasks/:id/notes', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesList(taskLocation(c.req.param('id')))))
  .get('/tasks/:id/notes/:slug', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesRead(taskLocation(c.req.param('id')), c.req.param('slug'))))
  .post('/tasks/:id/notes', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesCreate(taskLocation(c.req.param('id')), p.data.title, p.data.kind))
  })
  .put('/tasks/:id/notes/:slug', async (c) => {
    const p = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesWrite(taskLocation(c.req.param('id')), c.req.param('slug'), p.data.body))
  })
  .post('/tasks/:id/notes/:slug/included', async (c) => {
    const p = includedBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesSetIncluded(taskLocation(c.req.param('id')), c.req.param('slug'), p.data.included))
  })
  .post('/tasks/:id/notes/:slug/title', async (c) => {
    const p = titleBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesSetTitle(taskLocation(c.req.param('id')), c.req.param('slug'), p.data.title))
  })
  .delete('/tasks/:id/notes/:slug', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesRemove(taskLocation(c.req.param('id')), c.req.param('slug'))))
