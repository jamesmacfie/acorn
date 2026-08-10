import { afterEach, describe, expect, it } from 'vitest'
import { agentContextRegistry } from '@acorn/client-core/registries/agentContexts.ts'
import { agentToolRendererRegistry } from '@acorn/client-core/registries/agentToolRenderers.ts'
import { contextSectionRegistry } from '@acorn/client-core/registries/contextSections.ts'
import { paletteRowRegistry } from '@acorn/client-core/registries/paletteRows.ts'
import { attentionRegistry } from '@acorn/client-core/registries/attention.ts'
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

// The complete contribution set, as a literal. `panes` and `sources` are docs/ui-design.md contracts in their own
// right, so this doubles as the parity assertion for the compiled graph. Loaded packages are covered
// through their manifest adapters and do not belong in this static ownership ledger.
const FULL: Snapshot = {
  panes: ['agents', 'changes', 'context', 'database', 'docker', 'editor', 'search', 'pr', 'http', 'linear', 'notes', 'preview'],
  sources: ['agents', 'docker', 'github', 'http', 'linear'],
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
  attention: ['agents.sessions', 'memory.proposals'],
  contentLinks: ['github.pull-request', 'github.repository', 'linear.issue'],
  projectImporters: ['github'],
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
  // `linear.issue` belongs to linear now. It used to be registered by plugins/github, so disabling
  // linear left the recogniser behind — a link to a ticket the app could no longer open still claimed
  // to be handled in-app. Finding 10 moved the contribution to the plugin that can answer for it, and
  // this row is what says so.
  linear: { panes: ['linear'], sources: ['linear'], refPanels: ['linear.issue-panel'], contentLinks: ['linear.issue'] },
  onboarding: { slots: ['overlay/onboarding.first-run'] },
  preview: { panes: ['preview'] },
  github: {
    panes: ['pr'],
    sources: ['github'],
    slots: ['overlay/palette.pull-files'],
    projectImporters: ['github'],
    persistedState: ['github.pr-filters'],
    contentLinks: ['github.pull-request', 'github.repository'],
  },
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
  afterEach(() => void activate())

  it('has a plugin list worth cycling (anti-vacuity)', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(15)
    expect([...REQUIRED].sort()).toEqual(['agents', 'memory', 'notes', 'terminal'])
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
