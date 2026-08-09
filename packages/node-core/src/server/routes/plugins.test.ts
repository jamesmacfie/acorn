import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { NodePluginState } from '@acorn/protocol/api.ts'
import type { InstalledPluginInfo } from '../../main/pluginLoader'
import type { AppEnv } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import type { PluginRosterEntry } from '../plugin/host'
import { plugins, setPluginsBridge } from './plugins'

const ROSTER: PluginRosterEntry[] = [
  { name: 'github', required: false, disabled: false, state: 'active' },
  { name: 'terminal', required: true, disabled: false, state: 'active' },
  { name: 'docker', required: false, disabled: false, state: 'active' },
  { name: 'rollbar', required: false, disabled: true, state: 'disabled' },
]

const NO_PERMISSIONS = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } }
const installedEntry = (id: string, over: Partial<InstalledPluginInfo> = {}): InstalledPluginInfo => ({
  id,
  version: '1.0.0',
  apiVersion: '1',
  permissions: NO_PERMISSIONS,
  client: { hash: 'a'.repeat(64), bytes: 12 },
  ...over,
})

// The bridge the composition roots fill (apps/node's service/runtime.ts and server/standalone.ts). The
// roster is the RUNNING process's view and never changes here; `disabled` is the persisted list, which a
// PUT does change — that gap is the whole reason `restartRequired` exists.
const wire = (initial: readonly string[], options: { installed?: InstalledPluginInfo[]; bundles?: Record<string, string> } = {}) => {
  let saved = [...initial]
  setPluginsBridge({
    roster: () => ROSTER,
    installed: () => options.installed ?? [],
    clientBundle: async (id) => {
      const source = options.bundles?.[id]
      if (source === undefined) return null
      const bytes = new TextEncoder().encode(source)
      return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
    },
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

const bundleRequest = (id: string, headers?: Record<string, string>) =>
  new Request(`http://acorn.test/v2/core/plugins/${id}/client.js`, { headers })

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
      { name: 'github', required: false, disabled: false, running: true, state: 'active' },
      { name: 'terminal', required: true, disabled: false, running: true, state: 'active' },
      { name: 'docker', required: false, disabled: true, running: true, state: 'active' },
      { name: 'rollbar', required: false, disabled: true, running: false, state: 'disabled' },
    ])
    expect(state.restartRequired).toBe(true)
  })

  it('passes a failed plugin through without demanding a restart a restart cannot deliver', async () => {
    // A loaded plugin whose init threw. It is not disabled and its contributions are gone, but the
    // owner's list and the running set still agree — so the restart banner must stay down, and the
    // client learns about the failure from `state` and the attention inbox instead.
    setPluginsBridge({
      roster: () => [{ name: 'ntfy', required: false, disabled: false, state: 'failed', failedAt: 1_700_000_000_000 }],
      installed: () => [],
      clientBundle: async () => null,
      disabled: () => [],
      setDisabled: () => {},
    })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins).toEqual([
      { name: 'ntfy', required: false, disabled: false, running: true, state: 'failed', failedAt: 1_700_000_000_000 },
    ])
    expect(state.restartRequired).toBe(false)
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

describe('installed packages in the roster (docs/third-party/phase-2-distribution-trust.md)', () => {
  it('attaches the manifest block to a plugin that came off disk, and to nothing else', async () => {
    wire([], { installed: [installedEntry('rollbar', { version: '2.1.0' })] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    const rows = new Map(state.plugins.map((row) => [row.name, row]))
    expect(rows.get('rollbar')?.installed).toEqual({
      version: '2.1.0',
      apiVersion: '1',
      permissions: NO_PERMISSIONS,
      client: { hash: 'a'.repeat(64), bytes: 12 },
    })
    // The client's "is this third-party?" answer, so a built-in must not carry the block at all.
    expect(rows.get('github')?.installed).toBeUndefined()
    expect(rows.get('terminal')?.installed).toBeUndefined()
  })

  it('gives a client-only package a row the plugin host never produced', async () => {
    // No node entrypoint, so it never entered initPlugins and has no roster entry — but its bundle is
    // exactly what this phase distributes, so the device has to be told about it.
    // ['rollbar'] so the shared roster fixture is itself quiet: it was disabled at boot, so naming it
    // keeps the file and the process in agreement and leaves restartRequired to say something about
    // the row under test.
    wire(['rollbar'], { installed: [installedEntry('sparkline')] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.at(-1)).toEqual({
      name: 'sparkline',
      required: false,
      disabled: false,
      running: true,
      state: 'active',
      installed: { version: '1.0.0', apiVersion: '1', permissions: NO_PERMISSIONS, client: { hash: 'a'.repeat(64), bytes: 12 } },
    })
    expect(state.restartRequired).toBe(false)
  })

  it('never asks for a restart to apply a client-only toggle', async () => {
    // Its contributions are all client-side and the client re-initialises its plugin host on a roster
    // change, so `running` tracks `disabled` and the banner stays down. A restart would change nothing.
    const saved = wire(['rollbar'], { installed: [installedEntry('sparkline')] })
    const res = await asDevice().fetch(request('PUT', { disabled: ['rollbar', 'sparkline'] }))
    expect(res.status).toBe(200)
    expect(saved()).toEqual(['rollbar', 'sparkline'])
    const state = (await res.json()) as NodePluginState
    expect(state.plugins.at(-1)).toMatchObject({ name: 'sparkline', disabled: true, running: false, state: 'disabled' })
    expect(state.restartRequired).toBe(false)
  })
})

describe('GET /v2/core/plugins/:id/client.js', () => {
  it('serves the bytes with the hash as its ETag', async () => {
    wire([], { installed: [installedEntry('sparkline')], bundles: { sparkline: 'export default {}' } })
    const res = await asDevice().fetch(bundleRequest('sparkline'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await res.text()).toBe('export default {}')
    const expected = createHash('sha256').update(new TextEncoder().encode('export default {}')).digest('hex')
    expect(res.headers.get('etag')).toBe(`"${expected}"`)
  })

  it('answers 304 to a device that already holds those bytes', async () => {
    wire([], { installed: [installedEntry('sparkline')], bundles: { sparkline: 'export default {}' } })
    const expected = createHash('sha256').update(new TextEncoder().encode('export default {}')).digest('hex')
    const res = await asDevice().fetch(bundleRequest('sparkline', { 'if-none-match': `"${expected}"` }))
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
  })

  it('404s a plugin with no client half, and 503s with no bridge', async () => {
    wire([], { installed: [installedEntry('rollbar', { client: null })] })
    expect((await asDevice().fetch(bundleRequest('rollbar'))).status).toBe(404)
    expect((await asDevice().fetch(bundleRequest('nope'))).status).toBe(404)
    setPluginsBridge(null)
    expect((await asDevice().fetch(bundleRequest('rollbar'))).status).toBe(503)
  })
})

describe('PUT /v2/core/plugins', () => {
  it('persists the list and answers the new state', async () => {
    const saved = wire([])
    const res = await asDevice().fetch(request('PUT', { disabled: ['docker'] }))
    expect(res.status).toBe(200)
    expect(saved()).toEqual(['docker'])
    const state = (await res.json()) as NodePluginState
    expect(state.plugins.find((row) => row.name === 'docker')).toEqual({ name: 'docker', required: false, disabled: true, running: true, state: 'active' })
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
    // The second form, exactly as server/index.ts mounts it. It is what keeps a route added under the
    // prefix — the bundle route below — from arriving ungated.
    hono.use('/v2/core/plugins/*', requireDevice)
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

  it('403s a task-scoped agent on the bundle bytes', async () => {
    // Which code a device runs is an owner decision. A task-scoped token belongs to an agent running
    // INSIDE that decision's outcome, so it must not be able to pull a plugin's client bundle.
    wire([], { installed: [installedEntry('sparkline')], bundles: { sparkline: 'export default {}' } })
    const res = await gated({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' }).fetch(bundleRequest('sparkline'))
    expect(res.status).toBe(403)
    expect((await asTaskAgent().fetch(bundleRequest('sparkline'))).status).toBe(200)
  })

  it('lets a device through', async () => {
    wire([])
    expect((await gated({ kind: 'device', userId: 'james', deviceId: 'd1' }).fetch(request('GET'))).status).toBe(200)
  })
})
