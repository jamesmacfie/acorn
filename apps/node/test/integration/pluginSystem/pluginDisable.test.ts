import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pluginRouteContributions } from '@acorn/node-core/server/routeRegistry.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { getContextSections } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations/registry.ts'
import { modelProviderRegistry } from '@acorn/node-core/server/modelProviders/registry.ts'
import type { PluginRosterEntry } from '@acorn/node-core/server/pluginHost/host.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { SecretService } from '@acorn/node-core/server/core/index.ts'
import { nodePlugins } from '../../../src/composition/plugins'
import { readGolden, writeGolden } from '../../helpers/golden'

// Stubs, not fakes, because nothing here runs during init. The test is which contributions land, and
// a plugin's init that does I/O does it against its own database.
const buildPlugins = (dataDir: string) =>
  nodePlugins(dataDir, {
    agents: {
      internalEnv: () => ({}),
      memoryReviewTrigger: async () => undefined,
    },
    notes: { internalEnv: () => ({}) },
    terminal: {
      internalEnv: () => ({}),
      launchInjector: async () => undefined,
      memoryReviewTrigger: async () => undefined,
      reconciled: Promise.resolve(),
    },
    workflows: {
      internalEnv: () => ({}),
      reconciled: Promise.resolve(),
      memoryReviewTrigger: async () => undefined,
      failingChecks: async () => null,
    },
  } as never)

// Every registry a node plugin can write to. For why connection and integration are separate lists,
// see docs/integrations.md § Connection and integration contributions. github is the only
// provider-owning plugin left in this graph, so `providerRoutes` and `modelProviders` are asserted
// empty in the baseline case.
type Snapshot = {
  routes: string[]
  tools: string[]
  sections: string[]
  connectionProviders: string[]
  integrationProviders: string[]
  providerRoutes: string[]
  modelProviders: string[]
  capabilities: string[]
  databases: string[]
}
const SNAPSHOT_KEYS = ['routes', 'tools', 'sections', 'connectionProviders', 'integrationProviders', 'providerRoutes', 'modelProviders', 'capabilities', 'databases'] as const

// The full boot's contribution set, and what each optional plugin owns within it: every entry that
// must vanish when it's disabled, and by omission every entry that must not. Recorded in
// pluginDisable.snapshot.json. See docs/plugins.md § The golden lists.
//
// No optional plugin owns a context section. All four belong to required plugins (`pr` → github,
// `notes` → notes, `memory` → memory) or to core itself (`issues`), so `sections` is identical in
// every case below.
type Golden = { full: Snapshot; owned: Record<string, Partial<Snapshot>> }
const GOLDEN = join(import.meta.dirname, 'pluginDisable.snapshot.json')
// Read per assertion rather than once at module scope, so a regenerating run writes the file before
// the cases below read it back.
const golden = (): Golden => readGolden<Golden>(GOLDEN)

// Multiset subtraction: remove each expected entry once, leave the rest in order, report what didn't
// match. For why a plain filter is wrong here, see docs/plugins.md § The golden lists.
const minus = (from: readonly string[], take: readonly string[]): { rest: string[]; unmatched: string[] } => {
  const remaining = [...take]
  const rest: string[] = []
  for (const entry of from) {
    const at = remaining.indexOf(entry)
    if (at === -1) rest.push(entry)
    else remaining.splice(at, 1)
  }
  return { rest, unmatched: remaining }
}

const without = (from: readonly string[], expected: readonly string[] = []): string[] => {
  const { rest, unmatched } = minus(from, expected)
  // An expectation that matched nothing means the ledger and the code disagree about what this plugin
  // owns.
  if (unmatched.length) throw new Error(`ledger names entries that the full boot never produced: ${unmatched.join(', ')}`)
  return rest
}

