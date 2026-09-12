import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { debounce } from '@acorn/plugin-api/client'
import { Graph, type GraphCard } from '@acorn/plugin-api/ui'
import type { WorkflowCatalog } from '../../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { LAYOUT_WRITE_DELAY_MS, readLayout, writeLayout, type WorkflowLayout } from '../layoutPrefs'
import { graphOrder, type DraftSelection, type WorkflowDraft } from './draft'

// The graph view: the same nodes the list column draws, as a picture
// (docs/workflows.md § Authoring).
//
// Everything about the graph is already the draft's — the reading order, the ranks, the edges and
// the rules that refuse a bad one — so this file is a projection and a place to keep positions. The
// canvas itself is the kit's `Graph`, which is why the terminal client gets this view too and draws
// it as the indented list.

const describeFor = (kind: string, catalog: WorkflowCatalog | undefined) =>
  catalog?.kinds.find((entry) => entry.id === kind)?.describe ?? BUILTIN_STEP_DESCRIPTIONS[kind]

export default function GraphView(props: {
  draft: WorkflowDraft
  catalog: WorkflowCatalog | undefined
  /** Keys the stored positions: the definition's own id, from `defRefKey`. */
  defId: string
  readOnly?: boolean
  onSelect: (selection: DraftSelection) => void
  onConnect: (from: string, to: string) => void
  onDisconnect: (from: string, to: string) => void
  onRemove: (name: string) => void
}) {
  const def = () => props.draft.def
  const order = createMemo(() => graphOrder(def()))
  const selected = () => (props.draft.selection.kind === 'node' ? props.draft.selection.name : undefined)

  const cards = createMemo<GraphCard[]>(() => order().map((row) => {
    const kind = def().steps.find((step) => step.name === row.name)?.kind ?? 'agent'
    const described = describeFor(kind, props.catalog)
    return {
      id: row.name,
      label: row.name,
      detail: described?.label ?? kind,
      glyph: described?.icon,
      selected: row.name === selected(),
    }
  }))

  const edges = createMemo(() => order().flatMap((row) => row.parents.map((from) => ({ from, to: row.name }))))

  // Read once and held: positions are a device scrap, and re-reading storage on every frame of a
  // drag would be the only thing here that touched it.
  const [positions, setPositions] = createSignal<WorkflowLayout>(props.defId ? readLayout(props.defId) : {})
  // A draft with no id yet has nowhere to file a position, so it keeps them in memory for the session
  // and the layout falls back to the ranks. Writing them under an empty key would put every unsaved
  // draft's cards in the same place.
  const persist = debounce(
    (layout: WorkflowLayout) => { if (props.defId) writeLayout(props.defId, layout) },
    LAYOUT_WRITE_DELAY_MS,
  )
  // Flushed rather than dropped: a view swapped away 200 ms after a drag still owes the write.
  onCleanup(() => persist.flush())

  // Renaming a node and deleting one both rewrite the stored layout from outside this component
  // (../layoutPrefs.ts), so the held copy is re-read whenever the set of names changes. A memo, not
  // an inline getter: `on()` re-fires on identity and this list is rebuilt on every keystroke.
  const names = createMemo(() => cards().map((card) => card.id).join('\u0000'))
  createEffect(on(names, () => {
    if (!props.defId) return
    persist.flush()
    setPositions(readLayout(props.defId))
  }, { defer: true }))

  const move = (id: string, at: { x: number; y: number }): void => {
    const next = { ...positions(), [id]: at }
    setPositions(next)
    persist(next)
  }

  return (
    <Graph
      id={`workflows.editor.graph:${props.defId}`}
      ariaLabel="Workflow graph"
      nodes={cards()}
      edges={edges()}
      positions={positions()}
      onSelect={(name) => props.onSelect({ kind: 'node', name })}
      {...(props.readOnly ? {} : {
        onConnect: props.onConnect,
        onDisconnect: props.onDisconnect,
        onMove: move,
        onRemove: props.onRemove,
      })}
    />
  )
}
