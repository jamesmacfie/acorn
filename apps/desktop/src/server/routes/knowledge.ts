import { Hono } from 'hono'
import { z } from 'zod'
import { bridgeSlot, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Notes + memory (docs/notes-and-memory.md, docs/next 12): the renderer's knowledge surface — was the
// `memory:*` and `notes:*` IPC channels (inventories §1a). Distinct from the harness memory/notes
// bridges (the MCP agent surface): this is the human-facing pane (manual add, the proposal gate,
// note CRUD + inclusion). Backed by the same NotesStore + memory index in the main process, so it
// 503s under dev:node. Mounted at /api to carry both /memory* and /workspaces/:wsId/notes* paths.

export type KnowledgeBridge = {
  memoryList(repo?: string): Promise<unknown>
  memorySearch(query: string, repo?: string, type?: string): Promise<unknown>
  memoryAdd(taskId: string, p: { scope: 'repo' | 'private'; name: string; description: string; type: string; body: string }): Promise<unknown>
  memoryProposals(taskId?: string): Promise<unknown>
  memoryResolveProposal(id: string, approved: boolean, edited?: { name: string; type: string; description: string; body: string }): Promise<unknown>
  notesList(workspaceId: string): Promise<unknown>
  notesRead(workspaceId: string, slug: string): Promise<unknown>
  notesCreate(workspaceId: string, title: string, kind?: string): Promise<unknown>
  notesWrite(workspaceId: string, slug: string, body: string): Promise<unknown>
  notesSetIncluded(workspaceId: string, slug: string, included: boolean): Promise<unknown>
  notesRemove(workspaceId: string, slug: string): Promise<unknown>
}

export const knowledgeBridgeSlot = bridgeSlot<KnowledgeBridge>()
export const setKnowledgeBridge = knowledgeBridgeSlot.set

// Everything that writes a memory file / note gets a validated body (Phase 3 §1).
const editedShape = z.object({ name: z.string(), type: z.string(), description: z.string(), body: z.string() })
const addBody = z.object({ scope: z.enum(['repo', 'private']), name: z.string(), description: z.string(), type: z.string(), body: z.string() })
const resolveBody = z.object({ approved: z.boolean(), edited: editedShape.optional() })
const createBody = z.object({ title: z.string(), kind: z.string().optional() })
const writeBody = z.object({ body: z.string() })
const includedBody = z.object({ included: z.boolean() })

export const knowledge = new Hono<AppEnv>()
  // --- memory ---
  .get('/memory', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryList(c.req.query('repo') ?? undefined)))
  .get('/memory/search', (c) => {
    const q = c.req.query('q')
    if (!q) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.memorySearch(q, c.req.query('repo') ?? undefined, c.req.query('type') ?? undefined))
  })
  .get('/memory/proposals', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryProposals(c.req.query('task') ?? undefined)))
  .post('/memory/proposals/:id/resolve', async (c) => {
    const p = resolveBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryResolveProposal(c.req.param('id'), p.data.approved, p.data.edited))
  })
  .post('/tasks/:id/memory', async (c) => {
    const p = addBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.memoryAdd(c.req.param('id'), p.data))
  })
  // --- notes (workspace-scoped) ---
  .get('/workspaces/:wsId/notes', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesList(c.req.param('wsId'))))
  .get('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesRead(c.req.param('wsId'), c.req.param('slug'))))
  .post('/workspaces/:wsId/notes', async (c) => {
    const p = createBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesCreate(c.req.param('wsId'), p.data.title, p.data.kind))
  })
  .put('/workspaces/:wsId/notes/:slug', async (c) => {
    const p = writeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesWrite(c.req.param('wsId'), c.req.param('slug'), p.data.body))
  })
  .post('/workspaces/:wsId/notes/:slug/included', async (c) => {
    const p = includedBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, knowledgeBridgeSlot, (b) => b.notesSetIncluded(c.req.param('wsId'), c.req.param('slug'), p.data.included))
  })
  .delete('/workspaces/:wsId/notes/:slug', (c) => viaBridge(c, knowledgeBridgeSlot, (b) => b.notesRemove(c.req.param('wsId'), c.req.param('slug'))))
