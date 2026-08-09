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
  contributions: { frames: [], sources: [], slots: [], palette: [], attention: [], nodeStats: [] },
  client: { hash: 'a'.repeat(64), bytes: 12 },
  hasNode: true,
  ...over,
})

type WireOptions = {
  installed?: InstalledPluginInfo[]
  // What the process actually loaded. Defaults to "whatever is on disk, at that version", which is the
  // steady state — a test says otherwise only when it is about the gap between the two.
  booted?: { id: string; version: string }[]
  bundles?: Record<string, string>
  roster?: PluginRosterEntry[]
}

// The bridge the composition roots fill (apps/node's service/runtime.ts and server/standalone.ts). The
// roster is the RUNNING process's view and never changes here; `disabled` is the persisted list, which a
// PUT does change — that gap is the whole reason `restartRequired` exists.
const wire = (initial: readonly string[], options: WireOptions = {}) => {
  let saved = [...initial]
  const installed = options.installed ?? []
  const calls: { install: unknown[]; update: unknown[]; uninstall: unknown[] } = { install: [], update: [], uninstall: [] }
  setPluginsBridge({
    roster: () => options.roster ?? ROSTER,
    installed: () => installed,
    booted: () => options.booted ?? installed.map((entry) => ({ id: entry.id, version: entry.version })),
    clientBundle: async (id) => {
      const source = options.bundles?.[id]
      if (source === undefined) return null
      const bytes = new TextEncoder().encode(source)
      return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
    },
    disabled: () => saved,
    setDisabled: (names) => void (saved = [...names]),
    install: async (source, opts) => {
      calls.install.push({ source, opts })
      if ('url' in source && source.url === 'bad') throw new Error('That archive has no acorn-plugin.json at its root.')
      return { id: 'ntfy', version: '1.0.0', state: 'installed-restart-required' }
    },
    update: async (id, opts) => {
      calls.update.push({ id, opts })
      return { id, fromVersion: '1.0.0', toVersion: '1.1.0', state: 'installed-restart-required' }
    },
    uninstall: (id, opts) => {
      calls.uninstall.push({ id, opts })
      return { restartRequired: true, dataPurged: opts.purgeData === true }
    },
  })
  return Object.assign(() => saved, { calls })
}

const KEY = { 'idempotency-key': '11111111-2222-3333-4444-555555555555' }

