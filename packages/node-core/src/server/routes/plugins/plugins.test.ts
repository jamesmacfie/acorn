import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { NodePluginState } from '@acorn/protocol/api.ts'
import type { ActivePluginSnapshot, InstalledPluginInfo, PluginLoadFailure } from '../../plugins/loader'
import type { AppEnv } from '../../middleware/auth'
import { requireDevice } from '../../middleware/requireUser'
import type { PluginRosterEntry } from '../../pluginHost/host'
import { setRouteTestCapability } from '../../bridge'
import { _resetPluginRequests, raisePluginRequest } from '../../agentTools/pluginRequests'
import { PLUGIN_STATE } from '../../pluginHost/state'
import { plugins } from './plugins'
import { testCliCommandDescriptor } from '../../../testkit/runtimeContributions'
import { memoryIdentityStore } from '../../activeIdentity'
import { idempotencyStore } from '../../auth/idempotency'
import { idempotency } from '../../middleware/idempotency'
import { makeTestDb, testEnv } from '../../../testkit/db'
import { schema } from '../../db'
import { registerRoute, removePluginRoutes } from '../registry'

const ROSTER: PluginRosterEntry[] = [
  { name: 'github', required: false, disabled: false, state: 'active' },
  { name: 'terminal', required: true, disabled: false, state: 'active' },
  { name: 'docker', required: false, disabled: false, state: 'active' },
  { name: 'rollbar', required: false, disabled: true, state: 'disabled' },
]

const NO_PERMISSIONS = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } }
const installedEntry = (id: string, over: Partial<InstalledPluginInfo> = {}): InstalledPluginInfo => ({
  id,
  label: `Plugin ${id}`,
  version: '1.0.0',
  apiVersion: '1',
  permissions: NO_PERMISSIONS,
  emits: [],
  contributions: { frames: [], remote: [], sources: [], slots: [], commands: [], keybindings: [], attention: [], nodeStats: [], contentLinks: [], agentContexts: [], refResolvers: [], routes: [], themes: [], styles: [], contextMenus: [], extensionPoints: [], extensions: [], schedules: [], taskChecks: [], auditActions: [], harnesses: [], customAgents: [], agentTools: [], contextSections: [], cliCommands: [] },
  client: { hash: 'a'.repeat(64), bytes: 12 },
  hasNode: true,
  ...over,
})
const activeSnapshot = (id: string, version: string): ActivePluginSnapshot => {
  const { id: _id, label: _label, hasNode: _hasNode, source: _source, installedAt: _installedAt, bundled: _bundled, ...identity } = installedEntry(id, { version })
  return { id, identity: { ...identity, activation: 'node' }, bundle: null }
}

type WireOptions = {
  installed?: InstalledPluginInfo[]
  // What the process loaded, defaulting to "on disk, at that version". A case overrides this only
  // when it tests the gap between what is on disk and what is running.
  booted?: { id: string; version: string }[]
  bundles?: Record<string, string>
  bundlesByHash?: Record<string, string>
  activeSnapshots?: ActivePluginSnapshot[]
  roster?: PluginRosterEntry[]
  // Why a package on disk produced no plugin at this boot. Defaults to none, which is every test here
  // except the one about a package that would not load.
  // Unstamped. The helper adds the clock, as in pluginState.test.ts.
  loadFailures?: Omit<PluginLoadFailure, 'at'>[]
  pendingReview?: { reviewId: string; requestId: string; fingerprint: string; stagedAt: number }
}

