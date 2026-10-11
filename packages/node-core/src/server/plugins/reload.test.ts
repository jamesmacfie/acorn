// The reload path's acceptance list (docs/plugins/dev-loop.md § The dev loop § Reloading one plugin without a
// restart): candidate-then-commit, contained failure, a stale handle that throws, plus the fix that
// made all three pointless until it landed, which is that a reloaded plugin's routes have to serve
// the new handler.
//
// Everything here uses the real host, the real context builder and the real module-singleton registries,
// because the whole question is what those do when a second instance of one plugin arrives.
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService, type GenerateTextRequest } from '../core'
import type { NodePermissions } from './manifest'
import { makeTestDb, testCoreSeams } from '../../testkit/db'
import { testGate } from '../../testkit/auth'
import type { Env } from '../bindings'
import { agentToolContributions } from '../agentTools/registry'
import type { AppEnv } from '../middleware/auth'
import { PLUGIN_NAMESPACE, pluginRouteContributions } from '../routes/registry'
import { CapabilityRegistry, capabilityId } from '../pluginHost/capabilities'
import { BIND_CAPABILITY_CALLER } from '@acorn/protocol/plugin/ids.ts'
import { dispatchPluginFetch } from '../pluginHost/fetchRoute'
import { clearRegistrations, initPlugins, type PluginReloadRequest } from '../pluginHost/host'
import type { CompiledNodePluginContext, NodePlugin, PluginStorage } from '../pluginHost/types'

const PLUGIN = 'acme'

// A loaded plugin declares nothing by default, which is what `permissions: {}` means in a manifest.
const NO_PERMISSIONS: NodePermissions = {
  core: [],
  capabilities: [],
  secrets: false,
  exec: false,
  net: [],
  sockets: false,
}
// Never opened by anything in this file: these cases are about registrations, and a real chain would drag
// a temp data root in for nothing. The reload × migration interaction has its own note in
// server/plugins/storage.ts, and it is a promise deliberately NOT made.
const storage: PluginStorage = {
  open: () => {
    throw new Error('this suite never opens a plugin database')
  },
}
const binding = { permissions: NO_PERMISSIONS, storage }

const shared = makeTestDb()
const hostOptions = () => ({
  capabilities: new CapabilityRegistry(),
  core: createCoreServices({
    secrets: new SecretService('b'.repeat(64)),
    db: shared.db,
    activeIdentity: memoryIdentityStore(),
    ...testCoreSeams(),
  }),
  dataDir: '',
  loaded: new Map([[PLUGIN, binding]]),
})

// One loaded plugin that contributes the three things a reload has to move: a route (mounted through the
// portable carrier), an agent tool (a registry that rejects duplicates, which is what makes the candidate
// buffer necessary) and a captured context (so the test can prove the old one is revoked).
const acme = (
  body: string,
  extra?: Partial<NodePlugin>,
): { plugin: NodePlugin; context: () => CompiledNodePluginContext } => {
  let captured: CompiledNodePluginContext | null = null
  return {
    context: () => captured!,
    plugin: {
      name: PLUGIN,
      init: (ctx) => {
        captured = ctx
        ctx.routes.fetch(() => new Response(body))
        ctx.tools.register({
          name: `${PLUGIN}_probe`,
          description: body,
          input: z.object({}),
          scope: 'task',
          risk: 'read',
          handler: async () => ({}),
        })
      },
      ...extra,
    },
  }
}

const request = (path: string) =>
  new Hono<AppEnv>()
    .use('/v1/*', ...testGate({ kind: 'device', userId: 'owner-1', deviceId: 'device-1' }))
    .all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
    .all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)
    .fetch(new Request(`http://acorn.test${path}`), {} as Env)

const toolDescriptions = () =>
  agentToolContributions()
    .filter((tool) => tool.name === `${PLUGIN}_probe`)
    .map((tool) => tool.description)

afterEach(() => clearRegistrations(PLUGIN))

