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

// The deps the composition root supplies. Stubs, not fakes: nothing here is exercised by init — what is under
// test is which contributions land, and every plugin's init that does I/O does it against its own database.
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

// Every registry a node plugin can write to. The three PROVIDER registries were missing, and that was not
// a gap at the margin: at the time providers were the ENTIRE contribution of linear, so its case could
// otherwise assert nothing whatsoever about the plugin it disabled. linear has since moved to the loaded
// tier and github is the only provider-owning plugin left in this graph, so the keys stay snapshotted for
// github's sake and `providerRoutes`/`modelProviders` are asserted EMPTY (see the baseline case).
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

// The full boot's contribution set, and what each optional plugin OWNS within it — every entry that must
// vanish when it is disabled, and by omission every entry that must not.
//
// A GOLDEN LIST in `pluginDisable.snapshot.json` now, derived by the regeneration block below and rewritten
// by the one command in ./golden.ts. It used to be this literal, hand-derived once by diffing boots and then
// hand-edited by every plugin that changed shape:
//
//   changes: { routes: ['changes/tasks', 'changes/tasks'], tools: ['git_log', …], databases: ['changes.sqlite'] }
//
// The mechanism is unchanged, and it is worth restating because a regenerable snapshot looks like one you can
// launder a regression past. Before this file stated the expectation at all it compared the two boots with
// `lostRoutes.every(id => id.startsWith(name))`, which is vacuously TRUE on an empty array — so a plugin that
// lost nothing passed, and so did a plugin that contributed nothing. Recording the expectation, wherever it
// is recorded, turns both into failures and turns the comparison below into an exact equality in both
// directions instead of a one-sided sanity check. What regeneration still cannot hide:
//   - a disable that ADDS an entry cannot be recorded. The derivation only records what a boot LOST, so the
//     equality below stays red however often you regenerate;
//   - a route credited to the wrong plugin fails the attribution assertion at the end of each case, which
//     reads the owner out of the route key rather than out of the ledger;
//   - a plugin that contributes nothing gets an empty slice, which the anti-vacuity case rejects;
//   - a ledger entry the full boot never produced throws out of `without` below.
// What is left for the reviewer is the snapshot diff — a disable that takes a SIBLING's entry with it shows
// up as that entry appearing in the wrong plugin's slice. Same review surface as the facade's own surface
// snapshot, and the reason the diff belongs in its own commit hunk.
//
// The ledger stays deliberately brittle: a plugin gaining or losing a route, tool, provider or database
// SHOULD fail this file and be re-recorded, because that is the same edit that could silently take a
// sibling's contribution with it.
//
// Note what is absent from every slice: no optional plugin owns a context SECTION. All four belong to
// required plugins (`pr` → github, `notes` → notes, `memory` → memory) or to core itself (`issues`), so
// `sections` comes out of every case below byte-identical — which is a real assertion here.
type Golden = { full: Snapshot; owned: Record<string, Partial<Snapshot>> }
const GOLDEN = 'pluginDisable.snapshot.json'
// Read per assertion rather than once at module scope, so a regenerating run writes the file before the
// cases below read it back.
const golden = (): Golden => readGolden<Golden>(GOLDEN)

