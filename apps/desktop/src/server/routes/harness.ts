import { Hono, type Context } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Harness routes (docs/mcp.md): the loopback surface the acorn MCP server's feature tools
// call — notes, memory (search/get/list + PROPOSE, never a silent write), run targets and the
// drivable browser. The backings live in the main process (NotesStore, memory index + runtime
// service, CDP driver), which shares this process in Electron; main/harnessWiring.ts injects one
// sub-bridge per domain via the setters below — the seam keeps these routes testable and keeps
// dev:node (no Electron) degrading to a clean 503.

// ─── Per-domain sub-bridges (wired independently by main/harnessWiring.ts) ──────────────────────

export type NotesBridge = {
  list(taskId: string): Promise<unknown[]>
  read(taskId: string, slug: string): Promise<unknown>
  write(taskId: string, slug: string, body: string, agentSessionId?: string): Promise<void>
  append(taskId: string, slug: string, text: string, agentSessionId?: string): Promise<void>
}

export type MemoryBridge = {
  search(taskId: string, query: string, type?: string): Promise<unknown[]>
  list(taskId: string, type?: string): Promise<unknown[]>
  get(taskId: string, name: string): Promise<unknown | null>
  // memory_write → a PROPOSAL through the human gate (docs/next 12); nothing lands on disk as
  // memory until the gate accepts.
  propose(taskId: string, p: { name: string; type: string; description: string; body: string; originSessionId?: string }): Promise<unknown>
}

export type RunBridge = {
  targets(taskId: string): Promise<unknown>
  start(taskId: string, targetId: string): Promise<unknown>
  stop(taskId: string, targetId: string): Promise<unknown>
  restart(taskId: string, targetId: string): Promise<unknown>
  status(taskId: string, targetId: string): Promise<unknown>
}

// Drivable browser (docs/panes.md): CDP over the task's preview webview.
export type BrowserBridge = {
  navigate(taskId: string, url: string): Promise<unknown>
  snapshot(taskId: string): Promise<unknown>
  click(taskId: string, ref: string): Promise<unknown>
  fill(taskId: string, ref: string, text: string): Promise<unknown>
  screenshot(taskId: string): Promise<unknown>
  console(taskId: string): Promise<unknown>
}

const bridges: { notes: NotesBridge | null; memory: MemoryBridge | null; run: RunBridge | null; browser: BrowserBridge | null } = {
  notes: null,
  memory: null,
  run: null,
  browser: null,
}

export const setNotesBridge = (b: NotesBridge | null): void => void (bridges.notes = b)
export const setMemoryBridge = (b: MemoryBridge | null): void => void (bridges.memory = b)
export const setRunBridge = (b: RunBridge | null): void => void (bridges.run = b)
export const setBrowserBridge = (b: BrowserBridge | null): void => void (bridges.browser = b)

// ─── Typed errors (docs/api-reference.md): domain failures are NOT 503s ─────────────────────────

// A bridge implementation throws HarnessError to classify a failure; anything else it throws is
// 'failed' (or the route's declared errorKind). 'unavailable' is reserved for the missing-bridge
// case (dev:node, or main not wired yet).
export type HarnessErrorKind = 'unavailable' | 'not_found' | 'bad_request' | 'failed'

export class HarnessError extends Error {
  constructor(
    public readonly kind: Exclude<HarnessErrorKind, 'unavailable'>,
    message: string,
  ) {
    super(message)
    this.name = 'HarnessError'
  }
}

const STATUS: Record<HarnessErrorKind, 503 | 404 | 400 | 500> = { unavailable: 503, not_found: 404, bad_request: 400, failed: 500 }

// The one route body (previously repeated eighteen times): resolve the domain bridge, run the
// call, JSON the data; map a missing bridge to 503 and thrown errors to their kind's status.
// `errorKind` classifies untyped throws for routes whose failures have one obvious meaning
// (e.g. a notes read that throws is a missing note).
async function respond<B>(c: Context<AppEnv>, bridge: B | null, fn: (b: B) => Promise<unknown>, opts?: { errorKind?: HarnessError['kind'] }): Promise<Response> {
  if (!bridge) return respondError(c, 503, 'bridge-unavailable')
  try {
    return c.json(await fn(bridge))
  } catch (e) {
    // The former `kind` discriminator becomes the machine `error` code; the human/upstream
    // message rides in `detail` (docs/api-reference.md §error-codes).
    const kind: HarnessErrorKind = e instanceof HarnessError ? e.kind : (opts?.errorKind ?? 'failed')
    const message = e instanceof Error ? e.message : 'harness call failed'
    return respondError(c, STATUS[kind], kind, [message])
  }
}