describe('plugin reload', () => {
  it('leaves the previous instance fully live when the candidate init throws', async () => {
    const first = acme('v1')
    const host = await initPlugins([first.plugin], hostOptions())

    const outcome = await host.reload(PLUGIN, {
      plugin: {
        name: PLUGIN,
        init: () => {
          throw new Error('the new bundle is broken')
        },
      },
      binding,
    })

    expect(outcome).toEqual({ ok: false, error: 'the new bundle is broken', retained: true })
    // Fully live means all three: the route still serves, the tool is still the old one and there is
    // exactly one of each. A candidate that had written through would have left duplicates.
    expect(await (await request(`/v1/p/${PLUGIN}`)).text()).toBe('v1')
    expect(toolDescriptions()).toEqual(['v1'])
    expect(pluginRouteContributions().filter((route) => route.plugin === PLUGIN)).toHaveLength(1)
    await host.dispose()
  })

  it('records the failure on the roster row so the owner can read it', async () => {
    const host = await initPlugins([acme('v1').plugin], hostOptions())
    await host.reload(PLUGIN, {
      plugin: {
        name: PLUGIN,
        init: () => {
          throw new Error('boom')
        },
      },
      binding,
    })
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({
      state: 'failed',
      stage: 'init',
      reason: 'boom',
    })
    // And a later good reload clears it, or the row would stay red for a plugin that is running fine.
    await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({ state: 'active' })
    expect(host.roster.find((entry) => entry.name === PLUGIN)?.reason).toBeUndefined()
    await host.dispose()
  })

  it('swaps the registrations on success and revokes the previous context', async () => {
    const first = acme('v1')
    const host = await initPlugins([first.plugin], hostOptions())
    const stale = first.context()

    expect(await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })).toEqual({ ok: true })

    expect(toolDescriptions()).toEqual(['v2'])
    expect(pluginRouteContributions().filter((route) => route.plugin === PLUGIN)).toHaveLength(1)
    // The stale handle: a leaked reference must fail loudly rather than register into a plugin that is
    // no longer running. The message names the reason, because "not a function" would send an author
    // looking at their own code.
    expect(() => stale.tools.register({} as never)).toThrow(/replaced by a reload/)
    expect(() => stale.routes.fetch(() => new Response())).toThrow(/replaced by a reload/)
    await host.dispose()
  })

  it('serves the NEW handler, which is the whole reason the app dispatches instead of mounting', async () => {
    const host = await initPlugins([acme('v1').plugin], hostOptions())
    expect(await (await request(`/v1/p/${PLUGIN}`)).text()).toBe('v1')

    await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })

    expect(await (await request(`/v1/p/${PLUGIN}`)).text()).toBe('v2')
    expect(await (await request(`/v1/p/${PLUGIN}/anything`)).text()).toBe('v2')
    await host.dispose()
  })

  it('reaches a prefix that only exists after the reload', async () => {
    const host = await initPlugins(
      [
        {
          name: PLUGIN,
          init: (ctx) => ctx.routes.fetch(() => new Response('early'), { prefix: '/early' }),
        },
      ],
      hostOptions(),
    )
    // Nothing was mounted at this path when the app was built, so a boot-time mount table could never
    // answer it. The fall-through keeps that the app's own 404 rather than the dispatcher's.
    expect((await request(`/v1/p/${PLUGIN}/late`)).status).toBe(404)

    await host.reload(PLUGIN, {
      plugin: {
        name: PLUGIN,
        init: (ctx) => {
          ctx.routes.fetch(() => new Response('root'))
          ctx.routes.fetch(() => new Response('late'), { prefix: '/late' })
        },
      },
      binding,
    })

    // Longest prefix wins, so the specific handler answers its own path and the namespace owner keeps
    // everything else.
    expect(await (await request(`/v1/p/${PLUGIN}/late`)).text()).toBe('late')
    expect(await (await request(`/v1/p/${PLUGIN}/other`)).text()).toBe('root')
    await host.dispose()
  })

  it('never shadows a built-in router, which is mounted before it', async () => {
    // The regression this change could have caused. createApp mounts every built-in's Hono router first
    // and the dispatcher last, so a path a router already answers must never reach the dispatcher, and a
    // path under a built-in's namespace that nothing claims must still be the app's own 404.
    const host = await initPlugins([acme('loaded').plugin], hostOptions())
    const app = new Hono<AppEnv>()
      .use('/v1/*', ...testGate({ kind: 'device', userId: 'owner-1', deviceId: 'device-1' }))
      .route(
        `${PLUGIN_NAMESPACE}/${PLUGIN}`,
        new Hono<AppEnv>().get('/compiled', (c) => c.text('built-in')),
      )
      .all(`${PLUGIN_NAMESPACE}/:plugin`, dispatchPluginFetch)
      .all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)
    const call = (path: string) => app.fetch(new Request(`http://acorn.test${path}`), {} as Env)

    expect(await (await call(`/v1/p/${PLUGIN}/compiled`)).text()).toBe('built-in')
    expect(await (await call(`/v1/p/${PLUGIN}/elsewhere`)).text()).toBe('loaded')
    expect((await call('/v1/p/nobody/at/all')).status).toBe(404)
    await host.dispose()
  })

  it('refuses a name this node did not load from disk', async () => {
    // No `loaded` entry: a built-in, which keeps restart-required semantics because there is no second
    // copy of it on disk to swap in.
    const host = await initPlugins([acme('v1').plugin], { ...hostOptions(), loaded: new Map() })
    const outcome = await host.reload(PLUGIN, { plugin: acme('v2').plugin, binding })
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('not a plugin this node loaded from disk') })
    expect(toolDescriptions()).toEqual(['v1'])
    await host.dispose()
  })

  it('lets a plugin whose init was contained at boot come back without a restart', async () => {
    const host = await initPlugins(
      [
        {
          name: PLUGIN,
          init: () => {
            throw new Error('broken at boot')
          },
        },
      ],
      hostOptions(),
    )
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({ state: 'failed' })

    expect(await host.reload(PLUGIN, { plugin: acme('fixed').plugin, binding })).toEqual({ ok: true })
    expect(await (await request(`/v1/p/${PLUGIN}`)).text()).toBe('fixed')
    expect(host.roster.find((entry) => entry.name === PLUGIN)).toMatchObject({ state: 'active' })
    await host.dispose()
  })

  it('re-provides a capability the previous instance held, which a live registry would refuse', async () => {
    // The case the candidate buffer exists for, in its sharpest form: CapabilityRegistry.provide throws
    // on a duplicate id, so a candidate init run straight at the live registry would fail on the
    // plugin's own capability every single time.
    const id = capabilityId<() => string>('acme.version')
    const versioned = (version: string): PluginReloadRequest => {
      // The plugin releases what it provided in its own dispose, because the host never holds the
      // handle: the same contract a contained failure at boot already relies on. A plugin that keeps
      // its capability through dispose fails the replay instead, which is the commit-window ceiling
      // written down in host.ts.
      let handle: { dispose(): void } | null = null
      return {
        binding,
        plugin: {
          name: PLUGIN,
          init: (ctx) => void (handle = ctx.capabilities.provide(id, () => version)),
          dispose: () => handle?.dispose(),
        },
      }
    }
    const options = hostOptions()
    const host = await initPlugins([versioned('v1').plugin], options)
    expect(options.capabilities.get(id)?.()).toBe('v1')

    expect(await host.reload(PLUGIN, versioned('v2'))).toEqual({ ok: true })
    expect(options.capabilities.get(id)?.()).toBe('v2')
    await host.dispose()
  })
})

