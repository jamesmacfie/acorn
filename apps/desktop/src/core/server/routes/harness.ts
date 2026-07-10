import { Hono, type Context } from 'hono'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Run-target routes (docs/workflows.md §2): the RENDERER's run surface — the run pane and preview home
// call these (client/features/tasks/runClient.ts). The agent-facing run_* verbs are the same
// runtime, projected instead through the agent-tool registry (main/agentToolsWiring.ts); notes,
// memory and the drivable browser moved there wholesale in the agent-tool registry. What's left here is one bridge:
// the RuntimeService, injected by main/harnessWiring.ts so the routes stay testable and dev:node
// (no Electron) degrades to a clean 503.

export type RunBridge = {
  targets(taskId: string): Promise<unknown>
  start(taskId: string, targetId: string): Promise<unknown>
  stop(taskId: string, targetId: string): Promise<unknown>
  restart(taskId: string, targetId: string): Promise<unknown>
  status(taskId: string, targetId: string): Promise<unknown>
  // The default target's URL for the browser/preview home. Renderer surface only.
  defaultUrl(taskId: string): Promise<string | undefined>
}

const bridges: { run: RunBridge | null } = { run: null }
export const setRunBridge = (b: RunBridge | null): void => void (bridges.run = b)

// ─── Typed errors (docs/api-reference.md): domain failures are NOT 503s ─────────────────────────

export type HarnessErrorKind = 'unavailable' | 'not_found' | 'bad_request' | 'needs-trust' | 'failed'

export class HarnessError extends Error {
  constructor(
    public readonly kind: Exclude<HarnessErrorKind, 'unavailable'>,
    message: string,
  ) {
    super(message)
    this.name = 'HarnessError'
  }
}

const STATUS: Record<HarnessErrorKind, 503 | 404 | 400 | 409 | 500> = { unavailable: 503, not_found: 404, bad_request: 400, 'needs-trust': 409, failed: 500 }

// Resolve the run bridge, run the call, JSON the data; a missing bridge → 503, thrown errors → their
// kind's status (untyped throws classify as 'failed', or the route's declared errorKind).
async function respond<B>(c: Context<AppEnv>, bridge: B | null, fn: (b: B) => Promise<unknown>, opts?: { errorKind?: HarnessError['kind'] }): Promise<Response> {
  if (!bridge) return respondError(c, 503, 'bridge-unavailable')
  try {
    return c.json(await fn(bridge))
  } catch (e) {
    const kind: HarnessErrorKind = e instanceof HarnessError
      ? e.kind
      : e && typeof e === 'object' && 'code' in e && e.code === 'needs-trust'
        ? 'needs-trust'
        : (opts?.errorKind ?? 'failed')
    const message = e instanceof Error ? e.message : 'harness call failed'
    return respondError(c, STATUS[kind], kind, [message])
  }
}

// Auth is enforced globally by requireUser in createApp() (docs/security.md §3).
export const harness = new Hono<AppEnv>()
  .get('/:id/run', (c) => respond(c, bridges.run, (b) => b.targets(c.req.param('id'))))
  // Static 'default-url' before the ':target' routes so it can't be shadowed by a target id.
  .get('/:id/run/default-url', (c) => respond(c, bridges.run, async (b) => ({ url: (await b.defaultUrl(c.req.param('id'))) ?? null })))
  .post('/:id/run/:target/start', (c) => respond(c, bridges.run, (b) => b.start(c.req.param('id'), c.req.param('target'))))
  .post('/:id/run/:target/stop', (c) => respond(c, bridges.run, (b) => b.stop(c.req.param('id'), c.req.param('target'))))
  .post('/:id/run/:target/restart', (c) => respond(c, bridges.run, (b) => b.restart(c.req.param('id'), c.req.param('target'))))
  .get('/:id/run/:target/status', (c) => respond(c, bridges.run, (b) => b.status(c.req.param('id'), c.req.param('target'))))
