import type { PanelDefinition } from './model'
import { panelSchema, unionRows, type PanelSourcePage } from './mapping'
import { aggregateRows, shapeRows } from './shaping'

// The panel's measure: the one number a stat shows, as a function of the source pages.
//
// Its own module because two callers need the same answer: the renderer composes these four steps as
// memos (client-core/dashboards/data.ts § createPanelData) and the node's measure sampler composes
// them once per pass with no reactivity in sight. Written twice, they would drift, and a stored
// history is only honest if it means what the number on screen means (docs/dashboards.md §
// Sampling and retention).
//
// The four steps, in order and nothing else: map the sources into one schema, union their rows,
// shape (filter/sort/limit), aggregate.

/** `null` when the panel asks for an aggregate over a field that is not there or holds no numbers.
 *  The stat renders that as an em dash rather than a fabricated 0, and the sampler records nothing
 *  rather than a zero that never happened. */
export function panelMeasure(panel: PanelDefinition, pages: readonly PanelSourcePage[]): number | null {
  const schema = panelSchema(pages, panel.mapping)
  const rows = shapeRows(unionRows(pages, panel.mapping), schema, panel.shaping)
  return aggregateRows(rows, schema, panel.view)
}
