import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import { pluginRouteContributions } from '@acorn/node-core/server/routeRegistry.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { getContextSections } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { SecretService } from '@acorn/node-core/main/core/index.ts'
import { nodePlugins } from '../../src/server/plugins'

// Phase 3's second exit criterion, node half (docs/vNext/plan.md § Phase 3): "disabling any non-required
// plugin at startup leaves the rest working (automated test cycles through each plugin disabled)".
//
// Both hosts have honoured a `disabled` list since Phase 2 and NOTHING populated it — Settings → Plugins is
// Phase 4 — so this is the flag's first consumer. That matters more than it sounds: the point is to discover
// now whether fifteen real plugins have a hidden dependency on each other's contributions, rather than when a
// user first unticks a box.
//
// Against the REAL list, not a fixture. host.test.ts already proves the `continue` statement works; what is
// unproven is that the real graph survives a hole in it. This boots the whole plugin set on a real temp data
// root — every plugin opens and migrates its own SQLite file — once per optional plugin.
//
// It drives `initPlugins` directly rather than `startServiceRuntime` for one reason: a full runtime boot also
// binds a TLS listener and starts a PTY engine per case, which for a dozen cases is minutes of wall clock for
// no extra coverage. Plugin composition is what is under test, and `service/runtime.test.ts` already proves the
// listener path. `disabledPlugins` is plumbed through the service config for Phase 4's UI either way.

const desktop: DesktopCapabilities = {
  preview: {
    currentUrl: async () => null,
    loadUrl: async () => false,
    navState: async () => null,
    navigate: async () => false,
    evict: async () => false,
  },
  browser: {
    navigate: async () => ({ ok: false }),
    snapshot: async () => ({ error: 'not available' }),
    click: async () => ({ ok: false }),
    fill: async () => ({ ok: false }),
    screenshot: async () => ({ error: 'not available' }),
    console: async () => ({ lines: [] }),
  },
}

// The deps the composition root supplies. Stubs, not fakes: nothing here is exercised by init — what is under
// test is which contributions land, and every plugin's init that does I/O does it against its own database.
const buildPlugins = (dataDir: string) =>
  nodePlugins(dataDir, {
    agents: {
      internalEnv: () => ({}),
      currentUserId: () => 'james',
      memoryReviewTrigger: async () => undefined,
    },
    memory: { currentUserId: () => 'james' },
    preview: { browser: desktop.browser },
    terminal: {
      internalEnv: () => ({}),
      launchInjector: async () => undefined,
      memoryReviewTrigger: async () => undefined,
      seedTaskNotes: async () => undefined,
      reconciled: Promise.resolve(),
    },
    workflows: {
      internalEnv: () => ({}),
      reconciled: Promise.resolve(),
      currentUserId: () => 'james',
      memoryReviewTrigger: async () => undefined,
      failingChecks: async () => null,
    },
  } as never)

type Snapshot = { routes: string[]; tools: string[]; sections: string[]; databases: string[] }

describe('disabling a node plugin', () => {
  let dataDir: string
  let coreDb: TestDb
  let dispose: (() => Promise<void>) | null = null

  beforeEach(() => {
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    dataDir = mkdtempSync(join(tmpdir(), 'acorn-plugin-disable-'))
    // A REAL migrated core database, not a stub. plugins/http's `ready()` asks core whether this node knows
    // exactly one owner identity, which is a query — so a stubbed CoreServices fails the boot rather than
    // testing it, and that failure would look exactly like the coupling this suite is hunting.
    coreDb = makeTestDb()
  })

  afterEach(async () => {
    // Dispose BEFORE removing the directory: every plugin database is WAL-mode, and the host's own contract is
    // that a plugin closes its handle before the data root goes away.
    await dispose?.()
    dispose = null
    coreDb.cleanup()
    rmSync(dataDir, { recursive: true, force: true })
  })

  const start = async (disabled?: readonly string[]): Promise<{ enabled: readonly string[]; skipped: readonly string[]; snapshot: Snapshot }> => {
    const { initPlugins } = await import('@acorn/node-core/server/plugin/host.ts')
    const { CapabilityRegistry } = await import('@acorn/node-core/server/plugin/capabilities.ts')
    const capabilities = new CapabilityRegistry()
    const result = await initPlugins(buildPlugins(dataDir), {
      capabilities,
      core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: coreDb.db }),
      disabled,
    })
    dispose = result.dispose
    return {
      enabled: result.enabled,
      skipped: result.skipped,
      snapshot: {
        routes: pluginRouteContributions().map((c) => `${c.plugin}${c.prefix}`).sort(),
        tools: agentToolContributions().map((t) => t.name).sort(),
        sections: getContextSections().map((s) => s.id),
        // Proof the plugin actually opened its own file, which a stubbed init could not fake.
        databases: readdirSync(join(dataDir, 'plugins'), { withFileTypes: true })
          .filter((e) => e.isFile() && e.name.endsWith('.sqlite'))
          .map((e) => e.name)
          .sort(),
      },
    }
  }

  const all = buildPlugins('/unused')
  const optional = all.filter((p) => !p.required).map((p) => p.name)
  const required = all.filter((p) => p.required).map((p) => p.name)

  it('has a plugin list worth cycling (anti-vacuity)', () => {
    // Every case below asserts "the others are still there", which an empty list satisfies trivially.
    expect(all.length).toBeGreaterThanOrEqual(15)
    expect(optional.length).toBeGreaterThanOrEqual(8)
    expect(required.sort()).toEqual(['agents', 'github', 'memory', 'notes', 'terminal'])
  })

  it('boots the whole set with nothing disabled', async () => {
    const { enabled, skipped, snapshot } = await start()
    expect(skipped).toEqual([])
    expect(enabled).toEqual(all.map((p) => p.name))
    // Sanity on the baseline the cases below compare against.
    expect(snapshot.sections).toEqual(['pr', 'notes', 'memory'])
    expect(snapshot.databases.length).toBeGreaterThanOrEqual(8)
    expect(snapshot.routes.length).toBeGreaterThanOrEqual(15)
  })

  for (const name of optional) {
    it(`boots, and keeps every other plugin contribution, with '${name}' disabled`, async () => {
      const full = await start()
      await dispose?.()
      dispose = null
      const reduced = await start([name])

      expect(reduced.skipped).toEqual([name])
      expect(reduced.enabled).toEqual(full.enabled.filter((n) => n !== name))

      // Nothing may APPEAR that was not there before — a plugin filling in for a disabled sibling would be a
      // hidden coupling, not a feature — and nothing belonging to another plugin may disappear.
      for (const key of ['routes', 'tools', 'sections'] as const) {
        const gained = reduced.snapshot[key].filter((id) => !full.snapshot[key].includes(id))
        expect(gained, `${key} gained entries with '${name}' disabled`).toEqual([])
      }
      // Routes are namespaced by plugin, so the ONLY ones that may vanish are the disabled plugin's.
      const lostRoutes = full.snapshot.routes.filter((id) => !reduced.snapshot.routes.includes(id))
      expect(lostRoutes.every((id) => id.startsWith(name))).toBe(true)
    })
  }

  it('ignores the flag for a required plugin', async () => {
    const { enabled, skipped } = await start(required)
    expect(skipped).toEqual([])
    expect(enabled).toEqual(all.map((p) => p.name))
  })
})
