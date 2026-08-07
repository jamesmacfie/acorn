// The client half of plan.md § Phase 3's second exit criterion: "disabling any non-required plugin at
// startup leaves the rest working". `apps/node/test/integration/pluginDisable.test.ts` has proven the
// NODE half since Phase 3; this is the twin, and it is the file phase3-notes.md called impossible and
// then corrected itself about. It cycles the REAL sixteen-plugin list, not synthetic fixtures —
// `packages/client-core/src/registries/plugin.test.ts` already covers the host's semantics.
//
// Same shape as the node file, with one correction to it. The node version derives its `OWNED` ledger by
// diffing a full boot against each disabled boot; the ledger here is a LITERAL, because a derived one
// co-varies with the very bug it is meant to catch. Neuter the host's disabled check and a derived
// ledger goes empty, `full − {} === full`, and the registry equality passes while nothing is disabled at
// all. Measured: with a derived ledger the only line that failed was `expect(skipped).toEqual([name])` —
// the host's own self-report, which is precisely the trap Phase 3 shipped. A literal cannot do that.
//
// Keeping it literal costs one edit when a plugin gains a contribution. That is the point: a
// contribution appearing or vanishing should be a reviewed line, not a silent diff.
import { describe, expect, it } from 'vitest'
import { agentContextRegistry } from '@acorn/client-core/registries/agentContexts.ts'
import { agentToolRendererRegistry } from '@acorn/client-core/registries/agentToolRenderers.ts'
import { contextSectionRegistry } from '@acorn/client-core/registries/contextSections.ts'
import { paletteRowRegistry } from '@acorn/client-core/registries/paletteRows.ts'
import { nodeStatRegistry } from '@acorn/client-core/registries/nodeStats.ts'
import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import { initClientPlugins, type ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { pollerRegistry } from '@acorn/client-core/registries/pollers.ts'
import { refPanelRegistry } from '@acorn/client-core/registries/refPanels.ts'
import { settingsRegistry } from '@acorn/client-core/registries/settings.ts'
import { taskSlotRegistry, uiSlotRegistry } from '@acorn/client-core/registries/slots.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { persistedStateRegistry } from '@acorn/client-core/persistence/persistedState.ts'
import { contentLinkRegistry } from '@acorn/plugin-github/client/contentLinks.ts'
import { clientPlugins } from '../../src/app/client/plugins'

// Every registry a ClientPluginContext can write to, plus the one a PLUGIN publishes (github's content
// links, reached through `ctx.contribute`). The plugin-published one is here deliberately: it is the
// entry whose disposal Phase 3 shipped broken, so a regression there has to fail something. It never
// varies across the cycle — github is `required` — but its two module-scope built-ins plus the one
// contributed entry are exactly what a broken `contribute` path would disturb.
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
  contentLinks: contentLinkRegistry,
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

// The complete contribution set, as a literal. `panes` and `sources` are ui.md contracts in their own
// right (13 panes, 6 default sources), so this doubles as the parity assertion for both.
const FULL: Snapshot = {
  panes: ['agents', 'changes', 'context', 'database', 'docker', 'editor', 'search', 'pr', 'http', 'linear', 'notes', 'preview', 'rollbar'],
  sources: ['agents', 'docker', 'github', 'http', 'linear', 'rollbar'],
  settingsPages: ['agent-pricing', 'docker', 'http', 'terminal', 'workflows'],
  slots: ['overlay/palette.files', 'overlay/palette.pull-files', 'overlay/onboarding.first-run', 'topbar.right/terminal.topbar-toggle', 'drawer/terminal.drawer'],
  taskSlots: ['task.footer/docker-footer-badge', 'tabrail.task-row/docker-rail-badge'],
  contextSections: ['memory.section'],
  refPanels: ['linear.issue-panel'],
  paletteRows: ['terminal.run', 'workflows.defs'],
  agentContexts: ['acorn-task-context', 'acorn-database', 'acorn-docker', 'acorn-http', 'acorn-terminals'],
  agentToolRenderers: ['changes.agent-file-tool'],
  pollers: ['docker.task-containers', 'workflows.triggers'],
  persistedState: ['context.section-selection', 'docker.prefs', 'editor.open-files', 'github.pr-filters'],
  nodeStats: ['agents.active'],
  contentLinks: ['github.pull-request', 'github.repository', 'linear.issue'],
}

// What each OPTIONAL plugin owns. Registries it does not touch are omitted.
const OWNED: Record<string, Partial<Snapshot>> = {
  changes: { panes: ['changes'], agentToolRenderers: ['changes.agent-file-tool'] },
  context: { panes: ['context'], agentContexts: ['acorn-task-context'], persistedState: ['context.section-selection'] },
  database: { panes: ['database'], agentContexts: ['acorn-database'] },
  docker: {
    panes: ['docker'],
    sources: ['docker'],
    settingsPages: ['docker'],
    taskSlots: ['task.footer/docker-footer-badge', 'tabrail.task-row/docker-rail-badge'],
    agentContexts: ['acorn-docker'],
    pollers: ['docker.task-containers'],
    persistedState: ['docker.prefs'],
  },
  editor: { panes: ['editor', 'search'], slots: ['overlay/palette.files'], persistedState: ['editor.open-files'] },
  http: { panes: ['http'], sources: ['http'], settingsPages: ['http'], agentContexts: ['acorn-http'] },
  linear: { panes: ['linear'], sources: ['linear'], refPanels: ['linear.issue-panel'] },
  onboarding: { slots: ['overlay/onboarding.first-run'] },
  preview: { panes: ['preview'] },
  rollbar: { panes: ['rollbar'], sources: ['rollbar'] },
  workflows: { settingsPages: ['workflows'], paletteRows: ['workflows.defs'], pollers: ['workflows.triggers'] },
}

// Multiset subtraction — remove ONE occurrence per expected id, so a duplicate vanishing is visible.
const subtract = (from: readonly string[], take: readonly string[]): string[] => {
  const remaining = [...from]
  for (const id of take) {
    const at = remaining.indexOf(id)
    if (at >= 0) remaining.splice(at, 1)
  }
  return remaining
}

const without = (base: Snapshot, owned: Partial<Snapshot>): Snapshot =>
  build((name) => subtract(base[name], owned[name] ?? []))

const activate = (disabled: readonly string[] = []) => {
  const result = initClientPlugins(clientPlugins, { disabled })
  return { result, snap: snapshot() }
}

const NAMES = clientPlugins.map((plugin) => plugin.name)
const OPTIONAL = clientPlugins.filter((plugin) => !plugin.required).map((plugin) => plugin.name)
const REQUIRED = clientPlugins.filter((plugin) => plugin.required).map((plugin) => plugin.name)

describe('disabling a client plugin', () => {
  it('has a plugin list worth cycling (anti-vacuity)', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(16)
    // The five the node half marks `required`. Reconciled in Phase 4: `memory` and `notes` were
    // togglable here and not on the node, so a user could have turned off half of one plugin.
    expect([...REQUIRED].sort()).toEqual(['agents', 'github', 'memory', 'notes', 'terminal'])
    expect(OPTIONAL.length).toBeGreaterThanOrEqual(10)
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
    // The registry equality comes FIRST, deliberately. Phase 3's node-side version asserted the host's
    // own `skipped` self-report first, so every mutation it was checked against failed on that line and
    // the contribution assertions were never exercised. ONE equality per registry, both directions:
    // this plugin's entries gone, every sibling's contribution byte-identical and in the same order,
    // and nothing new appeared.
    expect(snap).toEqual(without(FULL, OWNED[name]))
    expect(result.skipped).toEqual([name])
    expect(result.enabled).toEqual(NAMES.filter((candidate) => candidate !== name))
    activate()
  })

  it('performs no browser I/O during init', () => {
    // The property `ClientPlugin.init`'s doc comment claims and two plugins used to break: plugins/http
    // enumerated `localStorage` and plugins/agents issued a `fetch`, both inside a synchronous `init`.
    // Stripping `activate` and removing the two globals is the mechanical check — if a third plugin
    // joins them, this throws rather than passing quietly because the setup file happened to stub them.
    const initOnly: ClientPlugin[] = clientPlugins.map(({ activate: _activate, ...rest }) => rest)
    const globals = globalThis as unknown as Record<string, unknown>
    const saved = { localStorage: globals.localStorage, fetch: globals.fetch }
    delete globals.localStorage
    delete globals.fetch
    try {
      expect(() => initClientPlugins(initOnly)).not.toThrow()
    } finally {
      Object.assign(globals, saved)
      activate()
    }
  })
})
