import { describe, expect, it } from 'vitest'
import { paneRegistry } from '@acorn/client-core/host/registries/panes/panes.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints'
import { coreSourceContributions } from '../../src/client/sourceContributions'
import { clientPlugins } from '../../src/client/plugins'
import { readGolden, writeGolden } from './golden'

initClientPlugins(clientPlugins)
for (const source of coreSourceContributions) sourceRegistry.register(source)

// Compiled-client parity: the built-in panes with their shipped order and chords, and the rail sources
// in rail order. Both are golden lists in `parity.snapshot.json` now (see ./golden.ts for the command
// that regenerates them), so contributing a pane or a source becomes a reviewed snapshot diff instead
// of a CI failure against a hand-edited table. Rows are `<order> <id> <chord|->` for panes and
// `<order> <id>` for sources, sorted by order then id, which is the shipped rail/tab order.
//
// The snapshot cannot say why things are absent from it, so the absences live here.
//
// Loaded frames are asserted by their package's own e2e coverage instead of being folded back into
// this static graph, which is why `linear` (90, ⌘⇧L) and `http` (76, ⌘⇧H) are missing even though those
// panes and their chords still exist: both are manifest data now, in each plugin's own
// acorn-plugin.config.mjs, and the chords stay unique because no compiled pane may claim them. `http`'s
// rail source (50) left with its pane for the same reason: it is a manifest descriptor now and the
// host draws the rows.
//
// No `search` pane at 60 any more: find-in-files is a panel in the editor pane's sidebar
// (docs/panes.md), and ⌘⇧F is now an editor command that opens this pane on that panel, so the chord
// survives without a pane to hang it on.
//
// No `database` pane at 70 either, for a different reason: it left the compiled graph entirely. It is
// a loaded package whose pane is a `document-over-frame` layout (the host draws the SQL editor, the
// plugin's frame draws the grid), so it reaches the registry through the manifest adapter in
// client-core/host/frames/register.ts. ⌘⏎ went with it, as a surface-scoped keybinding.
//
// Core Home is the stable default; Fleet is additive and gated on a second node. Provider browse
// sources remain optional contributions.
const PARITY = 'parity.snapshot.json'

const railOrder = <T>(rows: ReadonlyArray<readonly [number, string, T]>): string[] =>
  rows
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    .map((row) => (row[2] === undefined ? `${row[0]} ${row[1]}` : `${row[0]} ${row[1]} ${row[2]}`))

const parity = {
  panes: railOrder(paneRegistry.entries().map((pane) => [pane.order, pane.id, pane.defaultChord ?? '-'] as const)),
  // Read from the registry rather than through `availableSources`: that accessor applies the provider
  // gate, so github vanishes without a connected integration, which is why this check belongs in a unit
  // test rather than there. Loaded sources have their own descriptor/runtime coverage.
  sources: railOrder(sourceRegistry.entries().map((source) => [source.order, source.id, undefined] as const)),
}

writeGolden(PARITY, parity)
const PARITY_GOLDEN = readGolden<typeof parity>(PARITY)

describe('docs/panes.md § Shipped panes', () => {
  it('is exactly the compiled panes, in their shipped order, with their shipped chords', () => {
    expect(parity.panes).toEqual(PARITY_GOLDEN.panes)
  })

  it('gives every chord to exactly one pane', () => {
    // A duplicate would resolve at runtime through the keybinding registry's conflict rules rather than
    // throw, so the pane that lost would simply stop responding to its chord: silent, and exactly the
    // kind of thing a per-pane assertion above cannot see. Reading off the registry rather than the
    // golden file catches it, since a regeneration would happily record the duplicate.
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

describe('docs/frontend/rail-and-routing.md § Rail sources', () => {
  it('is exactly the core and provider sources, in rail order', () => {
    expect(parity.sources).toEqual(PARITY_GOLDEN.sources)
  })

  it('hides Fleet home until a second node is paired', () => {
    // Fleet exists only once more than one node is paired
    // (docs/architecture/fleet.md § Client state and fleet behavior). The gate is a `when` on the
    // contribution, so it is checkable here without a rendered rail.
    const fleet = sourceRegistry.entries().find((source) => source.id === 'fleet')
    expect(fleet?.when).toBeTypeOf('function')
    expect(fleet?.when?.()).toBe(false) // no fleet store in a unit test ⇒ zero nodes ⇒ hidden
  })
})
