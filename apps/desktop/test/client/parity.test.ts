import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { initClientPlugins } from '@acorn/client-core/registries/plugin.ts'
import { THEMES } from '@acorn/client-core/settings/themes.ts'
import { STYLES } from '@acorn/client-core/settings/uiStyles.ts'
import { coreSourceContributions } from '../../src/app/client/sourceContributions'
import { clientPlugins } from '../../src/app/client/plugins'
import { readGolden, writeGolden } from './golden'

initClientPlugins(clientPlugins)
for (const source of coreSourceContributions) sourceRegistry.register(source)

// Compiled-client parity: the built-in panes with their shipped order and chords, and the rail sources in
// rail order. Both are GOLDEN LISTS in `parity.snapshot.json` now — see ./golden.ts for the one command that
// regenerates them — so contributing a pane or a source is a reviewed snapshot diff instead of a CI failure
// with a hand-edited table behind it. Rows are `<order> <id> <chord|->` for panes and `<order> <id>` for
// sources, sorted by order then id, which is the shipped rail/tab order.
//
// What the snapshot cannot say for itself is why things are ABSENT from it, so the absences live here:
//
// Loaded frames are asserted by their package/e2e coverage instead of being smuggled back into this static
// graph — which is why `linear` (90, ⌘⇧L) and `http` (76, ⌘⇧H) are missing even though those panes and their
// chords still exist: both are manifest data now, in each plugin's own acorn-plugin.config.mjs, and the
// chords are still unique because no compiled pane may claim them. `http`'s rail source (50) left with its
// pane, for the same reason — it is a manifest descriptor now and the host draws the rows.
//
// No `search` pane at 60 any more: find-in-files is a panel in the editor pane's sidebar (docs/panes.md), and
// ⌘⇧F is now an editor COMMAND that opens this pane on that panel — so the chord survives without a pane to
// hang it on, and this file is the wrong place to look for it.
//
// No `database` pane at 70 either, and for a different reason than search's: it left the compiled graph
// entirely. It is a loaded package whose pane is a `document-over-frame` layout — the host draws the SQL
// editor, the plugin's frame draws the grid — so it reaches the registry through the manifest adapter in
// client-core/plugins/frames/register.ts. ⌘⏎ went with it, as a surface-scoped keybinding.
//
// Core Home is the stable default; Fleet is additive and gated on a second node. Provider browse sources
// remain optional contributions.
const PARITY = 'parity.snapshot.json'

const railOrder = <T>(rows: ReadonlyArray<readonly [number, string, T]>): string[] =>
  rows
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    .map((row) => (row[2] === undefined ? `${row[0]} ${row[1]}` : `${row[0]} ${row[1]} ${row[2]}`))

const parity = {
  panes: railOrder(paneRegistry.entries().map((pane) => [pane.order, pane.id, pane.defaultChord ?? '-'] as const)),
  // Read from the REGISTRY rather than through `availableSources`, deliberately: that accessor applies the
  // provider gate, so github vanishes without a connected integration — which is exactly why this belongs in
  // a unit test. Loaded sources have their own descriptor/runtime coverage.
  sources: railOrder(sourceRegistry.entries().map((source) => [source.order, source.id, undefined] as const)),
}

writeGolden(PARITY, parity)
const PARITY_GOLDEN = readGolden<typeof parity>(PARITY)

describe('docs/ui-design.md § Parity — the panes', () => {
  it('is exactly the compiled panes, in their shipped order, with their shipped chords', () => {
    expect(parity.panes).toEqual(PARITY_GOLDEN.panes)
  })

  it('gives every chord to exactly one pane', () => {
    // A duplicate would resolve at runtime through the keybinding registry's conflict rules rather than
    // throwing, so the pane that lost would simply stop responding to its chord — silent, and precisely
    // the kind of thing a per-pane assertion above cannot see. Read off the REGISTRY, not the golden: a
    // regeneration would happily record the duplicate, and this is the check that must not be regenerable.
    const chords = paneRegistry
      .entries()
      .map((pane) => pane.defaultChord)
      .filter(Boolean)
    expect(new Set(chords).size).toBe(chords.length)
  })

  it('has a compiled graph worth snapshotting (anti-vacuity)', () => {
    // The two assertions above are exact matches against a file, so an activation that registered nothing
    // would pass against an empty golden without anyone noticing. Floors, not counts: the compiled tier is
    // the shrinking one by decision, so these come down as plugins ship loaded instead.
    expect(parity.panes.length).toBeGreaterThanOrEqual(8)
    expect(parity.sources.length).toBeGreaterThanOrEqual(5)
  })
})

