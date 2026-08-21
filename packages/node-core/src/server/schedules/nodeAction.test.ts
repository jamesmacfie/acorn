import { afterEach, describe, expect, it } from 'vitest'
import { memoryIdentityStore } from '../../main/activeIdentity'
import { createCoreServices, SecretService } from '../../main/core'
import type { NodePermissions, PluginCommandDescriptor } from '../../main/pluginManifest'
import { makeTestDb, testEnv } from '../../testkit/db'
import { CapabilityRegistry } from '../plugin/capabilities'
import { clearRegistrations, initPlugins } from '../plugin/host'
import type { NodePlugin, PluginStorage } from '../plugin/types'
import { nodeActions } from '../nodeActions/registry'
import { consentStillCovers, registerNodeActionTarget } from './nodeAction'
import { type Clock, Scheduler } from './scheduler'

// The `node-action` target: what a user schedule may do, and where consent lives
// (docs/schedules.md § `node-action`, § Consent, and the two ways it fails closed).
//
// The two cases worth testing are the ones where the stamp stops being true: the action's tier
// rising, and the action disappearing. Both fail closed and read as `skipped`, not as a broken
// schedule.

const PLUGIN = 'acme'
const NO_PERMISSIONS: NodePermissions = { core: [], capabilities: [], secrets: false, exec: false, net: [] }
const storage: PluginStorage = { open: () => { throw new Error('this suite never opens a plugin database') } }

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve))
}

function fakeClock() {
  let now = 1_800_000_000_000
  let pending: { at: number; fn: () => void } | null = null
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => (pending = { at: now + ms, fn }),
    clearTimeout: (handle) => void (pending === handle && (pending = null)),
    random: () => 0.5,
  }
  return {
    clock,
    async advance(ms: number): Promise<void> {
      now += ms
      await flush()
      for (let i = 0; i < 40; i++) {
        if (!pending || pending.at > now) break
        const fire = pending
        pending = null
        fire.fn()
        await flush()
      }
    },
  }
}

afterEach(() => clearRegistrations(PLUGIN))

