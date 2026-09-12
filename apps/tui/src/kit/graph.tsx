/** @jsxImportSource @acorn/tui/jsx */
import { createMemo, onCleanup, Show } from 'solid-js'
import type { Renderable } from '../tree/compat'
import { registerIntentLayer } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { STOP } from '../keys/tiers'
import type { GraphCard } from '@acorn/client-core/kit/components/content/Graph.tsx'
import type { GraphEdgeRef, GraphPoint } from '@acorn/client-core/kit/lib/graphLayout.ts'
import { graphParents, graphRanks } from '@acorn/client-core/kit/lib/graphLayout.ts'
import { Badge, Icon, Row, Rows, Text } from './showing'
import { Picker } from './asking'

// `Graph` in cells: the indented list, which is what a picture of a graph is on a host with no
// pixels (docs/ui-design.md § Every node at 80 by 24).
//
// The same cards in the same order with the same selection, indented by rank instead of placed by
// coordinate, and a card that waits on more than one other says `⇐ n`. Ranks come from the same
// `graphLayout.ts` the DOM draws its positions from, so the two hosts cannot disagree about which
// card sits under which.
//
// What is lost is written down beside the node's level in client-core's kit/tokens/support.ts:
// positions, wires, and dragging an edge into place. The last of those is the only affordance a
// reader would miss, so a graph that can be wired draws a picker under the list instead.

/** Indentation stops at four levels, the same cap the workflows editor's own list uses: past that a
 *  rank costs more width than it explains. */
const MAX_DEPTH = 4

export function Graph(props: {
  id: string
  nodes: readonly GraphCard[]
  edges: readonly GraphEdgeRef[]
  positions?: Readonly<Record<string, GraphPoint>>
  onSelect?: (id: string) => void
  onConnect?: (from: string, to: string) => void
  onDisconnect?: (from: string, to: string) => void
  onMove?: (id: string, position: GraphPoint) => void
  onRemove?: (id: string) => void
  ariaLabel: string
}) {
  const ids = createMemo(() => props.nodes.map((node) => node.id))
  const ranks = createMemo(() => graphRanks(ids(), props.edges))
  const parents = createMemo(() => graphParents(ids(), props.edges))
  const items = createMemo(() => props.nodes.map((node) => ({ key: node.id, label: node.label })))
  const selected = () => props.nodes.find((node) => node.selected)?.id ?? null
  const cardFor = (id: string) => props.nodes.find((node) => node.id === id)

  // Everything the selected card could be wired to: not itself, and not something it already waits
  // on. A cycle is the caller's to refuse, because only it knows what an edge means.
  const targets = createMemo(() => {
    const from = selected()
    if (!from) return []
    const already = new Set(props.edges.filter((edge) => edge.from === from).map((edge) => edge.to))
    return props.nodes
      .filter((node) => node.id !== from && !already.has(node.id))
      .map((node) => ({ id: node.id, label: node.label }))
  })

  return (
    <box
      flexDirection="column"
      ref={(element: Renderable) => {
        // Delete and Backspace on the card the caret is on. One layer on the list rather than one per
        // row, in `focus-within` mode, because the row is where the keys land and the list is what
        // knows which card that is.
        onCleanup(registerIntentLayer(element, ['delete'], () => {
          const id = selected()
          if (!id || !props.onRemove) return false
          props.onRemove(id)
          return true
        }, { priority: STOP, mode: 'focus-within' }))
      }}
    >
      <Rows
        tree
        id={props.id}
        ariaLabel={props.ariaLabel}
        items={items()}
        selected={selected()}
        onSelect={props.onSelect}
        onActivate={props.onSelect}
      >
        {(item, itemProps, isSelected) => {
          const card = () => cardFor(item.key)
          const waits = () => parents().get(item.key)?.length ?? 0
          return (
            <Row
              item={itemProps}
              selected={isSelected()}
              depth={Math.min(MAX_DEPTH, ranks().get(item.key) ?? 0)}
              density="compact"
              variant="tree"
              leading={<Show when={card()?.glyph}>{(glyph) => <Icon name={glyph()} tone={card()?.tone} />}</Show>}
              meta={(
                <>
                  <Show when={waits() > 1}><Badge size="xs">{`⇐ ${waits()}`}</Badge></Show>
                  <Show when={card()?.detail}>{(detail) => <Text emphasis="muted">{detail()}</Text>}</Show>
                </>
              )}
            >
              {card()?.label ?? item.key}
            </Row>
          )
        }}
      </Rows>
      <Show when={props.onConnect && selected()}>
        {(from) => (
          <Picker
            label="Draw an edge"
            ariaLabel={`Draw an edge out of ${cardFor(from())?.label ?? from()}`}
            placeholder="Wait on this one…"
            emptyText="Nothing left to wait on."
            size="sm"
            items={targets()}
            onPick={(to) => props.onConnect?.(from(), to)}
          />
        )}
      </Show>
    </box>
  )
}