// Boot and reload once built their bindings separately, and the reload's copy had no data sources, so
// a reloaded derived source vanished from the catalog until the next restart.
describe('a folder plugin through the loader, the host, and the reloader', () => {
  it('still has its data source after a reload', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { installPlugin } = await import('./installer')
    const { createPluginReloader } = await import('./reload')
    const { loadExternalPlugins, loadedPluginBinding } = await import('./loader')
    const { PLUGIN_API_MAJOR } = await import('./manifest')
    const { registeredDataSource, registeredDataSources } = await import('../dataSources/registry')
    const root = mkdtempSync(join(tmpdir(), 'acorn-reload-folder-'))
    try {
      const source = join(root, 'source')
      mkdirSync(join(source, 'dist'), { recursive: true })
      writeFileSync(
        join(source, 'acorn-plugin.json'),
        JSON.stringify({
          id: 'folder-fixture',
          name: 'Folder fixture',
          version: '1.0.0',
          baseline: 'acorn-1',
          apiVersion: PLUGIN_API_MAJOR,
          node: './dist/node.js',
          contributions: {
            dataSources: [
              {
                sourceId: 'board',
                name: 'Board',
                singular: 'Card',
                plural: 'Cards',
                identityScope: 'card',
                handler: '/v1/p/folder-fixture/board',
                inputs: { tasks: { source: 'core:tasks', label: 'Tasks' } },
              },
            ],
          },
        }),
      )
      writeFileSync(
        join(source, 'dist', 'node.js'),
        'export default { name: "folder-fixture", init(ctx) { ctx.routes.fetch(() => new Response("x"), { prefix: "/board" }) } }\n',
      )
      await installPlugin(root, { path: source })
      const { loaded } = await loadExternalPlugins(root, { builtins: [] })
      const host = await initPlugins(
        loaded.map((entry) => entry.plugin),
        {
          ...hostOptions(),
          dataDir: root,
          loaded: new Map(loaded.map((entry) => [entry.manifest.id, loadedPluginBinding(entry)])),
        },
      )
      const ref = { pluginId: 'folder-fixture', sourceId: 'board' }
      expect(registeredDataSource(ref)).toBeDefined()
      const reloader = createPluginReloader({ dataDir: root, builtins: [], host })
      expect(await reloader.reload('folder-fixture')).toMatchObject({ state: 'reloaded' })
      expect(registeredDataSources().map((entry) => entry.pluginId)).toContain('folder-fixture')
      await host.dispose()
    } finally {
      clearRegistrations('folder-fixture')
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// The manifest carrier for hooks: a folder package's route-backed handler joins another plugin's hook
// and its answer reaches the owner. The binding once dropped `extensions`, and every such handler
// installed, showed its grant, and never ran.
describe('a folder plugin’s hook handler through the loader and the host', () => {
  it('vetoes through its route', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { installPlugin } = await import('./installer')
    const { loadExternalPlugins, loadedPluginBinding } = await import('./loader')
    const { PLUGIN_API_MAJOR } = await import('./manifest')
    const { registerHookPoint, runHook } = await import('../pluginHost/hooks')
    const { testEnv } = await import('../../testkit/db')
    const root = mkdtempSync(join(tmpdir(), 'acorn-hook-folder-'))
    const point = registerHookPoint({
      id: 'owner:before-thing',
      ownerId: 'owner',
      payload: { command: 'string' },
      allows: ['veto'],
      timeoutMs: 5_000,
      onTimeout: 'allow',
      order: 'install',
      collect: false,
    })
    try {
      const source = join(root, 'source')
      mkdirSync(join(source, 'dist'), { recursive: true })
      writeFileSync(
        join(source, 'acorn-plugin.json'),
        JSON.stringify({
          id: 'hook-fixture',
          name: 'Hook fixture',
          version: '1.0.0',
          baseline: 'acorn-1',
          apiVersion: PLUGIN_API_MAJOR,
          node: './dist/node.js',
          contributions: {
            extensions: [
              {
                id: 'rule',
                point: 'owner:before-thing',
                label: 'do the thing',
                route: '/v1/p/hook-fixture/check',
                mode: 'veto',
              },
            ],
          },
        }),
      )
      writeFileSync(
        join(source, 'dist', 'node.js'),
        'export default { name: "hook-fixture", init(ctx) { ctx.routes.fetch(async (request) => Response.json({ ok: false, reason: `no ${(await request.json()).command}` })) } }\n',
      )
      await installPlugin(root, { path: source })
      const { loaded } = await loadExternalPlugins(root, { builtins: [] })
      const core = createCoreServices({
        secrets: new SecretService('b'.repeat(64)),
        db: shared.db,
        activeIdentity: memoryIdentityStore('owner'),
        ...testCoreSeams(),
      })
      const host = await initPlugins(
        loaded.map((entry) => entry.plugin),
        {
          ...hostOptions(),
          core,
          dataDir: root,
          env: testEnv({ ACTIVE_IDENTITY: memoryIdentityStore('owner') }),
          loaded: new Map(loaded.map((entry) => [entry.manifest.id, loadedPluginBinding(entry)])),
        },
      )
      expect(await runHook('owner:before-thing', { command: 'push' })).toMatchObject({
        ok: false,
        by: 'hook-fixture',
        reason: 'no push',
      })
      await host.dispose()
    } finally {
      point.dispose()
      clearRegistrations('hook-fixture')
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// The worker keeps the sender past `connect`, then uses it twice: once to send, once to echo the
// answer it got back. It also names another plugin in the message, which nothing reads.
const MESSENGER_FIXTURE = `export default { name: "messenger-fixture", init(ctx) {
  ctx.extensionPoints.handle("agents:session-messenger", { id: "notes", value: { connect(sender) {
    setTimeout(async () => {
      const answer = await sender.queue({ taskId: "t", sessionId: "s", subject: "hi", text: "first", idempotencyKey: "k", pluginId: "agents" })
      await sender.queue({ taskId: "t", sessionId: "s", subject: "echo", text: JSON.stringify(answer), idempotencyKey: "k2" })
    }, 0)
  } } })
} }\n`

// A reviewer that hands back the window it was given, then holds until the owner aborts it.
const REVIEWER_FIXTURE = `export default { name: "messenger-fixture", init(ctx) {
  ctx.extensionPoints.handle("agents:turn-follow-up", { id: "review", value: { review(window) {
    return new Promise((resolve) => window.signal.addEventListener("abort", () => resolve(), { once: true }))
      .then(() => window.report({ turnId: window.turnId, owner: window.owner, aborted: window.signal.aborted }))
  } } })
} }\n`

// A host-bound sender handed to a loaded worker: the agents session messenger's carrier
// (plugins/agents/src/server/sessions/sessionMessages.ts). The owner here stands in for agents, so this
// proves the transport and the manifest gate, not the admission rules agents' own tests cover.
describe('a folder plugin’s session messenger through the loader and the host', () => {
  const install = async (manifestExtensions: unknown[], nodeSource = MESSENGER_FIXTURE) => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { installPlugin } = await import('./installer')
    const { loadExternalPlugins, loadedPluginBinding } = await import('./loader')
    const { PLUGIN_API_MAJOR } = await import('./manifest')
    const root = mkdtempSync(join(tmpdir(), 'acorn-messenger-folder-'))
    const source = join(root, 'source')
    mkdirSync(join(source, 'dist'), { recursive: true })
    writeFileSync(
      join(source, 'acorn-plugin.json'),
      JSON.stringify({
        id: 'messenger-fixture',
        name: 'Messenger fixture',
        version: '1.0.0',
        baseline: 'acorn-1',
        apiVersion: PLUGIN_API_MAJOR,
        node: './dist/node.js',
        contributions: { extensions: manifestExtensions },
      }),
    )
    writeFileSync(join(source, 'dist', 'node.js'), nodeSource)
    await installPlugin(root, { path: source })
    const { loaded } = await loadExternalPlugins(root, { builtins: [] })
    const host = await initPlugins(
      loaded.map((entry) => entry.plugin),
      {
        ...hostOptions(),
        dataDir: root,
        loaded: new Map(loaded.map((entry) => [entry.manifest.id, loadedPluginBinding(entry)])),
      },
    )
    return {
      host,
      cleanup: () => {
        clearRegistrations('messenger-fixture')
        rmSync(root, { recursive: true, force: true })
      },
    }
  }

  it('calls a sender the host bound, after connect returned, and gets its answer back', async () => {
    const { extensionsFor, openExtensionPoint } = await import('../pluginHost/extensionPoints')
    const point = openExtensionPoint('agents', 'agents:session-messenger' as never, 'Session messengers')
    const { host, cleanup } = await install([{ id: 'notes', point: 'agents:session-messenger', label: 'send notes' }])
    try {
      const calls: { pluginId: string; message: Record<string, unknown> }[] = []
      const [entry] = extensionsFor<{ connect(sender: unknown): unknown }>('agents:session-messenger' as never)
      expect(entry).toMatchObject({ id: 'messenger-fixture:notes', pluginId: 'messenger-fixture' })
      await entry!.value.connect({
        queue: async (message: Record<string, unknown>) => {
          calls.push({ pluginId: entry!.pluginId, message })
          return { ok: true, turnId: 'turn-1' }
        },
      })
      await vi.waitFor(() => expect(calls).toHaveLength(2))
      expect(calls.map((call) => call.pluginId)).toEqual(['messenger-fixture', 'messenger-fixture'])
      expect(calls[1]!.message.text).toBe('{"ok":true,"turnId":"turn-1"}')
      await host.dispose()
    } finally {
      point.dispose()
      cleanup()
    }
  })

  // The owner's window crosses the worker: its fields, a host function, and an abort the host raises later.
  it('gives a loaded reviewer the window and reaches it with the owner’s abort', async () => {
    const { extensionsFor, openExtensionPoint } = await import('../pluginHost/extensionPoints')
    const point = openExtensionPoint('agents', 'agents:turn-follow-up' as never, 'Turn reviewers')
    const { host, cleanup } = await install(
      [{ id: 'review', point: 'agents:turn-follow-up', label: 'review a turn' }],
      REVIEWER_FIXTURE,
    )
    try {
      const [entry] = extensionsFor<{ review(window: unknown): Promise<void> }>('agents:turn-follow-up' as never)
      expect(entry).toMatchObject({ pluginId: 'messenger-fixture' })
      const controller = new AbortController()
      const reports: unknown[] = []
      let settled = false
      const review = entry!.value
        .review({
          taskId: 't',
          sessionId: 's',
          turnId: 'turn-1',
          owner: 'workflow',
          deadline: Date.now() + 30_000,
          signal: controller.signal,
          report: (seen: unknown) => {
            reports.push(seen)
          },
        })
        .then(() => {
          settled = true
        })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(settled).toBe(false)
      controller.abort()
      await review
      expect(reports).toEqual([{ turnId: 'turn-1', owner: 'workflow', aborted: true }])
      await host.dispose()
    } finally {
      point.dispose()
      cleanup()
    }
  })

  it('refuses a contribution the manifest never declared, so the owner saw no grant for it', async () => {
    const { extensionsFor, openExtensionPoint } = await import('../pluginHost/extensionPoints')
    const point = openExtensionPoint('agents', 'agents:session-messenger' as never, 'Session messengers')
    const { host, cleanup } = await install([])
    try {
      expect(extensionsFor('agents:session-messenger' as never)).toEqual([])
      expect(host.roster.find((entry) => entry.name === 'messenger-fixture')).toMatchObject({ state: 'failed' })
      await host.dispose()
    } finally {
      point.dispose()
      cleanup()
    }
  })
})

// The owner-bound models facet and a capability's bounded result, across a real loaded worker
// (docs/integrations/model-providers.md § Plugin model grants). The worker names no plugin anywhere:
// the host's binding files the call under the package, and a spoofed owner never spends.
describe('a folder plugin’s granted model call through the loader and the host', () => {
  it('spends its own grant, refuses a spoofed owner, carries cancellation, and reads a bounded review', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { installPlugin } = await import('./installer')
    const { loadExternalPlugins, loadedPluginBinding } = await import('./loader')
    const { PLUGIN_API_MAJOR } = await import('./manifest')
    const { ProviderOperationError } = await import('../integrations/types')
    const { dayUsage, localDay, pluginModelService, writeModelGrant } = await import('../modelProviders/grants')
    const root = mkdtempSync(join(tmpdir(), 'acorn-models-folder-'))
    const db = makeTestDb()
    const identity = memoryIdentityStore()
    identity.set('owner-1')
    // The prompt says whether to wait for the caller's abort, which is the cancellation case.
    const seen: { backendId: string; aborted: boolean }[] = []
    const models = {
      available: async () => [],
      generateText: async (request: GenerateTextRequest) => {
        const signal = request.input.signal
        if (request.input.prompt === 'wait' && signal)
          await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        seen.push({ backendId: request.backendId, aborted: !!signal?.aborted })
        if (signal?.aborted) throw new ProviderOperationError('provider_unavailable', 502)
        return {
          text: 'reviewed',
          providerId: 'fake',
          backendId: request.backendId,
          modelId: 'm',
          usage: { outputTokens: 7 },
        }
      },
    }
    const options = hostOptions()
    const core = createCoreServices({
      secrets: new SecretService('b'.repeat(64)),
      db: db.db,
      activeIdentity: identity,
      ...testCoreSeams(),
    })
    core.models = { ...models, forPlugin: (id) => pluginModelService(db.db, models, core.identity, id) }
    const review = {
      available: true,
      input: {
        userText: [
          {
            text: 'é'.repeat(8_000),
            provenance: { kind: 'context', source: 'plugin:x', label: 'Issue' },
            truncated: true,
          },
        ],
      },
    }
    const provided = options.capabilities.provide(capabilityId('agents.reviewInput.v1'), { read: async () => review })
    // A caller-bound capability: the provider learns who called from the host, never from an argument.
    const changes: string[] = []
    const control = (caller: string) => ({
      setConfig: async (_task: string, _session: string, option: string, value: string) => {
        changes.push(`${caller} ${option}=${value}`)
      },
    })
    const controlled = options.capabilities.provide(capabilityId('agents.sessionControl'), {
      ...control('unbound'),
      [BIND_CAPABILITY_CALLER]: control,
    })
    try {
      const source = join(root, 'source')
      mkdirSync(join(source, 'dist'), { recursive: true })
      writeFileSync(
        join(source, 'acorn-plugin.json'),
        JSON.stringify({
          id: 'models-fixture',
          name: 'Models fixture',
          version: '1.0.0',
          baseline: 'acorn-1',
          apiVersion: PLUGIN_API_MAJOR,
          node: './dist/node.js',
          permissions: {
            node: {
              core: ['models', 'identity'],
              capabilities: ['agents.reviewInput.v1', 'agents.sessionControl'],
              secrets: false,
              exec: false,
              net: [],
            },
          },
        }),
      )
      writeFileSync(
        join(source, 'dist', 'node.js'),
        `export default { name: "models-fixture", init(ctx) {
        ctx.routes.fetch(async (request) => {
          const body = await request.json()
          if (body.review) return Response.json(await ctx.capabilities.get("agents.reviewInput.v1").read({ taskId: "t", sessionId: "s", turnId: "u" }))
          if (body.control) return Response.json(await ctx.capabilities.get("agents.sessionControl").setConfig("t", "s", "effort", "high") ?? null)
          const controller = new AbortController()
          if (body.abortAfterMs) setTimeout(() => controller.abort(), body.abortAfterMs)
          try {
            const input = { system: "s", prompt: body.prompt ?? "p", maxOutputTokens: 100, signal: controller.signal }
            return Response.json({ text: (await ctx.core.models.generateText({ userId: body.userId ?? ctx.core.identity.active(), input })).text })
          } catch (error) { return Response.json({ code: error.code }) }
        })
      } }\n`,
      )
      await installPlugin(root, { path: source })
      const { loaded } = await loadExternalPlugins(root, { builtins: [] })
      const host = await initPlugins(
        loaded.map((entry) => entry.plugin),
        {
          ...options,
          core,
          dataDir: root,
          loaded: new Map(loaded.map((entry) => [entry.manifest.id, loadedPluginBinding(entry)])),
        },
      )
      const call = async (body: Record<string, unknown>) =>
        (
          await new Hono<AppEnv>()
            .use('/v1/*', ...testGate({ kind: 'device', userId: 'owner-1', deviceId: 'device-1' }))
            .all(`${PLUGIN_NAMESPACE}/:plugin/*`, dispatchPluginFetch)
            .fetch(
              new Request('http://acorn.test/v1/p/models-fixture/call', { method: 'POST', body: JSON.stringify(body) }),
              {} as Env,
            )
        ).json()
      const today = () => dayUsage(db.db, 'owner-1', 'models-fixture', localDay(Date.now()))

      expect(await call({})).toEqual({ code: 'provider_not_configured' })
      writeModelGrant(db.db, 'owner-1', 'models-fixture', {
        backendId: 'connection:key',
        modelId: '',
        dailyOutputTokens: 1_000,
      })
      expect(await call({ userId: 'someone-else' })).toEqual({ code: 'provider_bad_config' })
      expect(seen).toEqual([])

      expect(await call({})).toEqual({ text: 'reviewed' })
      expect(seen).toEqual([{ backendId: 'connection:key', aborted: false }])
      expect(today()).toMatchObject({ spent: 7, calls: 1 })

      // The worker's abort reaches the provider call, and the reservation stays charged.
      expect(await call({ prompt: 'wait', abortAfterMs: 20 })).toEqual({ code: 'provider_unavailable' })
      expect(seen.at(-1)).toEqual({ backendId: 'connection:key', aborted: true })
      expect(today()).toMatchObject({ spent: 107, calls: 2 })

      // Bounds and provenance arrive as the provider shaped them.
      expect(await call({ review: true })).toEqual(review)
      expect(await call({ control: true })).toBeNull()
      expect(changes).toEqual(['models-fixture effort=high'])
      await host.dispose()
    } finally {
      provided.dispose()
      controlled.dispose()
      clearRegistrations('models-fixture')
      db.cleanup()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
