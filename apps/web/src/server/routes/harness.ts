import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'

// Harness routes (docs/next 06 catalog): the loopback surface the acorn MCP server's feature tools
// call — notes, memory (search/get/list + PROPOSE, never a silent write), and run targets. The
// backings live in the main process (NotesStore, memory index + runtime service), which shares
// this process in Electron; terminal.ts injects them via setHarnessBridge — the seam keeps these
// routes testable and keeps dev:node (no Electron) degrading to a clean 503.

export type HarnessBridge = {
  notesList(taskId: string): Promise<unknown[]>
  notesRead(taskId: string, slug: string): Promise<unknown>
  notesWrite(taskId: string, slug: string, body: string, agentSessionId?: string): Promise<void>
  notesAppend(taskId: string, slug: string, text: string, agentSessionId?: string): Promise<void>
  memorySearch(taskId: string, query: string, type?: string): Promise<unknown[]>
  memoryList(taskId: string, type?: string): Promise<unknown[]>
  memoryGet(taskId: string, name: string): Promise<unknown | null>
  memoryPropose(taskId: string, p: { name: string; type: string; description: string; body: string; originSessionId?: string }): Promise<unknown>
  runTargets(taskId: string): Promise<unknown>
  runStart(taskId: string, targetId: string): Promise<unknown>
  runStop(taskId: string, targetId: string): Promise<unknown>
  runStatus(taskId: string, targetId: string): Promise<unknown>
  // Drivable browser (docs/next 08 P2): CDP over the task's preview webview.
  browserNavigate(taskId: string, url: string): Promise<unknown>
  browserSnapshot(taskId: string): Promise<unknown>
  browserClick(taskId: string, ref: string): Promise<unknown>
  browserFill(taskId: string, ref: string, text: string): Promise<unknown>
  browserScreenshot(taskId: string): Promise<unknown>
  browserConsole(taskId: string): Promise<unknown>
}

let bridge: HarnessBridge | null = null
export const setHarnessBridge = (b: HarnessBridge | null): void => {
  bridge = b
}

const withBridge = async <T>(fn: (b: HarnessBridge) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
  if (!bridge) return { ok: false, error: 'bridge-unavailable' }
  try {
    return { ok: true, data: await fn(bridge) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'harness call failed' }
  }
}

export const harness = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401)
    await next()
  })
  .get('/:id/notes', async (c) => {
    const res = await withBridge((b) => b.notesList(c.req.param('id')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .get('/:id/notes/:slug', async (c) => {
    const res = await withBridge((b) => b.notesRead(c.req.param('id'), c.req.param('slug')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, res.error === 'bridge-unavailable' ? 503 : 404)
  })
  .put('/:id/notes/:slug', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { body?: string; sessionId?: string }
    if (typeof body.body !== 'string') return c.json({ error: 'bad_request' }, 400)
    const res = await withBridge((b) => b.notesWrite(c.req.param('id'), c.req.param('slug'), body.body!, body.sessionId))
    return res.ok ? c.json({ ok: true }) : c.json({ error: res.error }, 503)
  })
  .post('/:id/notes/:slug/append', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; sessionId?: string }
    if (!body.text) return c.json({ error: 'bad_request' }, 400)
    const res = await withBridge((b) => b.notesAppend(c.req.param('id'), c.req.param('slug'), body.text!, body.sessionId))
    return res.ok ? c.json({ ok: true }) : c.json({ error: res.error }, 503)
  })
  .get('/:id/memory', async (c) => {
    const q = c.req.query('q')
    const type = c.req.query('type')
    const res = await withBridge((b) => (q ? b.memorySearch(c.req.param('id'), q, type) : b.memoryList(c.req.param('id'), type)))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .get('/:id/memory/:name', async (c) => {
    const res = await withBridge((b) => b.memoryGet(c.req.param('id'), c.req.param('name')))
    if (!res.ok) return c.json({ error: res.error }, 503)
    return res.data ? c.json(res.data) : c.json({ error: 'not_found' }, 404)
  })
  // memory_write → a PROPOSAL through the human gate (docs/next 12); nothing lands on disk as
  // memory until the gate accepts.
  .post('/:id/memory/propose', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; type?: string; description?: string; body?: string; sessionId?: string }
    if (!body.name || !body.type || !body.description) return c.json({ error: 'bad_request' }, 400)
    const res = await withBridge((b) =>
      b.memoryPropose(c.req.param('id'), {
        name: body.name!,
        type: body.type!,
        description: body.description!,
        body: body.body ?? '',
        originSessionId: body.sessionId,
      }),
    )
    return res.ok ? c.json({ ok: true, proposal: res.data }) : c.json({ error: res.error }, res.error === 'bridge-unavailable' ? 503 : 400)
  })
  .get('/:id/run', async (c) => {
    const res = await withBridge((b) => b.runTargets(c.req.param('id')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .post('/:id/run/:target/start', async (c) => {
    const res = await withBridge((b) => b.runStart(c.req.param('id'), c.req.param('target')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .post('/:id/run/:target/stop', async (c) => {
    const res = await withBridge((b) => b.runStop(c.req.param('id'), c.req.param('target')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .get('/:id/run/:target/status', async (c) => {
    const res = await withBridge((b) => b.runStatus(c.req.param('id'), c.req.param('target')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .post('/:id/browser/navigate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string }
    if (!body.url || typeof body.url !== 'string') return c.json({ error: 'bad_request' }, 400)
    const res = await withBridge((b) => b.browserNavigate(c.req.param('id'), body.url!))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .get('/:id/browser/snapshot', async (c) => {
    const res = await withBridge((b) => b.browserSnapshot(c.req.param('id')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .post('/:id/browser/click', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ref?: string }
    if (!body.ref) return c.json({ error: 'bad_request' }, 400)
    const res = await withBridge((b) => b.browserClick(c.req.param('id'), body.ref!))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .post('/:id/browser/fill', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ref?: string; text?: string }
    if (!body.ref || typeof body.text !== 'string') return c.json({ error: 'bad_request' }, 400)
    const res = await withBridge((b) => b.browserFill(c.req.param('id'), body.ref!, body.text!))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .get('/:id/browser/screenshot', async (c) => {
    const res = await withBridge((b) => b.browserScreenshot(c.req.param('id')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
  .get('/:id/browser/console', async (c) => {
    const res = await withBridge((b) => b.browserConsole(c.req.param('id')))
    return res.ok ? c.json(res.data) : c.json({ error: res.error }, 503)
  })
