import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from 'solid-js'
import Icon from './Icon'
import { createCollection } from '../../keys/collection'
import { bindIntents } from '../../keys/keymapHost'
import type { Tone } from '../../tokens/tokens'
import {
  GRAPH_CARD_H, GRAPH_CARD_W, GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN, layoutGraph, snapToGrid,
  type GraphEdgeRef, type GraphPoint,
} from '../../lib/graphLayout'

/* Graph: a picture of a graph — cards on a grid, edges as curves, one card selected.
 *
 * The kit's canvas. It is here rather than in the plugin that wanted it because plugin client code
 * may not emit raw DOM or SVG: a picture drawn in a plugin is a picture the terminal host cannot
 * draw, and the premise of the kit is that both hosts draw the same tree
 * (docs/ui-design.md § The closed kit). Two surfaces asked for it, the workflows editor and the
 * workflows run pane, and both projections were written before it landed, which is the admission
 * rule.
 *
 * The geometry is ../../lib/graphLayout.ts and none of it is here: that owns where a card sits, this
 * owns pan, zoom, the pointer gestures and the ARIA.
 *
 * A card is a real button inside a listbox, so the graph reads as a list to a screen reader and to
 * the keyboard: one tab stop, the arrows walk the cards, type-ahead finds one by name. The wires are
 * one SVG underneath, `aria-hidden`, because a curve says nothing that the card at each end does not
 * say better.
 *
 * Three of its handlers are outside the kit's eleven events — `onConnect`, `onDisconnect` and
 * `onMove` — so they work in the shell and are dropped on the way to a sandbox. That is the answer
 * `onInput` already gets, and the honest one here: a remote tree draws the picture and selects a
 * card, and authoring an edge is a compiled pane's affordance.
 *
 * At 80×24: the indented list, one line per card. The terminal host draws it from the same ranks.
 */

export type GraphCard = {
  id: string
  label: string
  detail?: string
  /** An icon name, resolved the way every other `glyph` in the kit is. */
  glyph?: string
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'>
  selected?: boolean
}

/** Room left around the content when the view is fitted. */
const FIT_PAD = 24
/** How far a pointer travels before a press on a card becomes a drag. */
const DRAG_SLOP = 3
/** Half the width of a port or an edge control, so both centre on the point they belong to. */
const DOT = 7

const clampZoom = (value: number): number => Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, value))

