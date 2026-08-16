import { afterEach, describe, expect, it } from 'vitest'
import { agentContextRegistry } from '@acorn/client-core/registries/agentContexts.ts'
import { agentToolRendererRegistry } from '@acorn/client-core/registries/agentToolRenderers.ts'
import { contextSectionRegistry } from '@acorn/client-core/registries/contextSections.ts'
import { paletteRowRegistry } from '@acorn/client-core/registries/paletteRows.ts'
import { attentionRegistry } from '@acorn/client-core/registries/attention.ts'
import { collectionRegistry } from '@acorn/client-core/registries/collections.ts'
import { nodeStatRegistry } from '@acorn/client-core/registries/nodeStats.ts'
import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import { initClientPlugins, type ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { pollerRegistry } from '@acorn/client-core/registries/pollers.ts'
import { refPanelRegistry } from '@acorn/client-core/registries/refPanels.ts'
import { settingsRegistry } from '@acorn/client-core/registries/settings.ts'
import { taskSlotRegistry, uiSlotRegistry } from '@acorn/client-core/registries/slots.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { persistedStateRegistry } from '@acorn/client-core/persistence/persistedState.ts'
import { contentLinkRegistry } from '@acorn/client-core/registries/contentLinks.ts'
import { projectImporterRegistry } from '@acorn/client-core/registries/projectImporters.ts'
import { clientPlugins } from '../../src/app/client/plugins'
import { readGolden, writeGolden } from './golden'

const REGISTRIES = {
  panes: paneRegistry,
  sources: sourceRegistry,
  settingsPages: settingsRegistry,
  slots: uiSlotRegistry,
  taskSlots: taskSlotRegistry,
  contextSections: contextSectionRegistry,
  refPanels: refPanelRegistry,
  paletteRows: paletteRowRegistry,
  agentContexts: agentContextRegistry,
  agentToolRenderers: agentToolRendererRegistry,
  pollers: pollerRegistry,
  persistedState: persistedStateRegistry,
  nodeStats: nodeStatRegistry,
  attention: attentionRegistry,
  collections: collectionRegistry,
  contentLinks: contentLinkRegistry,
  projectImporters: projectImporterRegistry,
} as const

type RegistryName = keyof typeof REGISTRIES
type Snapshot = Record<RegistryName, readonly string[]>

const REGISTRY_NAMES = Object.keys(REGISTRIES) as RegistryName[]

// A builder rather than `Object.fromEntries(...) as Snapshot`: fromEntries widens the key to `string`,
// so the cast would be the only thing standing between a typo'd registry name and a green suite.
const build = (make: (name: RegistryName) => readonly string[]): Snapshot => {
  const out = {} as Record<RegistryName, readonly string[]>
  for (const name of REGISTRY_NAMES) out[name] = make(name)
  return out
}

// Ids in registration order, NOT sorted: the order is part of what must survive a sibling's disable.
// Two slot registries hold entries whose ids only differ by which slot they fill, so the slot is folded
// into the key.
const snapshot = (): Snapshot =>
  build((name) =>
    REGISTRIES[name].entries().map((entry) => {
      const slot = (entry as { slot?: unknown }).slot
      return typeof slot === 'string' ? `${slot}/${entry.id}` : entry.id
    }),
  )

// Multiset subtraction — remove ONE occurrence per expected id, so a duplicate vanishing is visible — and
// report what never matched.
const minus = (from: readonly string[], take: readonly string[]): { rest: string[]; unmatched: string[] } => {
  const remaining = [...take]
  const rest: string[] = []
  for (const id of from) {
    const at = remaining.indexOf(id)
    if (at === -1) rest.push(id)
    else remaining.splice(at, 1)
  }
  return { rest, unmatched: remaining }
}

const without = (base: Snapshot, owned: Partial<Snapshot>): Snapshot =>
  build((name) => {
    const { rest, unmatched } = minus(base[name], owned[name] ?? [])
    // A hand-edited golden claiming an id the full activation never produced would otherwise pass silently:
    // subtracting a ghost removes nothing, so the equality still holds. Only reachable by hand-editing, since
    // the derivation below can only record ids it saw.
    if (unmatched.length) throw new Error(`golden names ${name} entries the full activation never produced: ${unmatched.join(', ')}`)
    return rest
  })

const activate = (disabled: readonly string[] = []) => {
  const result = initClientPlugins(clientPlugins, { disabled })
  return { result, snap: snapshot() }
}

const NAMES = clientPlugins.map((plugin) => plugin.name)
const OPTIONAL = clientPlugins.filter((plugin) => !plugin.required).map((plugin) => plugin.name)
const REQUIRED = clientPlugins.filter((plugin) => plugin.required).map((plugin) => plugin.name)

// The complete contribution set, plus what each OPTIONAL plugin owns — the entries that must vanish when it
// is disabled and, by omission, the ones that must not. A GOLDEN LIST in `clientPluginDisable.snapshot.json`
// now, derived by the loop below and regenerated with the one command in ./golden.ts.
//
// `panes` and `sources` are docs/ui-design.md contracts in their own right, so `full` doubles as the parity
// assertion for the compiled graph. Loaded packages are covered through their manifest adapters and do not
// belong in this static ownership ledger. `refPanels` held exactly one compiled entry when this was
// written — none — and the note here said that a compiled panel reappearing would be a real change. It
// did: `github-pull` is github's own pull-request panel, so a PR link clicked inside someone else's
// content can be glanced at instead of leaving the app. Linear's panel is still absent from this ledger
// and still correct, because linear is a loaded package and its panel reaches the registry through the
// manifest adapter in client-core/plugins/frames/register.ts rather than through a compiled roster line.
//
// Derived, but not therefore toothless, and the distinction matters because a snapshot you can regenerate
// looks like one you can launder a regression past. What regeneration CANNOT hide:
//   - a plugin whose disable removes a SIBLING's entry still shows up, as that entry appearing in the wrong
//     plugin's slice — a one-line diff a reviewer reads, which is the same review surface the facade's
//     surface snapshot has;
//   - a plugin whose disable ADDS something cannot be recorded at all. The derivation only records what a
//     boot LOST, so an addition leaves the exact equality below failing however often you regenerate;
//   - a plugin that contributes nothing gets an empty slice, which the anti-vacuity case rejects.
// The ledger stays deliberately brittle: a plugin gaining or losing a contribution SHOULD fail this file and
// be re-recorded, because that is the same edit that could take a sibling's contribution with it.
type Golden = { full: Snapshot; owned: Record<string, Partial<Snapshot>> }

const derive = (): Golden => {
  const full = activate().snap
  const owned: Record<string, Partial<Snapshot>> = {}
  for (const name of OPTIONAL) {
    const reduced = activate([name]).snap
    const slice: Partial<Snapshot> = {}
    // Registries the plugin does not touch are omitted, so the slice reads as a claim rather than a form.
    for (const key of REGISTRY_NAMES) {
      const lost = minus(full[key], reduced[key]).rest
      if (lost.length) slice[key] = lost
    }
    owned[name] = slice
  }
  activate()
  return { full, owned }
}

const GOLDEN = 'clientPluginDisable.snapshot.json'
// Guarded on the flag as well as inside `writeGolden`, so a normal run does not pay for the extra
// activate-per-optional-plugin cycle just to throw the result away.
if (process.env.UPDATE_PLUGIN_GOLDENS) writeGolden(GOLDEN, derive())
const { full: FULL, owned: OWNED } = readGolden<Golden>(GOLDEN)

describe('disabling a client plugin', () => {
  afterEach(() => void activate())

  it('has a plugin list worth cycling (anti-vacuity)', () => {
    // Down one per plugin that ships loaded instead of compiled — linear, then http, then database.
    expect(NAMES.length).toBeGreaterThanOrEqual(12)
    expect([...REQUIRED].sort()).toEqual(['agents', 'memory', 'notes', 'terminal'])
    expect(OPTIONAL.length).toBeGreaterThanOrEqual(8)
    // Every optional plugin is in the ledger, and every ledger entry claims something. A plugin
    // contributing nothing would make its own case below pass vacuously — this fails instead.
    expect(Object.keys(OWNED).sort()).toEqual([...OPTIONAL].sort())
    for (const name of OPTIONAL) {
      const owned = OWNED[name]
      expect(REGISTRY_NAMES.reduce((sum, key) => sum + (owned[key]?.length ?? 0), 0), name).toBeGreaterThan(0)
    }
  })

  it('activates every plugin with nothing disabled', () => {
    const { result, snap } = activate()
    expect(snap).toEqual(FULL)
    expect(result.skipped).toEqual([])
    expect(result.enabled).toEqual(NAMES)
  })

  it('re-activation is idempotent rather than a duplicate-id throw', () => {
    // The registries throw on a duplicate id, so this is the property that makes the whole cycle
    // possible — and the reason the host disposes a plugin's prior contributions before re-registering.
    // Settings → Plugins re-runs the host on every node switch, so it is a production path now.
    expect(() => activate()).not.toThrow()
    expect(snapshot()).toEqual(FULL)
  })

  it('ignores the disabled flag for a required plugin', () => {
    const { result, snap } = activate(REQUIRED)
    expect(snap).toEqual(FULL)
    expect(result.skipped).toEqual([])
  })

  it.each(OPTIONAL)('boots the rest when %s is disabled', (name) => {
    const { result, snap } = activate([name])
    expect(snap).toEqual(without(FULL, OWNED[name]))
    expect(result.skipped).toEqual([name])
    expect(result.enabled).toEqual(NAMES.filter((candidate) => candidate !== name))
  })

  it('performs no browser I/O during init', () => {
    const initOnly: ClientPlugin[] = clientPlugins.map(({ activate: _activate, ...rest }) => rest)
    const globals = globalThis as unknown as Record<string, unknown>
    const saved = { localStorage: globals.localStorage, fetch: globals.fetch }
    delete globals.localStorage
    delete globals.fetch
    try {
      expect(() => initClientPlugins(initOnly)).not.toThrow()
    } finally {
      Object.assign(globals, saved)
    }
  })
})