// The bridge the composition roots fill (apps/node's service/runtime.ts and server/standalone.ts). The
// roster is the running process's view and never changes here. `disabled` is the persisted list, which
// a PUT does change. That gap is why `restartRequired` exists.
const wire = (initial: readonly string[], options: WireOptions = {}) => {
  let saved = [...initial]
  const installed = options.installed ?? []
  const calls: { install: unknown[]; update: unknown[]; uninstall: unknown[]; reload: unknown[]; approve: unknown[] } = { install: [], update: [], uninstall: [], reload: [], approve: [] }
  setRouteTestCapability(PLUGIN_STATE, {
    roster: () => options.roster ?? ROSTER,
    installed: () => installed,
    booted: () => options.activeSnapshots ?? (options.booted ?? installed.map((entry) => ({ id: entry.id, version: entry.version })))
      .map((entry) => activeSnapshot(entry.id, entry.version)),
    clientBundle: async (id, hash) => {
      const source = options.bundlesByHash?.[hash] ?? options.bundles?.[id]
      if (source === undefined) return null
      const bytes = new TextEncoder().encode(source)
      return { bytes, hash: createHash('sha256').update(bytes).digest('hex') }
    },
    disabled: () => saved,
    loadFailures: () => (options.loadFailures ?? []).map((failure) => ({ ...failure, at: 1_700_000_000_000 })),
    pendingReview: () => options.pendingReview ?? null,
    pendingReviewIds: () => options.pendingReview ? ['ntfy'] : [],
    approveReview: (id, reviewId, fingerprint) => {
      calls.approve.push({ id, reviewId, fingerprint })
      if (!options.pendingReview) throw new Error('not under test')
      return options.pendingReview
    },
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
    reload: async (id) => {
      calls.reload.push({ id })
      // The bridge's refusal for a name this node did not load from disk, which the route turns into a 400.
      if (id === 'terminal') throw new Error(`'terminal' is not a plugin this node loaded from disk.`)
      // 'broken' stands for a candidate whose init threw: a 200 reporting that the previous instance is
      // still serving.
      if (id === 'broken') return { id, version: '1.0.0', state: 'failed', reason: 'init exploded' }
      return { id, version: '1.1.0', state: 'reloaded' }
    },
  })
  return Object.assign(() => saved, { calls })
}

const KEY = { 'idempotency-key': '11111111-2222-3333-4444-555555555555' }