describe('docs/ui-design.md § Parity — the rail sources', () => {
  it('is exactly the core and provider sources, in rail order', () => {
    expect(parity.sources).toEqual(PARITY_GOLDEN.sources)
  })

  it('hides Fleet home until a second node is paired', () => {
    // docs/ui-design.md § New surfaces: "With only the bundled local node, this view stays out of the way; first-run
    // never mentions nodes at all." The gate is a `when` on the contribution, so it is checkable here
    // without a rendered rail.
    const fleet = sourceRegistry.entries().find((source) => source.id === 'fleet')
    expect(fleet?.when).toBeTypeOf('function')
    expect(fleet?.when?.()).toBe(false) // no fleet store in a unit test ⇒ zero nodes ⇒ hidden
  })
})

describe('docs/ui-design.md § Parity — appearance', () => {
  it('offers 12 themes and 4 style packs', () => {
    // "12 themes × 4 style packs (the two-axis appearance system)". themes.test.ts and uiStyles.test.ts
    // already check each list against the stylesheets that define it — i.e. that nothing is offered
    // without a pack behind it. Neither checks the COUNTS docs/ui-design.md actually commits to, which is a
    // different claim: a theme quietly dropped from BOTH the picker and the stylesheet passes those
    // drift guards and fails parity.
    expect(THEMES()).toHaveLength(12)
    expect(STYLES()).toHaveLength(4)
  })
})

// The shell's own chords are registered inside `onMount` in TabRail and TaskView, so a registry snapshot
// cannot see them without rendering — and vitest here has no DOM and no Solid transform
// (CLAUDE.md: a green suite proves nothing about UI). Scanned from source instead, with comments
// STRIPPED, the way apps/node's standaloneParity.test.ts does and for the same reason: a commented-out
// declaration would otherwise satisfy the assertion.
//
// Note the asymmetry with tools/arch/boundaries.test.ts, which deliberately does NOT strip comments —
// there a comment produces a loud false positive; here it would produce a silent false negative.
const HERE = dirname(fileURLToPath(import.meta.url))
const sourceOf = (relative: string): string =>
  readFileSync(join(HERE, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')

describe('docs/ui-design.md § Parity — the shell chords', () => {
  const tabRail = sourceOf('../../../../packages/client-core/src/tabs/TabRail.tsx')
  const taskView = sourceOf('../../src/app/client/TaskView.tsx')
  const app = sourceOf('../../src/app/client/App.tsx')

  it('binds ⌘⇧T to the terminal drawer and ⌘⇧N to a new task', () => {
    expect(taskView).toContain("'meta+shift+t'")
    expect(tabRail).toContain("'meta+shift+n'")
  })

  it('binds ⌘1–9 to the first nine TASKS', () => {
    // The shell binds the first nine task slots, not pane focus. Keep this assertion beside the
    // implementation because the shortcut is registered dynamically from the task rail.
    expect(tabRail).toContain('task.activate.${index + 1}')
    expect(tabRail).toContain('meta+${index + 1}')
  })

  it('binds ⌘, to settings and ⌘⇧↵ to maximize', () => {
    expect(app).toContain("'meta+,'")
    expect(app).toContain("'meta+shift+enter'")
  })

  it('derives every pane chord from the pane contribution rather than a second list', () => {
    // The one structural claim here: a pane's chord lives on its contribution, so a plugin changing it
    // cannot leave a stale copy in the shell. If this line ever stops being how TaskView binds them,
    // the ledger above stops covering what the app actually does.
    expect(taskView).toContain('pane.defaultChord')
  })
})
