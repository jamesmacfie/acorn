import { createMemo } from 'solid-js'
import { Graph, type GraphCard } from '@acorn/plugin-api/ui'
import { stepGlyph, stepTone } from './runDisplay'
import type { RunPaneModel } from './runPaneModel'

// The run's nodes as a picture, in place of the rows (docs/workflows.md § The run pane).
//
// The same model, the same reading order and the same selection as the rows above it: the toggle in
// the Nodes header swaps which one is drawn and nothing else. No ports and no dragging, because a
// run's graph is a record rather than a draft — the definition it froze at the start is what an edge
// came from.

/** `stepTone`'s `muted` is the absence of a tone, and a card has no such role: a pending card is a
 *  plain card. */
const cardTone = (status: string | undefined): GraphCard['tone'] => {
  const tone = stepTone(status)
  return tone === 'muted' ? undefined : tone
}

export function RunGraph(props: { model: RunPaneModel }) {
  const model = props.model

  const cards = createMemo<GraphCard[]>(() => model.nodes().map((node) => ({
    // The step's name, not its row id: an edge is `after`, which names steps, and a pending node has
    // no row yet. Selecting maps the name back to the row.
    id: node.name,
    label: node.name,
    detail: node.step?.status ?? 'pending',
    glyph: stepGlyph(node.step?.status),
    tone: cardTone(node.step?.status),
    selected: !!node.step && node.step.id === model.selectedStepId(),
  })))

  const edges = createMemo(() => model.nodes().flatMap((node) => node.parents.map((from) => ({ from, to: node.name }))))

  return (
    <Graph
      id={`workflows:graph:${model.selectedRunId() ?? 'none'}`}
      ariaLabel="Workflow nodes"
      nodes={cards()}
      edges={edges()}
      onSelect={(name) => {
        const step = model.nodes().find((node) => node.name === name)?.step
        if (step) model.selectStep(step.id)
      }}
    />
  )
}