const request = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('http://acorn.test/v1/core/plugins', {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const at = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://acorn.test/v1/core/plugins${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const bundleRequest = (id: string, headers?: Record<string, string>) =>
  new Request(`http://acorn.test/v1/core/plugins/${id}/client.js`, { headers })

const app = (principal: AppEnv['Variables']['principal']) => {
  const hono = new Hono<AppEnv>()
  hono.use('/v1/*', async (c, next) => {
    c.set('principal', principal)
    await next()
  })
  return hono.route('/v1/core/plugins', plugins)
}

const asDevice = () => app({ kind: 'device', userId: 'james', deviceId: 'd1' })
const asTaskAgent = () => app({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' })

afterEach(() => setRouteTestCapability(PLUGIN_STATE, null))

describe('agent-requested staged review', () => {
  afterEach(() => _resetPluginRequests())

  it('binds the first install to the pending request and only clears its gate on the matching second approval', async () => {
    _resetPluginRequests()
    const source = { path: '/tmp/review-fixture' }
    const raised = raisePluginRequest({ taskId: 'task-1', action: 'install', source, dev: false })
    if (raised.state !== 'pending') throw new Error('expected pending request')
    const marker = { reviewId: '00000000-0000-4000-8000-000000000002', requestId: raised.request.requestId,
      fingerprint: 'a'.repeat(64), stagedAt: 1 }
    const state = wire([], { pendingReview: marker })
    const node = asDevice()

    const wrongSource = await node.request(at('/install', 'POST', {
      source: { path: '/tmp/other' }, reviewRequestId: marker.requestId,
    }, KEY))
    expect(wrongSource.status).toBe(400)
    const staged = await node.request(at('/install', 'POST', { source, reviewRequestId: marker.requestId }, KEY))
    expect(staged.status).toBe(200)
    expect(state.calls.install).toEqual([{ source, opts: { allowDowngrade: undefined, reviewRequestId: marker.requestId } }])

    const stale = await node.request(at('/ntfy/review', 'POST', { reviewId: marker.reviewId, fingerprint: 'b'.repeat(64), decision: 'approved' }, KEY))
    expect(stale.status).toBe(409)
    expect(state.calls.approve).toEqual([])
    const approved = await node.request(at('/ntfy/review', 'POST', { reviewId: marker.reviewId, fingerprint: marker.fingerprint, decision: 'approved' }, KEY))
    expect(approved.status).toBe(200)
    expect(state.calls.approve).toEqual([{ id: 'ntfy', reviewId: marker.reviewId, fingerprint: marker.fingerprint }])
    const collected = raisePluginRequest({ taskId: 'task-1', action: 'install', source, dev: false })
    expect(collected).toMatchObject({ state: 'decided', outcome: { decision: 'approved' } })
  })

  it('removes a rejected staged package and settles the agent request', async () => {
    _resetPluginRequests()
    const raised = raisePluginRequest({ taskId: 'task-1', action: 'update', pluginId: 'ntfy', dev: false })
    if (raised.state !== 'pending') throw new Error('expected pending request')
    const marker = { reviewId: '00000000-0000-4000-8000-000000000003', requestId: raised.request.requestId,
      fingerprint: 'c'.repeat(64), stagedAt: 1 }
    const state = wire([], { pendingReview: marker })
    const node = asDevice()
    const stage = await node.request(at('/ntfy/update', 'POST', { reviewRequestId: marker.requestId }, KEY))
    expect(stage.status).toBe(200)
    expect(state.calls.update).toEqual([{ id: 'ntfy', opts: { allowDowngrade: undefined, reviewRequestId: marker.requestId } }])
    const denied = await node.request(at('/ntfy/review', 'POST', { reviewId: marker.reviewId, fingerprint: marker.fingerprint, decision: 'denied' }, KEY))
    expect(denied.status).toBe(200)
    expect(state.calls.uninstall).toEqual([{ id: 'ntfy', opts: {} }])
    expect(raisePluginRequest({ taskId: 'task-1', action: 'update', pluginId: 'ntfy', dev: false })).toMatchObject({
      state: 'decided', outcome: { decision: 'denied' },
    })
  })
})

describe('loaded CLI command dispatch', () => {
  const read = testCliCommandDescriptor()
  const write = testCliCommandDescriptor({
    name: 'set', title: 'Set probe', summary: 'Replace one fixture value.',
    effects: 'Replaces the fixture value.', risk: 'write', route: { method: 'POST', path: '/cli/set' },
  })
  const snapshot = (version: string, commands = [read, write]) => {
    const entry = installedEntry('fixture', {
      version,
      permissions: { ...NO_PERMISSIONS, node: { ...NO_PERMISSIONS.node, core: ['tasks'] } },
      contributions: { ...installedEntry('fixture').contributions, cliCommands: commands },
    })
    const { id: _id, label: _label, hasNode: _hasNode, source: _source, installedAt: _installedAt, bundled: _bundled, ...identity } = entry
    return { id: 'fixture', identity: { ...identity, activation: 'node' as const }, bundle: null }
  }

  it('rechecks the active descriptor, rejects invalid input/output, and replays a keyed write', async () => {
    const database = makeTestDb()
    const active = [snapshot('1.0.0')]
    wire([], { roster: [{ name: 'fixture', required: false, disabled: false, state: 'active' }],
      installed: [installedEntry('fixture', { version: '2.0.0' })], activeSnapshots: active })
    let value = 'first'
    let writes = 0
    let malformed = false
    let sawBearer = false
    registerRoute({ plugin: 'fixture', prefix: '', fetch: async (request) => {
      sawBearer ||= request.headers.has('authorization')
      const input = await request.json() as { value?: string }
      if (new URL(request.url).pathname === '/cli/set') { writes++; value = input.value ?? 'set'; return Response.json({ value }) }
      return Response.json({ value: malformed ? 12 : value })
    } })
    const hono = new Hono<AppEnv>()
    let principal: AppEnv['Variables']['principal'] = { kind: 'device', userId: 'james', deviceId: 'd1' }
    hono.use('/v1/*', async (c, next) => { c.set('principal', principal); await next() })
    hono.use('/v1/*', idempotency)
    hono.use('/v1/core/plugins/*', requireDevice)
    hono.route('/v1/core/plugins', plugins)
    const env = testEnv({ NODE_ID: 'node-a', ACTIVE_IDENTITY: memoryIdentityStore('james'), DB: database.db, IDEMPOTENCY: idempotencyStore(database.db) })
    const call = (command: string, input: unknown, headers: Record<string, string> = {}) => hono.fetch(at(`/fixture/cli/${command}`, 'POST', { input }, headers), env)
    try {
      expect((await call('probe', { nodeId: 'wrong' })).status).toBe(400)
      expect((await call('probe', { nodeId: 'node-a', extra: true })).status).toBe(400)
      principal = { kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' }
      expect((await call('probe', { nodeId: 'node-a' })).status).toBe(403)
      principal = { kind: 'device', userId: 'james', deviceId: 'd1' }
      expect((await call('set', { nodeId: 'node-a' })).status).toBe(400)
      expect((await call('set', { nodeId: 'node-a' }, KEY)).status).toBe(200)
      expect((await call('set', { nodeId: 'node-a' }, KEY)).status).toBe(200)
      expect(writes).toBe(1)
      expect(sawBearer).toBe(false)
      malformed = true
      expect((await call('probe', { nodeId: 'node-a' })).status).toBe(502)
      malformed = false
      active[0] = snapshot('2.0.0', [read])
      expect((await call('set', { nodeId: 'node-a' }, { 'idempotency-key': '22222222-2222-4222-8222-222222222222' })).status).toBe(404)
      value = 'second'
      expect(((await (await call('probe', { nodeId: 'node-a' })).json()) as { result: { value: string } }).result.value).toBe('second')
      database.db.insert(schema.workspaces).values({ id: 'w1', name: 'One', createdAt: 1, updatedAt: 1 }).run()
      database.db.insert(schema.projects).values({ id: 'p1', name: 'One', workspaceId: 'w1', createdAt: 1, updatedAt: 1 }).run()
      database.db.insert(schema.tasks).values({ id: 't1', title: 'One', origin: 'local', projectId: 'p1', status: 'active', createdAt: 1, updatedAt: 1 }).run()
      const scoped = testCliCommandDescriptor({ scope: 'task', inputSchema: { type: 'object', properties: {
        nodeId: { type: 'string' }, taskId: { type: 'string' }, projectId: { type: 'string' }, workspaceId: { type: 'string' },
      }, required: ['nodeId', 'taskId'], additionalProperties: false } })
      active[0] = snapshot('3.0.0', [scoped])
      expect((await call('probe', { nodeId: 'node-a' })).status).toBe(400)
      expect((await call('probe', { nodeId: 'node-a', taskId: 'missing' })).status).toBe(404)
      expect((await call('probe', { nodeId: 'node-a', taskId: 't1', projectId: 'other' })).status).toBe(404)
      expect((await call('probe', { nodeId: 'node-a', taskId: 't1', workspaceId: 'other' })).status).toBe(404)
      expect((await call('probe', { nodeId: 'node-a', taskId: 't1', projectId: 'p1', workspaceId: 'w1' })).status).toBe(200)
      wire(['fixture'], { roster: [{ name: 'fixture', required: false, disabled: false, state: 'active' }], activeSnapshots: active,
        installed: [installedEntry('fixture')] })
      expect((await call('probe', { nodeId: 'node-a', taskId: 't1' })).status).toBe(404)
    } finally { removePluginRoutes('fixture'); database.cleanup() }
  })
})

describe('GET /v1/core/plugins', () => {
  it('503s with no bridge, so an unwired node says so instead of answering an empty roster', async () => {
    setRouteTestCapability(PLUGIN_STATE, null)
    const res = await asDevice().fetch(request('GET'))
    expect(res.status).toBe(503)
  })

  it('reports the running set and the pending set separately', async () => {
    // rollbar is disabled and not running, because the file said so at boot. docker was turned off and
    // keeps running until the restart. Both rows are needed: the page renders one checkbox and one
    // "restart to apply" banner, and collapsing them lies about one or the other.
    wire(['rollbar', 'docker'])
    const res = await asDevice().fetch(request('GET'))
    expect(res.status).toBe(200)
    const state = (await res.json()) as NodePluginState
    expect(state.plugins).toEqual([
      { name: 'github', required: false, disabled: false, running: true, state: 'active', active: null },
      { name: 'terminal', required: true, disabled: false, running: true, state: 'active', active: null },
      { name: 'docker', required: false, disabled: true, running: true, state: 'active', active: null },
      { name: 'rollbar', required: false, disabled: true, running: false, state: 'disabled', active: null },
    ])
    expect(state.restartRequired).toBe(true)
  })

  it('passes a failed plugin through without demanding a restart a restart cannot deliver', async () => {
    // A loaded plugin whose init threw. It is not disabled and its contributions are gone, but the
    // owner's list and the running set still agree, so the restart banner stays down and the client
    // learns about the failure from `state` and the attention inbox instead.
    wire([], { roster: [{ name: 'ntfy', required: false, disabled: false, state: 'failed', failedAt: 1_700_000_000_000 }] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins).toEqual([
      { name: 'ntfy', required: false, disabled: false, running: true, state: 'failed', failedAt: 1_700_000_000_000, active: null },
    ])
    expect(state.restartRequired).toBe(false)
  })

  it('serves a load failure as failed with its reason, not as pending-restart', async () => {
    // The package is on disk with a parseable manifest, so it is in `installed()`, but its bundle would
    // not import, so it never booted. That pair must not read as "waiting for a restart", which raises
    // a banner restarting can never clear.
    wire([], {
      roster: [],
      installed: [installedEntry('ntfy')],
      booted: [],
      loadFailures: [{ id: 'ntfy', dir: '/data/plugins/ntfy', reason: 'could not import node/index.js: SyntaxError' }],
    })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins[0]).toMatchObject({
      name: 'ntfy',
      state: 'failed',
      stage: 'load',
      reason: 'could not import node/index.js: SyntaxError',
    })
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
    // for a required plugin, so the API has to as well, or the checkbox shows off while it runs.
    // `rollbar` stays in the list to keep the fixture self-consistent: the roster says it was disabled
    // at boot, and a file that no longer named it would mean "restart to bring it back".
    wire(['terminal', 'rollbar'])
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.filter((row) => row.disabled).map((row) => row.name)).toEqual(['rollbar'])
    expect(state.restartRequired).toBe(false)
  })

  it('reports restartRequired for a plugin turned back ON but not yet loaded', async () => {
    // The other direction, which a "did anything get disabled?" check misses: rollbar is off in the
    // running process and no longer in the file, so it comes back at the next start.
    wire([])
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.filter((row) => row.disabled)).toEqual([])
    expect(state.restartRequired).toBe(true)
  })
})

describe('installed packages in the roster (docs/plugins.md)', () => {
  it('attaches the manifest block to a plugin that came off disk, and to nothing else', async () => {
    wire([], { installed: [installedEntry('rollbar', { version: '2.1.0' })] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    const rows = new Map(state.plugins.map((row) => [row.name, row]))
    expect(rows.get('rollbar')?.installed).toEqual({
      version: '2.1.0',
      apiVersion: '1',
      permissions: NO_PERMISSIONS,
      emits: [],
      // Passed through untouched for the device to register surfaces from (docs/plugins.md). The node
      // neither reads nor renders it.
      contributions: { frames: [], remote: [], sources: [], slots: [], commands: [], keybindings: [], attention: [], nodeStats: [], contentLinks: [], agentContexts: [], refResolvers: [], routes: [], themes: [], styles: [], contextMenus: [], extensionPoints: [], extensions: [], schedules: [], taskChecks: [], auditActions: [], harnesses: [], customAgents: [], agentTools: [], contextSections: [], cliCommands: [] },
      client: { hash: 'a'.repeat(64), bytes: 12 },
    })
    // The client's "is this third-party?" answer, so a built-in must not carry the block at all.
    expect(rows.get('github')?.installed).toBeUndefined()
    expect(rows.get('terminal')?.installed).toBeUndefined()
  })

  it('gives a client-only package a row the plugin host never produced', async () => {
    // No node entrypoint, so it never entered initPlugins and has no roster entry, but its bundle is
    // what this phase distributes, so the device has to be told about it.
    // ['rollbar'] so the shared roster fixture is quiet: it was disabled at boot, so naming it keeps
    // the file and the process in agreement and leaves restartRequired to speak about the row under
    // test.
    wire(['rollbar'], { installed: [installedEntry('sparkline', { hasNode: false })], booted: [] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.at(-1)).toMatchObject({
      name: 'sparkline',
      required: false,
      disabled: false,
      running: true,
      state: 'active',
      active: { version: '1.0.0', activation: 'client-only', client: { hash: 'a'.repeat(64), bytes: 12 } },
      installed: {
        version: '1.0.0',
        apiVersion: '1',
        permissions: NO_PERMISSIONS,
        emits: [],
        contributions: { frames: [], remote: [], sources: [], slots: [], commands: [], keybindings: [], attention: [], nodeStats: [], contentLinks: [], agentContexts: [], refResolvers: [], routes: [], themes: [], styles: [], contextMenus: [], extensionPoints: [], extensions: [], schedules: [], taskChecks: [], auditActions: [], harnesses: [], customAgents: [], agentTools: [], contextSections: [] },
        client: { hash: 'a'.repeat(64), bytes: 12 },
      },
    })
    expect(state.restartRequired).toBe(false)
  })

  it('never asks for a restart to apply a client-only toggle', async () => {
    // Its contributions are all client-side and the client re-initialises its plugin host on a roster
    // change, so `running` tracks `disabled` and the banner stays down. A restart changes nothing.
    const saved = wire(['rollbar'], { installed: [installedEntry('sparkline')] })
    const res = await asDevice().fetch(request('PUT', { disabled: ['rollbar', 'sparkline'] }))
    expect(res.status).toBe(200)
    expect(saved()).toEqual(['rollbar', 'sparkline'])
    const state = (await res.json()) as NodePluginState
    expect(state.plugins.at(-1)).toMatchObject({ name: 'sparkline', disabled: true, running: false, state: 'disabled' })
    expect(state.restartRequired).toBe(false)
  })
})

describe('GET /v1/core/plugins/:id/client.js', () => {
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
    setRouteTestCapability(PLUGIN_STATE, null)
    expect((await asDevice().fetch(bundleRequest('rollbar'))).status).toBe(503)
  })
})

describe('GET /v1/core/plugins/:id/bundles/:hash', () => {
  it('serves both the retained active version and the advertised disk candidate by their own hashes', async () => {
    const oldBytes = 'export default { version: 1 }'
    const newBytes = 'export default { version: 2 }'
    const oldHash = createHash('sha256').update(oldBytes).digest('hex')
    const newHash = createHash('sha256').update(newBytes).digest('hex')
    const active = activeSnapshot('sparkline', '1.0.0')
    active.identity.client = { hash: oldHash, bytes: oldBytes.length }
    const onDisk = [installedEntry('sparkline', { version: '2.0.0', client: { hash: newHash, bytes: newBytes.length } })]
    wire([], {
      roster: [{ name: 'sparkline', required: false, disabled: false, state: 'active' }],
      installed: onDisk,
      activeSnapshots: [active],
      bundlesByHash: { [oldHash]: oldBytes, [newHash]: newBytes },
    })
    const app = asDevice()
    const state = (await (await app.fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins[0]).toMatchObject({ state: 'pending-restart', active: { version: '1.0.0', client: { hash: oldHash } }, installed: { version: '2.0.0', client: { hash: newHash } } })
    for (const [hash, bytes] of [[oldHash, oldBytes], [newHash, newBytes]]) {
      const response = await app.fetch(at(`/sparkline/bundles/${hash}`, 'GET'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(bytes)
      expect(response.headers.get('etag')).toBe(`"${hash}"`)
    }
    expect((await app.fetch(at(`/sparkline/bundles/${'f'.repeat(64)}`, 'GET'))).status).toBe(404)
    onDisk.splice(0)
    const uninstalled = (await (await app.fetch(request('GET'))).json()) as NodePluginState
    expect(uninstalled.plugins[0]).toMatchObject({ state: 'pending-restart', active: { client: { hash: oldHash } } })
    expect(uninstalled.plugins[0]?.installed).toBeUndefined()
    expect(await (await app.fetch(at(`/sparkline/bundles/${oldHash}`, 'GET'))).text()).toBe(oldBytes)
    expect((await app.fetch(at(`/sparkline/bundles/${newHash}`, 'GET'))).status).toBe(404)
  })
})

describe('PUT /v1/core/plugins', () => {
  it('persists the list and answers the new state', async () => {
    const saved = wire([])
    const res = await asDevice().fetch(request('PUT', { disabled: ['docker'] }))
    expect(res.status).toBe(200)
    expect(saved()).toEqual(['docker'])
    const state = (await res.json()) as NodePluginState
    expect(state.plugins.find((row) => row.name === 'docker')).toEqual({ name: 'docker', required: false, disabled: true, running: true, state: 'active', active: null })
    expect(state.restartRequired).toBe(true)
  })

  it('rejects an unknown plugin name rather than silently dropping it', async () => {
    const saved = wire([])
    const res = await asDevice().fetch(request('PUT', { disabled: ['nope'] }))
    expect(res.status).toBe(400)
    expect(saved()).toEqual([])
  })

  it('accepts turning off a package the loader refused, which is the owner’s only escape hatch', async () => {
    // Such a package is in neither the roster nor `installed()`, because nothing about it parsed.
    // Without the third clause in the route's `known` map, the row's own checkbox 400s.
    const saved = wire([], {
      roster: [],
      loadFailures: [{ id: 'ntfy', dir: '/data/plugins/ntfy', reason: 'acorn-plugin.json is not valid JSON' }],
    })
    const res = await asDevice().fetch(request('PUT', { disabled: ['ntfy'] }))
    expect(res.status).toBe(200)
    expect(saved()).toEqual(['ntfy'])
    const state = (await res.json()) as NodePluginState
    expect(state.plugins).toEqual([{ name: 'ntfy', required: false, disabled: true, running: false, state: 'disabled', active: null }])
    expect(state.restartRequired).toBe(false)
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
    setRouteTestCapability(PLUGIN_STATE, null)
    expect((await asDevice().fetch(request('PUT', { disabled: ['docker'] }))).status).toBe(503)
  })
})

describe('the device gate over /v1/core/plugins', () => {
  // The gate is mounted in server/index.ts (`.use('/v1/core/plugins', requireDevice)`), so this asserts
  // the middleware's verdict on this path rather than re-mounting the router. An agent-spawned child
  // must not enumerate the node's surface, nor disable the plugin whose gate it stands behind.
  const gated = (principal: AppEnv['Variables']['principal']) => {
    const hono = new Hono<AppEnv>()
    hono.use('/v1/*', async (c, next) => {
      c.set('principal', principal)
      await next()
    })
    hono.use('/v1/core/plugins', requireDevice)
    // The second form, as server/index.ts mounts it. It keeps a route added under the prefix, such as
    // the bundle route below, from arriving ungated.
    hono.use('/v1/core/plugins/*', requireDevice)
    return hono.route('/v1/core/plugins', plugins)
  }

  it('403s a task-scoped agent on both verbs', async () => {
    wire([])
    for (const method of ['GET', 'PUT']) {
      const res = await gated({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' }).fetch(
        request(method, method === 'PUT' ? { disabled: [] } : undefined),
      )
      expect(res.status, method).toBe(403)
    }
    // And the ungated router would have answered. So the 403 is the gate, not the handler.
    expect((await asTaskAgent().fetch(request('GET'))).status).toBe(200)
  })

  it('403s a task-scoped agent on the bundle bytes', async () => {
    // Which code a device runs is an owner decision. A task-scoped token belongs to an agent running
    // inside that decision's outcome, so it must not be able to pull a plugin's client bundle.
    wire([], { installed: [installedEntry('sparkline')], bundles: { sparkline: 'export default {}' } })
    const res = await gated({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' }).fetch(bundleRequest('sparkline'))
    expect(res.status).toBe(403)
    expect((await asTaskAgent().fetch(bundleRequest('sparkline'))).status).toBe(200)
  })

  it('lets a device through', async () => {
    wire([])
    expect((await gated({ kind: 'device', userId: 'james', deviceId: 'd1' }).fetch(request('GET'))).status).toBe(200)
  })

  it('403s a task-scoped agent answering its own approval request', async () => {
    // The point of the request and decision split. An agent raises a request because it cannot install.
    // If it could also POST the approval, the split would be theatre.
    wire([])
    _resetPluginRequests()
    const raised = raisePluginRequest({ taskId: 't1', action: 'install', dev: true, source: { path: '/src/board' } })
    const attempt = at(`/requests/${raised.request.requestId}`, 'POST', { decision: 'approved' })
    const agent = gated({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' })
    expect((await agent.fetch(attempt.clone())).status).toBe(403)
    // And the ungated router would have answered. So the 403 is the gate, not the handler.
    expect((await asTaskAgent().fetch(attempt)).status).toBe(200)
  })

  it('403s a task-scoped agent on install, update, uninstall and reload', async () => {
    // The sharpest case in this file. A prompt-injected agent that could POST here makes the node fetch
    // and run arbitrary code with the node's own access (docs/security.md).
    wire([], { installed: [installedEntry('sparkline')] })
    const agent = gated({ kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' })
    const attempts = [
      at('/install', 'POST', { source: { url: 'https://example.test/p.tgz' } }, KEY),
      at('/sparkline/update', 'POST', {}, KEY),
      at('/sparkline', 'DELETE', {}, KEY),
      // Reload is the sharpest of the four: it is how a prompt-injected agent makes code already on the
      // node run again on its own timing, with no bytes arriving to notice.
      at('/sparkline/reload', 'POST', undefined, KEY),
    ]
    for (const attempt of attempts) expect((await agent.fetch(attempt.clone())).status, attempt.url).toBe(403)
    // And the ungated router would have answered. So the 403 is the gate, not the handler.
    for (const attempt of attempts) expect((await asTaskAgent().fetch(attempt)).status, attempt.url).toBe(200)
  })
})

describe('the pending-restart state', () => {
  const installedNtfy = (version: string) => installedEntry('ntfy', { version })

  it('reports a freshly installed plugin as pending, not running', async () => {
    // On disk, never loaded. The install route cannot make it true in the running process, so the
    // roster has to say so rather than claim the plugin is live.
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
    // Still running, the old code. That is exactly what the banner is for.
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
    // Its contributions are all client-side and the client re-registers on a roster change. A restart
    // banner it can never clear trains the owner to ignore the banner. `rollbar` is disabled in the
    // default roster, so the file has to name it for the toggle half of restartRequired to stay quiet
    // and this assertion to be about the install half.
    wire(['rollbar'], { installed: [installedEntry('sparkline', { hasNode: false })], booted: [] })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.plugins.find((row) => row.name === 'sparkline')).toMatchObject({ running: true, state: 'active' })
    expect(state.restartRequired).toBe(false)
  })

  it('does not turn a failed plugin into a pending one', async () => {
    // A restart cannot fix an init that throws, so 'failed' outranks 'pending-restart' even though the
    // package is on disk and unloaded.
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
    // A retried install is the case this exists for. The first attempt may have finished on the node
    // and died on the wire, and a second unkeyed POST fetches and places the package again.
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
    // Everything the installer refuses is operator-fixable: a bad manifest, an unreachable release, a
    // downgrade. The owner needs the wording, not a 500.
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

  it('reloads a loaded plugin in place, reporting the version now running', async () => {
    const bridge = wire([], { installed: [installedEntry('ntfy')] })
    const res = await asDevice().fetch(at('/ntfy/reload', 'POST', undefined, KEY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'ntfy', version: '1.1.0', state: 'reloaded' })
    expect(bridge.calls.reload).toEqual([{ id: 'ntfy' }])
  })

  it('answers 200 with state failed when the new code did not start', async () => {
    // Candidate-then-commit means a failed reload changed nothing. The previous instance is still
    // serving, so this is a report and not a request error. A 500 says the opposite.
    wire([], { installed: [installedEntry('broken')] })
    const res = await asDevice().fetch(at('/broken/reload', 'POST', undefined, KEY))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ state: 'failed', reason: 'init exploded' })
  })

  it('400s a reload of a built-in, which has no disk copy to swap in', async () => {
    wire([])
    const res = await asDevice().fetch(at('/terminal/reload', 'POST', undefined, KEY))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('not a plugin this node loaded from disk')
  })

  it('demands an Idempotency-Key on a reload too', async () => {
    // A retried reload would run the candidate init twice, and a plugin's init is not obliged to be
    // idempotent, so it carries the same requirement as the three mutations above.
    wire([], { installed: [installedEntry('ntfy')] })
    expect((await asDevice().fetch(at('/ntfy/reload', 'POST'))).status).toBe(400)
  })

  it('answers the agent-raised approval queue on the roster route', async () => {
    // The queue rides the roster rather than getting a GET of its own: same device-only mount, same
    // reconcile. An unanswered request is the only thing an agent can put here.
    wire([])
    _resetPluginRequests()
    raisePluginRequest({ taskId: 't1', action: 'install', dev: true, source: { path: '/src/board' }, reason: 'so I can iterate' })
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.requests).toMatchObject([{ taskId: 't1', action: 'install', dev: true, source: { path: '/src/board' }, reason: 'so I can iterate' }])
  })

  it('records the owner’s answer and drops the request from the queue', async () => {
    wire([])
    _resetPluginRequests()
    const raised = raisePluginRequest({ taskId: 't1', action: 'uninstall', dev: false, pluginId: 'ntfy' })
    const res = await asDevice().fetch(at(`/requests/${raised.request.requestId}`, 'POST', { decision: 'approved', message: 'gone' }))
    expect(res.status).toBe(200)
    const state = (await (await asDevice().fetch(request('GET'))).json()) as NodePluginState
    expect(state.requests).toEqual([])
  })

  it('404s a second answer, and an id that never existed', async () => {
    wire([])
    _resetPluginRequests()
    const raised = raisePluginRequest({ taskId: 't1', action: 'uninstall', dev: false, pluginId: 'ntfy' })
    const path = `/requests/${raised.request.requestId}`
    expect((await asDevice().fetch(at(path, 'POST', { decision: 'denied' }))).status).toBe(200)
    expect((await asDevice().fetch(at(path, 'POST', { decision: 'approved' }))).status).toBe(404)
    expect((await asDevice().fetch(at('/requests/nope', 'POST', { decision: 'approved' }))).status).toBe(404)
  })

  it('rejects a malformed decision', async () => {
    wire([])
    _resetPluginRequests()
    const raised = raisePluginRequest({ taskId: 't1', action: 'uninstall', dev: false, pluginId: 'ntfy' })
    const path = `/requests/${raised.request.requestId}`
    for (const body of [{}, { decision: 'maybe' }, { decision: 'approved', extra: 1 }, { decision: 'approved', message: '' }]) {
      expect((await asDevice().fetch(at(path, 'POST', body))).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('needs no bridge to answer a request, so a node with no plugin host can still say no', async () => {
    setRouteTestCapability(PLUGIN_STATE, null)
    _resetPluginRequests()
    const raised = raisePluginRequest({ taskId: 't1', action: 'install', dev: false, source: { npm: 'x' } })
    expect((await asDevice().fetch(at(`/requests/${raised.request.requestId}`, 'POST', { decision: 'denied' }))).status).toBe(200)
  })

  it('503s every mutation when there is no bridge', async () => {
    setRouteTestCapability(PLUGIN_STATE, null)
    for (const attempt of [
      at('/install', 'POST', { source: { url: 'https://example.test/p.tgz' } }, KEY),
      at('/ntfy/update', 'POST', {}, KEY),
      at('/ntfy', 'DELETE', {}, KEY),
    ]) {
      expect((await asDevice().fetch(attempt)).status, attempt.url).toBe(503)
    }
  })
})