// Auth is enforced globally by requireUser in createApp() (docs/next/security.md §3); harness
// keeps no inline guard. Internal-token callers pass the same gate (they resolve a principal).
export const harness = new Hono<AppEnv>()
  .get('/:id/notes', (c) => respond(c, bridges.notes, (b) => b.list(c.req.param('id'))))
  .get('/:id/notes/:slug', (c) => respond(c, bridges.notes, (b) => b.read(c.req.param('id'), c.req.param('slug')), { errorKind: 'not_found' }))
  .put('/:id/notes/:slug', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { body?: string; sessionId?: string }
    if (typeof body.body !== 'string') return respondError(c, 400, 'bad_request')
    return respond(c, bridges.notes, async (b) => {
      await b.write(c.req.param('id'), c.req.param('slug'), body.body!, body.sessionId)
      return { ok: true }
    })
  })
  .post('/:id/notes/:slug/append', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; sessionId?: string }
    if (!body.text) return respondError(c, 400, 'bad_request')
    return respond(c, bridges.notes, async (b) => {
      await b.append(c.req.param('id'), c.req.param('slug'), body.text!, body.sessionId)
      return { ok: true }
    })
  })
  .get('/:id/memory', (c) => {
    const q = c.req.query('q')
    const type = c.req.query('type')
    return respond(c, bridges.memory, (b) => (q ? b.search(c.req.param('id'), q, type) : b.list(c.req.param('id'), type)))
  })
  .get('/:id/memory/:name', (c) =>
    respond(c, bridges.memory, async (b) => {
      const memory = await b.get(c.req.param('id'), c.req.param('name'))
      if (!memory) throw new HarnessError('not_found', 'not_found')
      return memory
    }),
  )
  .post('/:id/memory/propose', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; type?: string; description?: string; body?: string; sessionId?: string }
    if (!body.name || !body.type || !body.description) return respondError(c, 400, 'bad_request')
    return respond(
      c,
      bridges.memory,
      async (b) => ({
        ok: true,
        proposal: await b.propose(c.req.param('id'), {
          name: body.name!,
          type: body.type!,
          description: body.description!,
          body: body.body ?? '',
          originSessionId: body.sessionId,
        }),
      }),
      // Propose validation (bad name/type) throws plain Errors from the store — they're the
      // caller's fault, not a server fault.
      { errorKind: 'bad_request' },
    )
  })
  .get('/:id/run', (c) => respond(c, bridges.run, (b) => b.targets(c.req.param('id'))))
  .post('/:id/run/:target/start', (c) => respond(c, bridges.run, (b) => b.start(c.req.param('id'), c.req.param('target'))))
  .post('/:id/run/:target/stop', (c) => respond(c, bridges.run, (b) => b.stop(c.req.param('id'), c.req.param('target'))))
  .post('/:id/run/:target/restart', (c) => respond(c, bridges.run, (b) => b.restart(c.req.param('id'), c.req.param('target'))))
  .get('/:id/run/:target/status', (c) => respond(c, bridges.run, (b) => b.status(c.req.param('id'), c.req.param('target'))))
  .post('/:id/browser/navigate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string }
    if (!body.url || typeof body.url !== 'string') return respondError(c, 400, 'bad_request')
    return respond(c, bridges.browser, (b) => b.navigate(c.req.param('id'), body.url!))
  })
  .get('/:id/browser/snapshot', (c) => respond(c, bridges.browser, (b) => b.snapshot(c.req.param('id'))))
  .post('/:id/browser/click', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ref?: string }
    if (!body.ref) return respondError(c, 400, 'bad_request')
    return respond(c, bridges.browser, (b) => b.click(c.req.param('id'), body.ref!))
  })
  .post('/:id/browser/fill', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ref?: string; text?: string }
    if (!body.ref || typeof body.text !== 'string') return respondError(c, 400, 'bad_request')
    return respond(c, bridges.browser, (b) => b.fill(c.req.param('id'), body.ref!, body.text!))
  })
  .get('/:id/browser/screenshot', (c) => respond(c, bridges.browser, (b) => b.screenshot(c.req.param('id'))))
  .get('/:id/browser/console', (c) => respond(c, bridges.browser, (b) => b.console(c.req.param('id'))))