describe('disabling a node plugin', () => {
  let dataRoots: string[]
  let coreDb: TestDb
  let dispose: (() => Promise<void>) | null = null

  beforeEach(() => {
    process.env.SESSION_ENC_KEY = '0'.repeat(64)
    dataRoots = []
    // A real migrated core database, not a stub. At least one plugin's init queries core during this
    // boot, so a stub would fail the boot instead of testing it.
    coreDb = makeTestDb()
  })

  afterEach(async () => {
    // Dispose before removing the directory. Every plugin database is WAL-mode, and the host's
    // contract is that a plugin closes its handle before the data root goes away.
    await dispose?.()
    dispose = null
    coreDb.cleanup()
    for (const root of dataRoots) rmSync(root, { recursive: true, force: true })
  })

  const start = async (disabled?: readonly string[]): Promise<{ enabled: readonly string[]; skipped: readonly string[]; roster: readonly PluginRosterEntry[]; snapshot: Snapshot }> => {
    const dataDir = mkdtempSync(join(tmpdir(), 'acorn-plugin-disable-'))
    dataRoots.push(dataDir)
    const { initPlugins } = await import('@acorn/node-core/server/pluginHost/host.ts')
    const { CapabilityRegistry } = await import('@acorn/node-core/server/pluginHost/capabilities.ts')
    const { Scheduler, SCHEDULER } = await import('@acorn/node-core/server/schedules/index.ts')
    const capabilities = new CapabilityRegistry()
    // Provided before the plugins, matching both composition roots (docs/schedules.md § Why the node,
    // and only the node). Never started, or a fixture would fire jobs at a temp data root while the
    // assertions run.
    capabilities.provide(SCHEDULER, new Scheduler(coreDb.db))
    const result = await initPlugins(buildPlugins(dataDir), {
      capabilities,
      core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: coreDb.db, activeIdentity: memoryIdentityStore() }),
        // The host opens every plugin database under this root, which is what the `databases`
        // snapshot below reads back.
      dataDir,
      disabled,
    })
    dispose = result.dispose
    return {
      enabled: result.enabled,
      skipped: result.skipped,
      roster: result.roster,
      snapshot: {
        routes: pluginRouteContributions().map((c) => `${c.plugin}${c.prefix}`).sort(),
        tools: agentToolContributions().map((t) => t.name).sort(),
        sections: getContextSections().map((s) => s.id),
        // The three provider registries. For why connection and integration are separate, see
        // docs/integrations.md § Connection and integration contributions. `modelProviders` comes out
        // empty because model-providers is a loaded package, so an entry here would mean the compiled
        // boot had started registering an adapter again. `providerRoutes` strands first if host.ts
        // clears the registries in the wrong order, being the last thing
        // `ctx.providers.integration(p, router)` registers.
        connectionProviders: connectionProviderRegistry.list().map((p) => p.id).sort(),
        integrationProviders: integrationProviderRegistry.list().map((p) => p.id).sort(),
        providerRoutes: integrationProviderRegistry.routes().map((r) => `${r.providerId}${r.prefix}`).sort(),
        modelProviders: modelProviderRegistry.list().map((a) => a.providerId).sort(),
        // The typed capability registry, which for some plugins is the whole contribution. `preview`
        // provides its page rules here and registers nothing else, so without this key the
        // anti-vacuity check below would call disabling it meaningless.
        capabilities: [...capabilities.ids()].sort(),
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

  // Regeneration only: one full boot plus one per optional plugin, recording what each disable lost.
  // Declared before the cases below because those read the file back, and only under the flag so a
  // normal run neither pays for the extra boots nor reports a permanently skipped test.
  if (process.env.UPDATE_PLUGIN_GOLDENS) {
    it(
      'records the full boot and the ownership ledger',
      async () => {
        const full = await start()
        const owned: Record<string, Partial<Snapshot>> = {}
        for (const name of optional) {
          await dispose?.()
          dispose = null
          const reduced = await start([name])
          const slice: Partial<Snapshot> = {}
          // Keys the plugin does not touch are omitted, so a slice reads as a claim rather than a form.
          for (const key of SNAPSHOT_KEYS) {
            const lost = minus(full.snapshot[key], reduced.snapshot[key]).rest
            if (lost.length) slice[key] = lost
          }
          owned[name] = slice
        }
        writeGolden(GOLDEN, { full: full.snapshot, owned })
      },
      // Seven real boots, each opening its own WAL-mode plugin databases.
      180_000,
    )
  }

  it('has a plugin list worth cycling (anti-vacuity)', () => {
    // Every case below asserts "the others are still there", which an empty list satisfies trivially.
    // These floors track the compiled list, so drop them by one each time a plugin ships loaded
    // instead.
    expect(all.length).toBeGreaterThanOrEqual(10)
    expect(optional.length).toBeGreaterThanOrEqual(6)
    // Hand-written, and the only list in this file that is. See docs/plugins.md § The golden lists.
    expect(required.sort()).toEqual(['agents', 'memory', 'notes', 'terminal'])
    // The ledger covers exactly the plugins that get cycled. A plugin added to the list without an
    // entry fails here rather than quietly getting a case that asserts nothing.
    expect(Object.keys(golden().owned).sort()).toEqual([...optional].sort())
    // And every one of them owns something. Without this check, a refactor that stopped ten plugins
    // registering anything would leave all ten cases green.
    for (const [name, owned] of Object.entries(golden().owned)) {
      const total = SNAPSHOT_KEYS.reduce((n, key) => n + (owned[key]?.length ?? 0), 0)
      expect(total, `'${name}' contributes nothing, so disabling it proves nothing`).toBeGreaterThan(0)
    }
  })

  it('boots the whole set with nothing disabled', async () => {
    const { enabled, skipped, snapshot } = await start()
    expect(skipped).toEqual([])
    expect(enabled).toEqual(all.map((p) => p.name))
    // Floors first, the anti-vacuity half. The equality below is against a file, so a boot that
    // registered nothing would match an empty golden. Six databases, not eight: http.sqlite and
    // database.sqlite belong to loaded packages that open them through ctx.storage
    // (docs/data-layer.md § Plugin databases), so this boot never sees either. The provider
    // registries need real content too, or the ledger's expectations pass against an empty registry.
    expect(snapshot.databases.length).toBeGreaterThanOrEqual(6)
    expect(snapshot.routes.length).toBeGreaterThanOrEqual(15)
    expect(snapshot.connectionProviders.length).toBeGreaterThan(0)
    expect(snapshot.integrationProviders.length).toBeGreaterThan(0)
    // Two of the golden's keys come out empty by design. openai, anthropic, and linear's provider
    // route belong to loaded packages this boot never assembles.
    expect(snapshot).toEqual(golden().full)
  })

  for (const name of optional) {
    it(`boots, and keeps every other plugin contribution, with '${name}' disabled`, async () => {
      const full = await start()
      await dispose?.()
      dispose = null
      const reduced = await start([name])

      expect(reduced.skipped).toEqual([name])
      expect(reduced.enabled).toEqual(full.enabled.filter((n) => n !== name))

      // One exact equality per registry, checked in both directions at once. See docs/plugins.md §
      // The golden lists. A plugin filling in for a disabled sibling breaks the equality too.
      const owned = golden().owned[name]
      for (const key of SNAPSHOT_KEYS) {
        expect(reduced.snapshot[key], `${key} after disabling '${name}'`).toEqual(without(full.snapshot[key], owned?.[key]))
      }
      // Routes carry their owner in the key. See docs/plugins.md § The golden lists.
      const lostRoutes = owned?.routes ?? []
      expect(lostRoutes.filter((id) => !id.startsWith(name))).toEqual([])
    })
  }

  // For why core's `issues` section survives a boot that never calls `wireAgentTools`, see
  // docs/agent-tools.md § Context sections.
  it("registers core's own 'issues' section without wireAgentTools (the standalone shape)", async () => {
    const { snapshot } = await start()
    const issues = getContextSections().find((s) => s.id === 'issues')
    expect(snapshot.sections).toContain('issues')
    expect(issues?.label).toBe('Linked issues')
    // Core's own section, so it's the one that still receives the database handle. See
    // docs/agent-tools.md § Context sections.
    expect(issues?.defaultIncluded).toBe(true)
  })

  it('ignores the flag for a required plugin', async () => {
    const { enabled, skipped, roster } = await start(required)
    expect(skipped).toEqual([])
    expect(enabled).toEqual(all.map((p) => p.name))
    // The roster says so too, which is what Settings → Plugins renders. A required plugin named in the
    // disabled list is still `disabled: false`, so the page cannot offer a checkbox that would not
    // stick.
    expect(roster.filter((entry) => entry.disabled)).toEqual([])
  })

  it('reports a roster covering every offered plugin, including the skipped ones', async () => {
    // `enabled` plus `skipped` isn't the list Settings → Plugins needs. It says nothing about which
    // names are `required` and therefore not togglable, and a disabled plugin still has to appear as a
    // row. Pick any two optional plugins, in roster order.
    const { roster } = await start(['changes', 'docker'])
    expect(roster.map((entry) => entry.name)).toEqual(all.map((p) => p.name))
    expect(roster.filter((entry) => entry.required).map((entry) => entry.name).sort()).toEqual(required.sort())
    expect(roster.filter((entry) => entry.disabled).map((entry) => entry.name)).toEqual(['changes', 'docker'])
  })
})
