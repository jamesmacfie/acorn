import type { PanelDefinition } from './model'
import { panelSchema, unionRows, type PanelSourcePage } from './mapping'
import { aggregateRows, shapeRows } from './shaping'

// The panel's MEASURE — the one number a `stat` shows — as a function of the source pages.
//
// It exists as its own module because two very different callers need the same answer: the renderer
// composes these four steps as memos (client-core/dashboards/data.ts § createPanelData), and the
// node's measure sampler composes them once per pass with no reactivity anywhere in sight
// (docs/dashboards.md § Trends). Written twice, they would agree until the
// day someone changed one — and the whole point of recording history is that a stored number means
// the same thing as the number on screen.
//
// The four steps ARE the pipeline, in order and with nothing else in it: map the sources into one
// schema, union their rows, shape (filter/sort/limit), aggregate.

/** `null` when the panel asks for an aggregate over a field that is not there or holds no numbers —
 *  the stat draws an em dash rather than a fabricated 0, and the sampler records nothing rather than
 *  a zero that never happened. */
export function panelMeasure(panel: PanelDefinition, pages: readonly PanelSourcePage[]): number | null {
  const schema = panelSchema(pages, panel.mapping)
  const rows = shapeRows(unionRows(pages, panel.mapping), schema, panel.shaping)
  return aggregateRows(rows, schema, panel.view)
}
