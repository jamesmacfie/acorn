import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DesktopCapabilities } from '@acorn/protocol/desktopCapabilities.ts'
import { pluginRouteContributions } from '@acorn/node-core/server/routeRegistry.ts'
import { agentToolContributions } from '@acorn/node-core/server/agentTools/registry.ts'
import { getContextSections } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { connectionProviderRegistry } from '@acorn/node-core/server/integrations/connectionRegistry.ts'
import { integrationProviderRegistry } from '@acorn/node-core/server/integrations/registry.ts'
import { modelProviderRegistry } from '@acorn/node-core/server/modelProviders/registry.ts'
import type { PluginRosterEntry } from '@acorn/node-core/server/plugin/host.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { SecretService } from '@acorn/node-core/main/core/index.ts'
import { nodePlugins } from '../../src/server/plugins'
import { readGolden, writeGolden } from './golden'

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

// The deps the composition root supplies. These are stubs, not fakes, because nothing here runs
// during init. The test is which contributions land, and each plugin's init that does I/O does it
// against its own database.
const buildPlugins = (dataDir: string) =>
  nodePlugins(dataDir, {
    agents: {
      internalEnv: () => ({}),
      memoryReviewTrigger: async () => undefined,
    },
    preview: { browser: desktop.browser },
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

// Every registry a node plugin can write to, including the three provider registries (why connection
// and integration are separate lists: docs/integrations.md § Connection and integration
// contributions). linear has since moved to the loaded tier, so github is the only provider-owning
// plugin left in this graph. The provider keys stay snapshotted for its sake; `providerRoutes` and
// `modelProviders` are asserted empty in the baseline case.
type Snapshot = {
  routes: string[]
  tools: string[]
  sections: string[]
  connectionProviders: string[]
  integrationProviders: string[]
  providerRoutes: string[]
  modelProviders: string[]
  databases: string[]
}
const SNAPSHOT_KEYS = ['routes', 'tools', 'sections', 'connectionProviders', 'integrationProviders', 'providerRoutes', 'modelProviders', 'databases'] as const

// The full boot's contribution set, and what each optional plugin owns within it: every entry that
// must vanish when it's disabled, and by omission every entry that must not. Recorded as a golden
// snapshot in pluginDisable.snapshot.json; docs/plugins.md § The golden lists covers the mechanism,
// why the comparison is exact equality in both directions, and what a regeneration can and can't
// catch.
//
// No optional plugin owns a context section here: all four belong to required plugins (`pr` →
// github, `notes` → notes, `memory` → memory) or to core itself (`issues`), so `sections` comes out
// of every case below byte-identical.
type Golden = { full: Snapshot; owned: Record<string, Partial<Snapshot>> }
const GOLDEN = 'pluginDisable.snapshot.json'
// Read per assertion rather than once at module scope, so a regenerating run writes the file before the
// cases below read it back.
const golden = (): Golden => readGolden<Golden>(GOLDEN)

// Multiset subtraction: remove each expected entry once, leave the rest in order, report what didn't
// match. docs/plugins.md § The golden lists covers why a plain filter is wrong here.
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
  // An expectation that matched nothing means the ledger and the code disagree about what this plugin owns.
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
    // boot, so a stubbed CoreServices would fail the boot instead of testing it, which looks exactly
    // like the coupling this suite exists to catch.
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
    const { initPlugins } = await import('@acorn/node-core/server/plugin/host.ts')
    const { CapabilityRegistry } = await import('@acorn/node-core/server/plugin/capabilities.ts')
    const { Scheduler, SCHEDULER } = await import('@acorn/node-core/server/schedules/index.ts')
    const capabilities = new CapabilityRegistry()
    // Provided before the plugins, matching both composition roots (docs/schedules.md § Why the
    // node, and only the node). Never started: this suite asserts on what a boot registers, and a
    // running scheduler would mean a fixture firing jobs at a temp data root while the assertions
    // run.
    capabilities.provide(SCHEDULER, new Scheduler(coreDb.db))
    const result = await initPlugins(buildPlugins(dataDir), {
      capabilities,
      core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: coreDb.db, activeIdentity: memoryIdentityStore() }),
        // The host opens every plugin database under this root now, which is what the `databases`
        // snapshot below reads back, so passing it is no longer a courtesy to the plugins, it is
        // the boot.
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
        // The three provider registries (why connection and integration are separate:
        // docs/integrations.md § Connection and integration contributions). `modelProviders` comes
        // out empty here and stays snapshotted anyway: model-providers is a loaded package now, so
        // this compiled-only boot never registers an adapter, and an entry appearing here would mean
        // one had started registering again. `providerRoutes` is the entry that would strand first
        // if host.ts ever cleared the registries in the wrong order, since it's the last of the four
        // things `ctx.providers.integration(p, router)` registers.
        connectionProviders: connectionProviderRegistry.list().map((p) => p.id).sort(),
        integrationProviders: integrationProviderRegistry.list().map((p) => p.id).sort(),
        providerRoutes: integrationProviderRegistry.routes().map((r) => `${r.providerId}${r.prefix}`).sort(),
        modelProviders: modelProviderRegistry.list().map((a) => a.providerId).sort(),
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

  // Regeneration, and nothing else: one full boot plus one per optional plugin, recording what each
  // disable lost. Declared before the cases below because those read the file back, and declared
  // only when the flag is set so a normal run neither pays for the extra boots nor reports a
  // permanently skipped test.
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
      // Seven real boots, each opening its own WAL-mode plugin databases. Not a 5s job.
      180_000,
    )
  }

  it('has a plugin list worth cycling (anti-vacuity)', () => {
    // Every case below asserts "the others are still there", which an empty list satisfies trivially.
    // These floors track the compiled list, so they drop by one each time a plugin ships loaded
    // instead: rollbar, then linear, then model-providers, then http, now database.
    expect(all.length).toBeGreaterThanOrEqual(10)
    expect(optional.length).toBeGreaterThanOrEqual(6)
    // Hand-written, and the only list in this file that is: docs/plugins.md § The golden lists
    // covers why.
    expect(required.sort()).toEqual(['agents', 'memory', 'notes', 'terminal'])
    // The ledger covers exactly the plugins that get cycled. A plugin added to the list without an
    // entry fails here rather than quietly getting a case that asserts nothing.
    expect(Object.keys(golden().owned).sort()).toEqual([...optional].sort())
    // And every one of them owns something. Without this check, a refactor that stopped ten plugins
    // from registering anything would leave all ten cases green, since "the others are still there"
    // is trivially true when there was nothing to be there in the first place.
    for (const [name, owned] of Object.entries(golden().owned)) {
      const total = SNAPSHOT_KEYS.reduce((n, key) => n + (owned[key]?.length ?? 0), 0)
      expect(total, `'${name}' contributes nothing, so disabling it proves nothing`).toBeGreaterThan(0)
    }
  })

  it('boots the whole set with nothing disabled', async () => {
    const { enabled, skipped, snapshot } = await start()
    expect(skipped).toEqual([])
    expect(enabled).toEqual(all.map((p) => p.name))
    // Floors first: the anti-vacuity half. The equality below is against a file, so a boot that
    // registered nothing would match an empty golden without anyone noticing. Six databases, not
    // eight: http.sqlite and database.sqlite are opened by their own loaded packages through
    // ctx.storage now (docs/data-layer.md § Plugin databases), so this boot never sees either. The
    // connection and integration registries need real content too, github's, or the ledger's
    // provider expectations would be satisfiable by an empty registry.
    expect(snapshot.databases.length).toBeGreaterThanOrEqual(6)
    expect(snapshot.routes.length).toBeGreaterThanOrEqual(15)
    expect(snapshot.connectionProviders.length).toBeGreaterThan(0)
    expect(snapshot.integrationProviders.length).toBeGreaterThan(0)
    // The exact record: two of the golden's keys come out empty by design. openai, anthropic and
    // linear's provider route belong to loaded packages this boot never assembles, so either key
    // gaining an entry would mean the binary had started registering them again.
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

      // One exact equality per registry, checked in both directions at once: docs/plugins.md § The
      // golden lists covers why. A plugin filling in for a disabled sibling would break the equality
      // just as losing an entry would, so that's caught here too, not just outright removal.
      const owned = golden().owned[name]
      for (const key of SNAPSHOT_KEYS) {
        expect(reduced.snapshot[key], `${key} after disabling '${name}'`).toEqual(without(full.snapshot[key], owned?.[key]))
      }
      // Routes carry their owner in the key: docs/plugins.md § The golden lists covers why this
      // attribution check exists.
      const lostRoutes = owned?.routes ?? []
      expect(lostRoutes.filter((id) => !id.startsWith(name))).toEqual([])
    })
  }

  // The standalone shape, called out on its own: docs/agent-tools.md § Context sections covers why
  // core's `issues` section survives a boot that never calls `wireAgentTools`.
  it("registers core's own 'issues' section without wireAgentTools (the standalone shape)", async () => {
    const { snapshot } = await start()
    const issues = getContextSections().find((s) => s.id === 'issues')
    expect(snapshot.sections).toContain('issues')
    expect(issues?.label).toBe('Linked issues')
    // It's core's own section, which is why it's the one that still receives the database handle:
    // docs/agent-tools.md § Context sections.
    expect(issues?.defaultIncluded).toBe(true)
  })

  it('ignores the flag for a required plugin', async () => {
    const { enabled, skipped, roster } = await start(required)
    expect(skipped).toEqual([])
    expect(enabled).toEqual(all.map((p) => p.name))
    // And the roster says so too, which is what Settings → Plugins renders: a required plugin named in
    // the disabled list is still `disabled: false`, so the page cannot offer a checkbox that would not
    // stick.
    expect(roster.filter((entry) => entry.disabled)).toEqual([])
  })

  it('reports a roster covering every offered plugin, including the skipped ones', async () => {
    // `enabled` plus `skipped` isn't the list Settings → Plugins needs: it says nothing about which
    // names are `required` and therefore not togglable, and a disabled plugin still has to appear as
    // a row. Two optional plugins, in roster order. It was `['docker', 'http']` until http moved out
    // of the compiled graph, and `['database', 'docker']` until database followed it, the same
    // substitution linear's migration forced for the same reason, three times now.
    const { roster } = await start(['changes', 'docker'])
    expect(roster.map((entry) => entry.name)).toEqual(all.map((p) => p.name))
    expect(roster.filter((entry) => entry.required).map((entry) => entry.name).sort()).toEqual(required.sort())
    expect(roster.filter((entry) => entry.disabled).map((entry) => entry.name)).toEqual(['changes', 'docker'])
  })
})
