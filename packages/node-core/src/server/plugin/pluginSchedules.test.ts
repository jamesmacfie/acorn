import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { memoryIdentityStore } from '../../main/activeIdentity'
import { createCoreServices, SecretService } from '../../main/core'
import type { NodePermissions, PluginScheduleDescriptor } from '../../main/pluginManifest'
import { makeTestDb, testEnv } from '../../testkit/db'
import { schema } from '../db'
import { type Clock, Scheduler } from '../schedules/scheduler'
import { SCHEDULER } from '../schedules'
import { CapabilityRegistry } from './capabilities'
import { clearRegistrations, initPlugins } from './host'
import type { NodePlugin, PluginStorage } from './types'

// The two feeders, one registry (docs/schedules.md). A built-in registers a function through
// `ctx.schedules`; a loaded plugin declares a route in its manifest and the host mints the runner. Both
// have to land on the same scheduler, under the same `<pluginId>:<id>` key, with the same clamps, and
// both have to survive the lifecycle table, which is the part a fake would never catch.

const PLUGIN = 'acme'
const NO_PERMISSIONS: NodePermissions = { core: [], capabilities: [], secrets: false, exec: false, net: [] }
const storage: PluginStorage = {
  open: () => {
    throw new Error('this suite never opens a plugin database')
  },
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve))
}