export function Graph(props: {
  /** Keys the stored roving place, the way `Rows` does. Stable across a rebuild of `nodes`. */
  id: string
  nodes: readonly GraphCard[]
  edges: readonly GraphEdgeRef[]
  /** Where the author put a card. A card with no entry falls back to its rank and its lane. */
  positions?: Readonly<Record<string, GraphPoint>>
  onSelect?: (id: string) => void
  /** Present means the cards grow ports and an edge can be drawn from one to another. */
  onConnect?: (from: string, to: string) => void
  onDisconnect?: (from: string, to: string) => void
  onMove?: (id: string, position: GraphPoint) => void
  /** Delete or Backspace on the card the keys are on. One of the kit's eleven events, so it works in
   *  a remote tree too — and it is why a canvas needs no key opinion from the pane that drew it. */
  onRemove?: (id: string) => void
  ariaLabel: string
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const [view, setView] = createSignal({ x: FIT_PAD, y: FIT_PAD, k: 1 })
  // Once a reader has panned or zoomed, the view is theirs: a node arriving does not yank it back.
  const [held, setHeld] = createSignal(false)
  const [drag, setDrag] = createSignal<({ id: string } & GraphPoint) | undefined>()
  const [wire, setWire] = createSignal<({ from: string } & GraphPoint) | undefined>()

  // The same object back for an unchanged card, so `<For>` reconciles instead of remounting. A run
  // pane rebuilds this list on every socket frame, and a rebuilt button is a button that has lost
  // focus. `Rows` keeps its items the same way and for the same reason.
  const cache = new Map<string, GraphCard>()
  const cards = createMemo<readonly GraphCard[]>(() => {
    const next = props.nodes.map((node) => {
      const held = cache.get(node.id)
      const same = held && Object.keys(node).length === Object.keys(held).length
        && Object.entries(node).every(([field, value]) => (held as Record<string, unknown>)[field] === value)
      if (!same) cache.set(node.id, node)
      return same ? held : node
    })
    for (const id of [...cache.keys()]) if (!next.some((node) => node.id === id)) cache.delete(id)
    return next
  })

  const layout = createMemo(() => {
    const moving = drag()
    const put = moving ? { ...props.positions, [moving.id]: { x: moving.x, y: moving.y } } : props.positions
    return layoutGraph(props.nodes.map((node) => node.id), props.edges, put)
  })

  const collection = createCollection({
    id: () => props.id,
    items: () => props.nodes.map((node) => ({ key: node.id, label: node.label })),
    role: 'listbox',
    selected: () => props.nodes.find((node) => node.selected)?.id ?? null,
    ...(props.onSelect ? { onSelect: props.onSelect, onActivate: props.onSelect } : {}),
  })

  const fit = (): void => {
    const element = viewport()
    const box = layout()
    if (!element || !box.width || !box.height) return
    const { width, height } = element.getBoundingClientRect()
    if (!width || !height) return
    const k = clampZoom(Math.min((width - FIT_PAD * 2) / box.width, (height - FIT_PAD * 2) / box.height, 1))
    setView({ k, x: Math.max(FIT_PAD, (width - box.width * k) / 2), y: FIT_PAD })
  }

  // A memo rather than an inline getter: `on()` re-runs whenever anything it read changes identity,
  // and `props.nodes` is rebuilt on every frame of a live run. The count is what should refit.
  const count = createMemo(() => props.nodes.length)
  createEffect(on(count, () => { if (!held()) fit() }, { defer: true }))

  /** A pointer event in content coordinates. */
  const toContent = (event: PointerEvent): GraphPoint => {
    const rect = viewport()?.getBoundingClientRect()
    const at = view()
    return {
      x: (event.clientX - (rect?.left ?? 0) - at.x) / at.k,
      y: (event.clientY - (rect?.top ?? 0) - at.y) / at.k,
    }
  }

  // One pointer gesture at a time, let go of when it ends and when the node goes away.
  let release: (() => void) | undefined
  onCleanup(() => release?.())
  const gesture = (move: (event: PointerEvent) => void, up: (event: PointerEvent) => void): void => {
    release?.()
    const onMove = (event: PointerEvent) => move(event)
    const onUp = (event: PointerEvent) => {
      release?.()
      up(event)
    }
    release = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      release = undefined
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /** Pan. The background is the grab handle, so a press that lands on a card is not one. */
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('.ui-graph-card, .ui-graph-port, .ui-graph-cut')) return
    const from = view()
    const px = event.clientX
    const py = event.clientY
    setHeld(true)
    gesture(
      (at) => setView({ k: from.k, x: from.x + (at.clientX - px), y: from.y + (at.clientY - py) }),
      () => {},
    )
  }

  /** Zoom, anchored at the pointer: whatever is under the cursor stays under it. */
  const onWheel = (event: WheelEvent): void => {
    const rect = viewport()?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    const at = view()
    const k = clampZoom(at.k * Math.exp(-event.deltaY / 400))
    if (k === at.k) return
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    setHeld(true)
    setView({ k, x: px - (px - at.x) * (k / at.k), y: py - (py - at.y) * (k / at.k) })
  }

  const startMove = (id: string, event: PointerEvent): void => {
    if (!props.onMove || event.button !== 0) return
    const card = layout().at(id)
    if (!card) return
    const px = event.clientX
    const py = event.clientY
    const k = view().k
    let moved = false
    gesture(
      (at) => {
        if (!moved && Math.hypot(at.clientX - px, at.clientY - py) < DRAG_SLOP) return
        moved = true
        setDrag({
          id,
          x: Math.max(0, snapToGrid(card.x + (at.clientX - px) / k)),
          y: Math.max(0, snapToGrid(card.y + (at.clientY - py) / k)),
        })
      },
      () => {
        const at = drag()
        setDrag(undefined)
        if (moved && at) props.onMove?.(id, { x: at.x, y: at.y })
      },
    )
  }

  const startWire = (from: string, event: PointerEvent): void => {
    if (!props.onConnect || event.button !== 0) return
    event.stopPropagation()
    setWire({ from, ...toContent(event) })
    gesture(
      (at) => setWire({ from, ...toContent(at) }),
      (at) => {
        setWire(undefined)
        const landed = document.elementFromPoint(at.clientX, at.clientY)?.closest('[data-graph-node]')
        const to = landed?.getAttribute('data-graph-node')
        if (to && to !== from) props.onConnect?.(from, to)
      },
    )
  }

  /** The wire being drawn, from the source card's bottom port to the pointer. */
  const pending = createMemo(() => {
    const drawing = wire()
    const card = drawing && layout().at(drawing.from)
    if (!drawing || !card) return ''
    return `M ${card.x + GRAPH_CARD_W / 2} ${card.y + GRAPH_CARD_H} L ${drawing.x} ${drawing.y}`
  })

  const place = (x: number, y: number) => `translate(${x}px, ${y}px)`

  /** Delete and Backspace, on the card the keys are on. */
  const removeActive = (): boolean => {
    const id = collection.active() ?? props.nodes.find((node) => node.selected)?.id
    if (!id || !props.onRemove) return false
    props.onRemove(id)
    return true
  }

  return (
    <div
      class="ui-graph"
      ref={(element) => {
        setViewport(element)
        requestAnimationFrame(fit)
        // On the viewport rather than on the plane, because the plane's ref is the collection's.
        // Intents bubble from the focused card, so this catches Delete wherever inside it lands.
        bindIntents(element, ['delete'], (intent) => intent === 'delete' && removeActive())
      }}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      <div
        class="ui-graph-plane"
        {...collection.containerProps}
        aria-label={props.ariaLabel}
        style={{ transform: `translate(${view().x}px, ${view().y}px) scale(${view().k})` }}
      >
        {/* One SVG under the cards, hidden from a screen reader: a curve says nothing the cards at
            its two ends do not. */}
        <svg
          class="ui-graph-edges"
          aria-hidden="true"
          width={Math.max(1, layout().width)}
          height={Math.max(1, layout().height)}
        >
          <Index each={layout().edges}>
            {(edge) => <path class="ui-graph-wire" d={edge().path} />}
          </Index>
          <Show when={pending()}>{(path) => <path class="ui-graph-wire" data-pending="" d={path()} />}</Show>
        </svg>

        <Show when={props.onDisconnect}>
          <Index each={layout().edges}>
            {(edge) => (
              <button
                type="button"
                class="ui-graph-cut"
                style={{ transform: place(edge().control.x - DOT, edge().control.y - DOT) }}
                aria-label={`Remove the edge from ${edge().from} to ${edge().to}`}
                onClick={() => props.onDisconnect?.(edge().from, edge().to)}
              >
                ×
              </button>
            )}
          </Index>
        </Show>

        <For each={cards()}>
          {(node) => {
            const card = () => layout().at(node.id)
            return (
              <button
                type="button"
                class="ui-graph-card"
                data-graph-node={node.id}
                data-tone={node.tone ?? 'neutral'}
                data-selected={node.selected ? '' : undefined}
                data-moving={drag()?.id === node.id ? '' : undefined}
                style={{ transform: place(card()?.x ?? 0, card()?.y ?? 0) }}
                {...collection.itemProps(node.id)}
                aria-selected={!!node.selected}
                onPointerDown={(event) => startMove(node.id, event)}
                onClick={() => props.onSelect?.(node.id)}
              >
                <span class="ui-graph-card-head">
                  <Show when={node.glyph}>{(glyph) => <Icon name={glyph()} />}</Show>
                  <span class="ui-graph-card-label">{node.label}</span>
                </span>
                <Show when={node.detail}>
                  <span class="ui-graph-card-detail">{node.detail}</span>
                </Show>
                <Show when={(card()?.parents.length ?? 0) > 1}>
                  <span class="ui-graph-card-joins">{`⇐ ${card()?.parents.length}`}</span>
                </Show>
              </button>
            )
          }}
        </For>

        {/* Ports last, so a port that overhangs its card is what the pointer reaches. */}
        <Show when={props.onConnect}>
          <For each={cards()}>
            {(node) => {
              const card = () => layout().at(node.id)
              return (
                <button
                  type="button"
                  class="ui-graph-port"
                  tabindex="-1"
                  style={{
                    transform: place(
                      (card()?.x ?? 0) + GRAPH_CARD_W / 2 - DOT,
                      (card()?.y ?? 0) + GRAPH_CARD_H - DOT,
                    ),
                  }}
                  aria-label={`Draw an edge out of ${node.label}`}
                  onPointerDown={(event) => startWire(node.id, event)}
                />
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}

export default Graph