// Multiset subtraction: remove each expected entry ONCE, leave the rest in order, and report what never
// matched.
//
// A plain `filter(x => !expected.includes(x))` would be wrong here and the reason is github: eleven of its
// routers register under the same `github/repos` key, and `changes` and `editor` each register two under one
// prefix. Set-style subtraction would delete all eleven for one expectation and, worse, would not notice
// github quietly losing ten of them. Counting makes the comparison sensitive to a duplicate disappearing,
// which is the only way "byte-identical" means anything for a key with repeats.
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
    // A REAL migrated core database, not a stub. At least one plugin's init queries core during the boot
    // this suite performs, so a stubbed CoreServices fails the boot rather than testing it — and that
    // failure would look exactly like the coupling this suite is hunting.
    coreDb = makeTestDb()
  })

  afterEach(async () => {
    // Dispose BEFORE removing the directory: every plugin database is WAL-mode, and the host's own contract is
    // that a plugin closes its handle before the data root goes away.
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
    // Provided BEFORE the plugins, exactly as both composition roots do it: a plugin declaring periodic
    // work resolves the scheduler through this capability at registration time, and a graph without one
    // throws. Never started — this suite asserts on what a boot REGISTERS, and a running loop would mean
    // a fixture that fires jobs at a temp data root while the assertions run.
    capabilities.provide(SCHEDULER, new Scheduler(coreDb.db))
    const result = await initPlugins(buildPlugins(dataDir), {
      capabilities,
      core: createCoreServices({ secrets: new SecretService('0'.repeat(64)), db: coreDb.db, activeIdentity: memoryIdentityStore() }),
      // The host opens every plugin database under this root now, which is what the `databases` snapshot
      // below reads back — so passing it is no longer a courtesy to the plugins, it is the boot.
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
        // The three provider registries. Connection and integration are separate lists on purpose (see
        // server/integrations/connectionRegistry.ts): a model provider is a CONNECTION provider without being
        // an integration one, so snapshotting only the integration list would miss the entire contribution of
        // a plugin whose only contribution is model adapters. `modelProviders` comes out empty here and stays
        // snapshotted regardless — model-providers is a LOADED package now and this file assembles only the
        // compiled list, so an entry appearing in it would mean something in the binary had quietly started
        // registering adapters. `providerRoutes` is the fourth thing a `ctx.providers.integration(p, router)`
        // call registers, and it is validated against a registered provider — so it is the entry that would
        // strand if the clear order in host.ts were ever reversed.
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

  // Regeneration, and nothing else: one full boot plus one per optional plugin, recording what each disable
  // LOST. Declared before the cases below because those read the file back, and declared only when the flag
  // is set so a normal run neither pays for the extra boots nor reports a permanently skipped test.
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
    // These floors track the COMPILED list, so they come down by one each time a plugin ships loaded
    // instead — rollbar, then linear, then model-providers, then http, now database.
    expect(all.length).toBeGreaterThanOrEqual(10)
    expect(optional.length).toBeGreaterThanOrEqual(6)
    // Hand-written on purpose, and the only list in this file that is. Which plugins may not be turned off is
    // POLICY, not something the composition can be asked — deriving it from `p.required` would make the
    // assertion "the required plugins are the ones marked required", which is no assertion at all. Changing
    // it should cost a deliberate edit here, not a regeneration.
    expect(required.sort()).toEqual(['agents', 'memory', 'notes', 'terminal'])
    // The ledger covers exactly the plugins that get cycled — a plugin added to the list without an entry
    // fails here rather than quietly getting a case that asserts nothing.
    expect(Object.keys(golden().owned).sort()).toEqual([...optional].sort())
    // And every one of them owns SOMETHING. Without this, a refactor that stopped ten plugins registering
    // anything at all would leave all ten cases green — that is the exact mutation the previous version
    // survived, because "the others are still there" is trivially true when there is nothing to be there.
    for (const [name, owned] of Object.entries(golden().owned)) {
      const total = SNAPSHOT_KEYS.reduce((n, key) => n + (owned[key]?.length ?? 0), 0)
      expect(total, `'${name}' contributes nothing, so disabling it proves nothing`).toBeGreaterThan(0)
    }
  })

  it('boots the whole set with nothing disabled', async () => {
    const { enabled, skipped, snapshot } = await start()
    expect(skipped).toEqual([])
    expect(enabled).toEqual(all.map((p) => p.name))
    // Floors first, and they are the anti-vacuity half: the equality below is against a file, so a boot that
    // registered nothing would match an empty golden without anyone noticing. Six databases, not eight:
    // http.sqlite and database.sqlite are opened by their loaded packages now, through ctx.storage, so this
    // boot never sees either. The connection and integration registries have to have real content — github's
    // — or the ledger's provider expectations would be satisfiable by an empty registry.
    expect(snapshot.databases.length).toBeGreaterThanOrEqual(6)
    expect(snapshot.routes.length).toBeGreaterThanOrEqual(15)
    expect(snapshot.connectionProviders.length).toBeGreaterThan(0)
    expect(snapshot.integrationProviders.length).toBeGreaterThan(0)
    // And then the exact record. Two of the golden's keys come out EMPTY and that is the assertion: openai
    // and anthropic come from the loaded model-providers package and linear's provider route from the loaded
    // linear package, neither of which this boot assembles, so an entry appearing in `modelProviders` or
    // `providerRoutes` would mean something in the binary had quietly started registering them again.
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

      // ONE exact equality per registry, and it says both directions at once: the disabled plugin's own
      // entries are gone (they are subtracted), every other plugin's survive byte for byte and in order
      // (`toEqual`, not a subset check), and nothing new appeared (an addition would break the equality just
      // as a removal would — a plugin filling in for a disabled sibling is a hidden coupling, not a feature).
      //
      // What the previous version checked instead: that no route which vanished failed to start with the
      // disabled plugin's name. That let four separate mutations through — the host clearing the registries
      // after the disabled check instead of before, every optional plugin registering nothing, a disable
      // dropping a sibling's tool or a context section, and a disable dropping the provider registrations
      // (which were not snapshotted at all).
      const owned = golden().owned[name]
      for (const key of SNAPSHOT_KEYS) {
        expect(reduced.snapshot[key], `${key} after disabling '${name}'`).toEqual(without(full.snapshot[key], owned?.[key]))
      }
      // Routes carry their owner in the key, so the removals can be attributed as well as counted. Kept as a
      // separate assertion because it catches a wrong LEDGER — an entry credited to the wrong plugin would
      // satisfy the equality above and still be a lie about who owns what. It is also the one check a
      // regeneration cannot launder: the owner comes out of the route key, not out of the golden.
      const lostRoutes = owned?.routes ?? []
      expect(lostRoutes.filter((id) => !id.startsWith(name))).toEqual([])
    })
  }

  // The standalone shape, called out on its own rather than left implicit in the baseline above.
  //
  // Every boot in this file is `initPlugins` with no `wireAgentTools` — the file does not import it — which is
  // exactly what apps/node/src/server/standalone.ts does for `pnpm dev:node` and for the node a client pairs
  // with over the LAN. Core's `issues` section was registered from that wiring function, so on this shape it
  // was simply absent: no error, just a Linked-issues row missing from the context pane, the assembled send
  // block and the launch injector. The registration is at module scope in contextSections.ts now.
  it("registers core's own 'issues' section without wireAgentTools (the standalone shape)", async () => {
    const { snapshot } = await start()
    const issues = getContextSections().find((s) => s.id === 'issues')
    expect(snapshot.sections).toContain('issues')
    expect(issues?.label).toBe('Linked issues')
    // It is core's section, so it is the one that still receives the database handle — the property that made
    // module scope viable in the first place (nothing to inject, nothing to order).
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
    // `enabled` + `skipped` is not the list Settings → Plugins needs: it says nothing about which names
    // are `required` and therefore not togglable, and a disabled plugin still has to appear as a row.
    // Two OPTIONAL plugins, in roster order. It was `['docker', 'http']` until http moved out of the
    // compiled graph, and `['database', 'docker']` until database followed it — the same substitution
    // linear's migration forced, for the same reason, three times now.
    const { roster } = await start(['changes', 'docker'])
    expect(roster.map((entry) => entry.name)).toEqual(all.map((p) => p.name))
    expect(roster.filter((entry) => entry.required).map((entry) => entry.name).sort()).toEqual(required.sort())
    expect(roster.filter((entry) => entry.disabled).map((entry) => entry.name)).toEqual(['changes', 'docker'])
  })
})