function fakeClock() {
  let now = 1_800_000_000_000
  let pending: { at: number; fn: () => void } | null = null
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => (pending = { at: now + ms, fn }),
    clearTimeout: (handle) => {
      if (pending === handle) pending = null
    },
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

describe('plugin schedules', () => {
  // A loaded plugin: one fetch route under its own namespace, and a manifest that says to POST it hourly.
  const declared: PluginScheduleDescriptor = {
    id: 'refresh',
    name: 'Refresh the mirror',
    run: `/v2/p/${PLUGIN}/schedules/refresh`,
    cadence: { every: 3600 },
    timeout: 120,
  }

  const world = () => {
    const core = makeTestDb()
    const time = fakeClock()
    const capabilities = new CapabilityRegistry()
    const scheduler = new Scheduler(core.db, { clock: time.clock })
    capabilities.provide(SCHEDULER, scheduler)
    return {
      core,
      time,
      scheduler,
      options: {
        capabilities,
        core: createCoreServices({ secrets: new SecretService('c'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore('owner-1') }),
        env: testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore('owner-1') }),
        dataDir: '',
      },
    }
  }

  it('fires a manifest-declared schedule through the plugin’s own route, POSTing its id', async () => {
    const { core, time, scheduler, options } = world()
    const seen: { method: string; path: string; body: string; userId: string }[] = []
    const plugin: NodePlugin = {
      name: PLUGIN,
      init: (ctx) => {
        ctx.routes.fetch(async (request, context) => {
          seen.push({
            method: request.method,
            path: new URL(request.url).pathname,
            body: await request.text(),
            userId: context.userId,
          })
          return new Response(null, { status: 204 })
        }, { prefix: '/schedules' })
      },
    }

    try {
      await initPlugins([plugin], { ...options, loaded: new Map([[PLUGIN, { permissions: NO_PERMISSIONS, storage, schedules: [declared] }]]) })
      await scheduler.start()

      const rows = await scheduler.list()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ key: 'acme:refresh', owner: 'plugin', pluginId: PLUGIN, name: 'Refresh the mirror', registered: true })

      await time.advance(3_600_000)
      // Mount-relative, exactly as an HTTP-served handler sees it, and as the node's own service
      // principal. There is no device here.
      expect(seen).toEqual([{ method: 'POST', path: '/refresh', body: '{"scheduleId":"refresh"}', userId: 'owner-1' }])
      expect((await scheduler.runs('acme:refresh'))[0]).toMatchObject({ status: 'ok' })
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })

  it('records a failing route as a failed run rather than taking the node with it', async () => {
    const { core, time, scheduler, options } = world()
    const plugin: NodePlugin = {
      name: PLUGIN,
      init: (ctx) => void ctx.routes.fetch(() => new Response('the mirror is down', { status: 502 }), { prefix: '/schedules' }),
    }
    try {
      await initPlugins([plugin], { ...options, loaded: new Map([[PLUGIN, { permissions: NO_PERMISSIONS, storage, schedules: [declared] }]]) })
      await scheduler.start()
      await time.advance(3_600_000)
      const run = (await scheduler.runs('acme:refresh'))[0]
      expect(run?.status).toBe('error')
      expect(run?.detail).toContain('502')
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })

  it('clamps a plugin’s cadence to the 300s floor, whichever feeder declared it', async () => {
    const { core, scheduler, options } = world()
    const plugin: NodePlugin = {
      name: PLUGIN,
      // The compiled tier: a function, and seconds for the timeout exactly as the manifest spells it.
      init: (ctx) => ctx.schedules.register({ scheduleId: 'poll', name: 'Poll', cadence: { every: 30 }, timeout: 30, run: async () => {} }),
    }
    try {
      await initPlugins([plugin], options)
      await scheduler.start()
      // Declared under a plugin key, so the plugin floor applies on read. 30s would be a poll, and
      // polling belongs to a client with a person in front of it.
      await scheduler.patch('acme:poll', { cadence: { every: 30 } })
      expect((await scheduler.list())[0]?.cadence).toEqual({ every: 300 })
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })

  it('moves a schedule to the new instance on reload, twice, without colliding on its own key', async () => {
    const { core, time, scheduler, options } = world()
    const bodies: string[] = []
    const instance = (tag: string): NodePlugin => ({
      name: PLUGIN,
      init: (ctx) => void ctx.routes.fetch(() => {
        bodies.push(tag)
        return new Response(null, { status: 204 })
      }, { prefix: '/schedules' }),
    })
    const binding = { permissions: NO_PERMISSIONS, storage, schedules: [declared] }
    try {
      const host = await initPlugins([instance('v1')], { ...options, loaded: new Map([[PLUGIN, binding]]) })
      await scheduler.start()

      expect(await host.reload(PLUGIN, { plugin: instance('v2'), binding })).toEqual({ ok: true })
      // The second one is the case the commit path had to be taught: without handing the committed
      // candidate's undos to the host, this reload would ask the scheduler to register 'acme:refresh'
      // while the first reload's copy was still on it.
      expect(await host.reload(PLUGIN, { plugin: instance('v3'), binding })).toEqual({ ok: true })

      await time.advance(3_600_000)
      expect(bodies).toEqual(['v3'])
      expect(await scheduler.list()).toHaveLength(1)
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })

  it('keeps the state row when the plugin goes and reattaches it when it comes back', async () => {
    const { core, scheduler, options } = world()
    const loaded = new Map([[PLUGIN, { permissions: NO_PERMISSIONS, storage, schedules: [declared] }]])
    const plugin: NodePlugin = {
      name: PLUGIN,
      init: (ctx) => void ctx.routes.fetch(() => new Response(null, { status: 204 }), { prefix: '/schedules' }),
    }
    try {
      const host = await initPlugins([plugin], { ...options, loaded })
      await scheduler.start()
      // The owner pauses it. That is an override, and it has to outlive the definition.
      await scheduler.patch('acme:refresh', { enabled: false })

      await host.dispose()
      clearRegistrations(PLUGIN)
      const gone = (await scheduler.list())[0]
      expect(gone).toMatchObject({ key: 'acme:refresh', registered: false })
      expect(await core.db.select().from(schema.scheduleState).where(eq(schema.scheduleState.key, 'acme:refresh'))).toHaveLength(1)

      // Back it comes: same key, same pause, and no second registration despite the first host's run.
      await initPlugins([plugin], { ...options, loaded })
      const back = (await scheduler.list())[0]
      expect(back).toMatchObject({ key: 'acme:refresh', registered: true, enabled: false })
    } finally {
      await scheduler.stop()
      core.cleanup()
    }
  })
})
