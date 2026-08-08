import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { NodePluginState } from '@acorn/protocol/api.ts'
import type { AppEnv } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import type { PluginRosterEntry } from '../plugin/host'
import { plugins, setPluginsBridge } from './plugins'

const ROSTER: PluginRosterEntry[] = [
  { name: 'github', required: false, disabled: false },
  { name: 'terminal', required: true, disabled: false },
  { name: 'docker', required: false, disabled: false },
  { name: 'rollbar', required: false, disabled: true },
]

// The bridge the composition roots fill (apps/node's service/runtime.ts and server/standalone.ts). The
// roster is the RUNNING process's view and never changes here; `disabled` is the persisted list, which a
// PUT does change — that gap is the whole reason `restartRequired` exists.
const wire = (initial: readonly string[]) => {
  let saved = [...initial]
  setPluginsBridge({
    roster: () => ROSTER,
    disabled: () => saved,
    setDisabled: (names) => void (saved = [...names]),
  })
  return () => saved
}

const request = (method: string, body?: unknown) =>
  new Request('http://acorn.test/v2/core/plugins', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const app = (principal: AppEnv['Variables']['principal']) => {
  const hono = new Hono<AppEnv>()
  hono.use('/v2/*', async (c, next) => {
    c.set('principal', principal)
    await next()
  })
  return hono.route('/v2/core/plugins', plugins)
}

const asDevice = () => app({ kind: 'device', userId: 'james', deviceId: 'd1' })
const asTaskAgent = () => app({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' })

afterEach(() => setPluginsBridge(null))

describe('GET /v2/core/plugins', () => {
  it('503s with no bridge, so an unwired node says so instead of answering an empty roster', async () => {
    setPluginsBridge(null)
    const res = await asDevice().fetch(request('GET'))
    expect(res.status).toBe(503)
  })

  it('reports the running set and the pending set separately', async () => {
    // rollbar is disabled and NOT running (the file said so at boot); docker was just turned off and is
    // still running until the restart. Both rows are needed: the page renders one checkbox and one
    // "restart to apply" banner, and collapsing them would either lie about the checkbox or the banner.
    wire(['rollbar', 'docker'])
    const res = await asDevice().fetch(request('GET'))
    expect(res.status).toBe(200)
    const state = (await res.json()) as NodePluginState
    expect(state.plugins).toEqual([
      { name: 'github', required: false, disabled: false, running: true },
      { name: 'terminal', required: true, disabled: false, running: true },
      { name: 'docker', required: false, disabled: true, running: true },
      { name: 'rollbar', required: false, disabled: true, running: false },
    ])
    expect(state.restartRequired).toBe(true)
  })

  it('reports restartRequired false when the file and the process agree', async () => {
    wire(['rollbar'])
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.map((row) => [row.name, row.disabled, row.running])).toEqual([
      ['github', false, true],
      ['terminal', false, true],
      ['docker', false, true],
      ['rollbar', true, false],
    ])
    expect(state.restartRequired).toBe(false)
  })

  it('never reports a required plugin as disabled, even if the file names it', async () => {
    // A stale file from a build where the plugin was optional, or a hand-edit. The host ignores the flag
    // for a required plugin, so the API has to as well or the checkbox would show off while it runs.
    // `rollbar` stays in the list so the fixture is self-consistent — the roster says it was disabled at
    // boot, and a file that no longer named it would legitimately mean "restart to bring it back".
    wire(['terminal', 'rollbar'])
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.filter((row) => row.disabled).map((row) => row.name)).toEqual(['rollbar'])
    expect(state.restartRequired).toBe(false)
  })

  it('reports restartRequired for a plugin turned back ON but not yet loaded', async () => {
    // The other direction, which a "did anything get disabled?" check would miss: rollbar is off in the
    // running process and no longer in the file, so it comes back at the next start.
    wire([])
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.filter((row) => row.disabled)).toEqual([])
    expect(state.restartRequired).toBe(true)
  })
})

describe('PUT /v2/core/plugins', () => {
  it('persists the list and answers the new state', async () => {
    const saved = wire([])
    const res = await asDevice().fetch(request('PUT', { disabled: ['docker'] }))
    expect(res.status).toBe(200)
    expect(saved()).toEqual(['docker'])
    const state = (await res.json()) as NodePluginState
    expect(state.plugins.find((row) => row.name === 'docker')).toEqual({ name: 'docker', required: false, disabled: true, running: true })
    expect(state.restartRequired).toBe(true)
  })

  it('rejects an unknown plugin name rather than silently dropping it', async () => {
    const saved = wire([])
    const res = await asDevice().fetch(request('PUT', { disabled: ['nope'] }))
    expect(res.status).toBe(400)
    expect(saved()).toEqual([])
  })

  it('rejects a required plugin rather than silently ignoring it', async () => {
    // Silently filtering would leave the owner staring at a checkbox that will not stick, with nothing
    // said. The client already knows which rows are not togglable, so a request naming one is a bug.
    const saved = wire([])
    const res = await asDevice().fetch(request('PUT', { disabled: ['terminal'] }))
    expect(res.status).toBe(400)
    expect(saved()).toEqual([])
  })

  it('rejects a malformed body', async () => {
    wire([])
    for (const body of [{}, { disabled: 'docker' }, { disabled: [''] }, { disabled: ['docker'], extra: 1 }]) {
      expect((await asDevice().fetch(request('PUT', body))).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('writes nothing when there is no bridge', async () => {
    setPluginsBridge(null)
    expect((await asDevice().fetch(request('PUT', { disabled: ['docker'] }))).status).toBe(503)
  })
})

describe('the device gate over /v2/core/plugins', () => {
  // The gate itself is mounted in server/index.ts (`.use('/v2/core/plugins', requireDevice)`), so this
  // asserts the middleware's verdict on this path rather than re-mounting the router: an agent-spawned
  // child must not be able to enumerate the node's surface, nor disable the plugin whose gate it stands
  // behind and get a different node on the next restart.
  const gated = (principal: AppEnv['Variables']['principal']) => {
    const hono = new Hono<AppEnv>()
    hono.use('/v2/*', async (c, next) => {
      c.set('principal', principal)
      await next()
    })
    hono.use('/v2/core/plugins', requireDevice)
    return hono.route('/v2/core/plugins', plugins)
  }

  it('403s a task-scoped agent on both verbs', async () => {
    wire([])
    for (const method of ['GET', 'PUT']) {
      const res = await gated({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' }).fetch(
        request(method, method === 'PUT' ? { disabled: [] } : undefined),
      )
      expect(res.status, method).toBe(403)
    }
    // And the ungated router would have answered — so the 403 is the gate, not the handler.
    expect((await asTaskAgent().fetch(request('GET'))).status).toBe(200)
  })

  it('lets a device through', async () => {
    wire([])
    expect((await gated({ kind: 'device', userId: 'james', deviceId: 'd1' }).fetch(request('GET'))).status).toBe(200)
  })
})