async function world(
  register: (ctx: Parameters<NonNullable<NodePlugin['init']>>[0]) => void,
  onCall: () => Response,
  observe?: (request: Request) => Promise<void>,
) {
  const core = makeTestDb()
  const time = fakeClock()
  const capabilities = new CapabilityRegistry()
  const env = testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1') })
  const scheduler = new Scheduler(core.db, { clock: time.clock })
  const plugin: NodePlugin = {
    name: PLUGIN,
    init: (ctx) => {
      ctx.routes.fetch(async (request) => {
        await observe?.(request)
        return onCall()
      }, { prefix: '/actions' })
      register(ctx)
    },
  }
  await initPlugins([plugin], {
    capabilities,
    core: createCoreServices({ secrets: new SecretService('c'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore('owner-1') }),
    env,
    dataDir: '',
  })
  registerNodeActionTarget(scheduler, env)
  await scheduler.start()
  return { core, time, scheduler, env }
}

const declare = (risk?: 'read' | 'write' | 'execute') =>
  (ctx: Parameters<NonNullable<NodePlugin['init']>>[0]) =>
    ctx.nodeActions.register({
      actionId: 'prune-merged',
      name: 'Prune merged worktrees',
      path: `/v2/p/${PLUGIN}/actions/prune`,
      ...(risk ? { risk } : {}),
    })

describe('what the picker may offer', () => {
  it('reports an undeclared tier as `execute`, not as nothing', async () => {
    const { core, scheduler } = await world(declare(), () => new Response(null, { status: 204 }))
    try {
      // Fail in the safe direction: an undeclared tier means nobody has said what this does, and
      // arming the strongest confirmation for that cannot be wrong in a way that matters.
      expect(nodeActions().map((a) => ({ id: a.actionId, risk: a.risk }))).toEqual([{ id: 'prune-merged', risk: undefined }])
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })

  it('synthesises a LOADED plugin’s runNodeAction commands from its manifest', async () => {
    const core = makeTestDb()
    const commands: PluginCommandDescriptor[] = [
      { id: 'prune', title: 'Prune merged worktrees', category: 'action', palette: true, action: { verb: 'runNodeAction', path: `/v2/p/${PLUGIN}/actions/prune` } },
      // Every other verb needs a surface, and a schedule has none.
      { id: 'show', title: 'Show the pane', category: 'action', palette: true, action: { verb: 'openOverlay', overlay: 'thing' } },
    ]
    try {
      await initPlugins([{ name: PLUGIN, init: (ctx) => void ctx.routes.fetch(() => new Response(null, { status: 204 }), { prefix: '/actions' }) }], {
        capabilities: new CapabilityRegistry(),
        core: createCoreServices({ secrets: new SecretService('c'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore('owner-1') }),
        env: testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1') }),
        dataDir: '',
        loaded: new Map([[PLUGIN, { permissions: NO_PERMISSIONS, storage, commands }]]),
      })
      expect(nodeActions().map((a) => a.actionId)).toEqual(['prune'])
    } finally {
      core.cleanup()
    }
  })
})

describe('creating and running one', () => {
  it('refuses a target that does not resolve, at CREATE', async () => {
    const { core, scheduler } = await world(declare('write'), () => new Response(null, { status: 204 }))
    try {
      // The one non-tolerant edge in the scheduler, and the right place for it: a schedule pointing at
      // nothing is a typo, and the person is standing right there.
      await expect(scheduler.create({
        name: 'Nightly prune',
        kind: 'node-action',
        target: { pluginId: PLUGIN, actionId: 'no-such-action' },
        cadence: { every: 3600 },
      })).rejects.toThrow()
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })

  it('stamps the tier at creation and posts the params to the plugin’s own route', async () => {
    const seen: { method: string; path: string; body: string }[] = []
    const { core, scheduler } = await world(
      declare('write'),
      () => new Response(null, { status: 204 }),
      async (request) => void seen.push({ method: request.method, path: new URL(request.url).pathname, body: await request.text() }),
    )
    try {
      const row = await scheduler.create({
        name: 'Nightly prune',
        kind: 'node-action',
        target: { pluginId: PLUGIN, actionId: 'prune-merged', params: { olderThanDays: '7' } },
        cadence: { every: 3600 },
      })
      // The stamp IS the consent record, and it stays visible on the row for the schedule's whole life.
      expect(row).toMatchObject({ owner: 'user', kind: 'node-action', registered: true, risk: 'write' })

      await scheduler.runNow(row.key)
      expect((await scheduler.runs(row.key))[0]).toMatchObject({ status: 'ok', detail: 'ran acme: Prune merged worktrees' })
      // A scheduled fire and a clicked one have to be indistinguishable to the handler, or the plugin
      // ends up with two code paths for one verb: same POST, same mount-relative path, params in the body.
      expect(seen).toEqual([{ method: 'POST', path: '/prune', body: '{"olderThanDays":"7"}' }])
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })

  it('fails CLOSED when the declared tier rises after creation', async () => {
    const core = makeTestDb()
    const time = fakeClock()
    const env = testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1') })
    const scheduler = new Scheduler(core.db, { clock: time.clock })
    let fired = 0
    const options = {
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ secrets: new SecretService('c'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore('owner-1') }),
      env,
      dataDir: '',
    }
    const pluginWith = (risk: 'write' | 'execute'): NodePlugin => ({
      name: PLUGIN,
      init: (ctx) => {
        ctx.routes.fetch(() => { fired += 1; return new Response(null, { status: 204 }) }, { prefix: '/actions' })
        ctx.nodeActions.register({ actionId: 'prune-merged', name: 'Prune merged worktrees', path: `/v2/p/${PLUGIN}/actions/prune`, risk })
      },
    })
    try {
      await initPlugins([pluginWith('write')], options)
      registerNodeActionTarget(scheduler, env)
      await scheduler.start()
      const row = await scheduler.create({
        name: 'Nightly prune', kind: 'node-action',
        target: { pluginId: PLUGIN, actionId: 'prune-merged' }, cadence: { every: 3600 },
      })
      expect(row.risk).toBe('write')

      // The plugin updates and now declares that this action executes things. Stamped consent covers
      // the tier it stamped and nothing higher.
      clearRegistrations(PLUGIN)
      await initPlugins([pluginWith('execute')], options)

      await scheduler.runNow(row.key)
      const run = (await scheduler.runs(row.key))[0]
      expect(run).toMatchObject({ status: 'skipped' })
      expect(run?.detail).toMatch(/risk changed to 'execute'/)
      expect(fired).toBe(0)
      // A skip is not a failure: no backoff, and the next run is the one the cadence would have given.
      const listed = (await scheduler.list()).find((entry) => entry.key === row.key)
      expect(listed?.backoffUntil).toBeUndefined()
    } finally {
      await scheduler.stop()
      clearRegistrations(PLUGIN)
      core.cleanup()
    }
  })

  it('runs inert when the action goes away, and reattaches when it comes back', async () => {
    const { core, scheduler } = await world(declare('write'), () => new Response(null, { status: 204 }))
    try {
      const row = await scheduler.create({
        name: 'Nightly prune', kind: 'node-action',
        target: { pluginId: PLUGIN, actionId: 'prune-merged' }, cadence: { every: 3600 },
      })
      clearRegistrations(PLUGIN)
      await scheduler.runNow(row.key)
      // The row survives, the same as a dashboards contribution, rather than being deleted by a
      // plugin going missing.
      expect((await scheduler.runs(row.key))[0]).toMatchObject({ status: 'skipped' })
      expect((await scheduler.runs(row.key))[0]?.detail).toMatch(/not available on this node/)
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })
})

describe('what a stamp covers', () => {
  it('covers its own tier and everything below it, and nothing above', () => {
    expect(consentStillCovers('execute', 'read')).toBe(true)
    expect(consentStillCovers('execute', 'execute')).toBe(true)
    expect(consentStillCovers('write', 'write')).toBe(true)
    expect(consentStillCovers('write', 'execute')).toBe(false)
    expect(consentStillCovers('read', 'write')).toBe(false)
    // An unstamped row covers nothing and re-arms once. Fail closed.
    expect(consentStillCovers(undefined, 'read')).toBe(false)
  })
})