const request = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('http://acorn.test/v2/core/plugins', {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const at = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://acorn.test/v2/core/plugins${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
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
    wire([], { roster: [{ name: 'ntfy', required: false, disabled: false, state: 'failed', failedAt: 1_700_000_000_000 }] })
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
      // Passed through untouched for the device to register surfaces from
      // (docs/third-party/phase-3-sandboxed-ui.md); the node neither reads nor renders it.
      contributions: { frames: [], sources: [], slots: [], palette: [], attention: [], nodeStats: [] },
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
      installed: {
        version: '1.0.0',
        apiVersion: '1',
        permissions: NO_PERMISSIONS,
        contributions: { frames: [], sources: [], slots: [], palette: [], attention: [], nodeStats: [] },
        client: { hash: 'a'.repeat(64), bytes: 12 },
      },
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

  it('403s a task-scoped agent on install, update and uninstall', async () => {
    // The sharpest case in this file. A prompt-injected agent that could POST here would make the node
    // fetch and run arbitrary code with the node's own access (docs/third-party/node-security.md).
    wire([], { installed: [installedEntry('sparkline')] })
    const agent = gated({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' })
    const attempts = [
      at('/install', 'POST', { source: { url: 'https://example.test/p.tgz' } }, KEY),
      at('/sparkline/update', 'POST', {}, KEY),
      at('/sparkline', 'DELETE', {}, KEY),
    ]
    for (const attempt of attempts) expect((await agent.fetch(attempt.clone())).status, attempt.url).toBe(403)
    // And the ungated router would have answered — so the 403 is the gate, not the handler.
    for (const attempt of attempts) expect((await asTaskAgent().fetch(attempt)).status, attempt.url).toBe(200)
  })
})

describe('the pending-restart state', () => {
  const installedNtfy = (version: string) => installedEntry('ntfy', { version })

  it('reports a freshly installed plugin as pending, not running', async () => {
    // On disk, never loaded: the whole point of the install route is that it cannot make this true in
    // the running process, so the roster has to say so rather than claim the plugin is live.
    wire([], { installed: [installedNtfy('1.0.0')], booted: [] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.find((row) => row.name === 'ntfy')).toMatchObject({ running: false, state: 'pending-restart' })
    expect(state.restartRequired).toBe(true)
  })

  it('reports a plugin whose directory changed version under it as pending', async () => {
    wire([], {
      roster: [{ name: 'ntfy', required: false, disabled: false, state: 'active' }],
      installed: [installedNtfy('1.1.0')],
      booted: [{ id: 'ntfy', version: '1.0.0' }],
    })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    // Still running — the OLD code. That is exactly what the banner is for.
    expect(state.plugins[0]).toMatchObject({ running: true, state: 'pending-restart' })
    expect(state.restartRequired).toBe(true)
  })

  it('reports an uninstalled plugin that is still serving as pending', async () => {
    wire([], { roster: [{ name: 'ntfy', required: false, disabled: false, state: 'active' }], installed: [], booted: [{ id: 'ntfy', version: '1.0.0' }] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins[0]).toMatchObject({ running: true, state: 'pending-restart' })
    expect(state.restartRequired).toBe(true)
  })

  it('leaves a client-only package alone, because no restart would change anything', async () => {
    // Its contributions are all client-side and the client re-registers on a roster change. Raising a
    // restart banner it can never clear would train the owner to ignore the banner.
    // `rollbar` is disabled in the default roster, so the file has to name it for the toggle half of
    // restartRequired to be quiet and this assertion to be about the install half.
    wire(['rollbar'], { installed: [installedEntry('sparkline', { hasNode: false })], booted: [] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.find((row) => row.name === 'sparkline')).toMatchObject({ running: true, state: 'active' })
    expect(state.restartRequired).toBe(false)
  })

  it('does not turn a failed plugin into a pending one', async () => {
    // A restart cannot fix an init that throws, so 'failed' outranks 'pending-restart' even though the
    // package is on disk and unloaded — which is the shape a broken install leaves behind.
    wire([], {
      roster: [{ name: 'ntfy', required: false, disabled: false, state: 'failed', failedAt: 1 }],
      installed: [installedNtfy('1.0.0')],
      booted: [],
    })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins[0]).toMatchObject({ state: 'failed' })
  })

  it('carries the source and install time through to the row', async () => {
    wire([], { installed: [installedEntry('ntfy', { source: 'github:acme/ntfy@v1.0.0', installedAt: 1_700_000_000_000 })] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.find((row) => row.name === 'ntfy')?.installed).toMatchObject({
      source: 'github:acme/ntfy@v1.0.0',
      installedAt: 1_700_000_000_000,
    })
  })
})

describe('the install, update and uninstall routes', () => {
  it('installs from a source and hands the installer the parsed form', async () => {
    const bridge = wire([])
    const res = await asDevice().fetch(at('/install', 'POST', { source: { github: 'acme/ntfy', tag: 'v1.0.0' } }, KEY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'ntfy', version: '1.0.0', state: 'installed-restart-required' })
    expect(bridge.calls.install).toEqual([{ source: { github: 'acme/ntfy', tag: 'v1.0.0' }, opts: { allowDowngrade: undefined } }])
  })

  it('demands an Idempotency-Key on every mutation', async () => {
    // A retried install is the case this exists for: the first attempt may have finished on the node and
    // died on the wire, and a second unkeyed POST would fetch and place the package all over again.
    wire([], { installed: [installedEntry('ntfy')] })
    for (const attempt of [
      at('/install', 'POST', { source: { url: 'https://example.test/p.tgz' } }),
      at('/ntfy/update', 'POST', {}),
      at('/ntfy', 'DELETE', {}),
    ]) {
      expect((await asDevice().fetch(attempt)).status, attempt.url).toBe(400)
    }
  })

  it('rejects a source naming two forms at once rather than picking one', async () => {
    wire([])
    const res = await asDevice().fetch(at('/install', 'POST', { source: { github: 'acme/ntfy', npm: 'acorn-ntfy' } }, KEY))
    expect(res.status).toBe(400)
  })

  it('turns an installer refusal into a 400 carrying its sentence', async () => {
    // Everything the installer refuses is operator-fixable — a bad manifest, an unreachable release, a
    // downgrade — so the owner needs the wording, not a 500.
    wire([])
    const res = await asDevice().fetch(at('/install', 'POST', { source: { url: 'bad' } }, KEY))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('acorn-plugin.json')
  })

  it('updates by id, reporting both versions', async () => {
    const bridge = wire([], { installed: [installedEntry('ntfy')] })
    const res = await asDevice().fetch(at('/ntfy/update', 'POST', { allowDowngrade: true }, KEY))
    expect(await res.json()).toMatchObject({ id: 'ntfy', fromVersion: '1.0.0', toVersion: '1.1.0' })
    expect(bridge.calls.update).toEqual([{ id: 'ntfy', opts: { allowDowngrade: true } }])
  })

  it('uninstalls, defaulting to keeping the plugin\'s data', async () => {
    const bridge = wire([], { installed: [installedEntry('ntfy')] })
    const res = await asDevice().fetch(at('/ntfy', 'DELETE', {}, KEY))
    expect(await res.json()).toEqual({ restartRequired: true, dataPurged: false })
    expect(bridge.calls.uninstall).toEqual([{ id: 'ntfy', opts: { purgeData: undefined } }])
  })

  it('purges the data only when the request says so', async () => {
    const bridge = wire([], { installed: [installedEntry('ntfy')] })
    const res = await asDevice().fetch(at('/ntfy', 'DELETE', { purgeData: true }, KEY))
    expect(await res.json()).toEqual({ restartRequired: true, dataPurged: true })
    expect(bridge.calls.uninstall).toEqual([{ id: 'ntfy', opts: { purgeData: true } }])
  })

  it('503s every mutation when there is no bridge', async () => {
    setPluginsBridge(null)
    for (const attempt of [
      at('/install', 'POST', { source: { url: 'https://example.test/p.tgz' } }, KEY),
      at('/ntfy/update', 'POST', {}, KEY),
      at('/ntfy', 'DELETE', {}, KEY),
    ]) {
      expect((await asDevice().fetch(attempt)).status, attempt.url).toBe(503)
    }
  })
})
