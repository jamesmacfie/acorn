import { createMemo, createSignal, For, onCleanup, Show, type JSX } from 'solid-js'
import { Button, SectionHeader } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import { toast } from '../notifications/toast'
import {
  applyMove,
  applyResize,
  COLS,
  sizeFor,
  sizePresets,
  type PanelLayout,
  type Rect,
} from './layout'
import type { PanelId } from './model'
import DashboardPanelHost, { deletePanelDefinition, type DashboardEditorSession } from './DashboardPanelHost'
import PanelGridItem, { type PanelGridGestureKind } from './PanelGridItem'
import { panelGridHeight, panelPlaceholderStyle, panelSlotStyle } from './panelGridGeometry'
import {
  regionAllows,
  regionHasRoom,
  type PanelRegion,
} from './region'
import {
  dashboards,
  homeTabs,
  homeTabScope,
  layoutAt,
  panelDefinition,
  panelsAt,
  placePanelAt,
  setLayoutAt,
  unplacePanel,
  type PlacementScope,
} from './persist'
import './dashboards.css'

// One placement: the grid of panels a person put somewhere and the gestures that arrange it.
// `PanelGridItem` owns each panel's render/chrome boundary; this owns only the shared arrangement.
// See docs/dashboards/placements.md § Placements and § The grid.
//
// It takes a scope rather than assuming home, because `panelsAt` and `layoutAt` already do. A task
// pane or a plugin-reserved region is this component with a different scope.
//
// Cell collision arithmetic is in `layout.ts`, and `panelGridGeometry.ts` projects the resolved cells
// back to pixels. This orchestrator owns measurement and commits only the pure functions' answers.

/** Below this the cells are too small to mean anything, so the grid collapses to one column. */
const MIN_CELL_PX = 44

/** Pixels of movement before a drag arms, so a sloppy click on the title is still a click. */
const DRAG_THRESHOLD_PX = 4

type Gesture = {
  id: PanelId
  kind: PanelGridGestureKind
  /** `apply`'s output for the current candidate. This is what renders. */
  layout: PanelLayout
  /** How far the dragged panel is from the cell it currently occupies, so it tracks the pointer between
   *  snaps instead of jumping a whole cell at a time. */
  offset?: { x: number; y: number }
}

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export default function PanelGrid(props: {
  scope: PlacementScope
  /** Replaces the "Panels" heading in the same seat; Home's tab bar takes it when there is more than
   *  one dashboard. Its presence also keeps the header row on an empty placement, so a freshly
   *  created tab still has a bar. See docs/dashboards/placements.md § Placements. */
  heading?: JSX.Element
  /** `role="tabpanel"` wiring for the grid, when something above it is a tablist. */
  panelAria?: { id: string; labelledBy: string }
  /** Present when this grid is a rectangle a plugin reserved, carrying what the owner allows there
   *  (region.ts). Absent for Home and the task pane, which constrain nothing. Every rule it carries
   *  is applied in two places below, the offer and the render. */
  region?: PanelRegion
  /** Home's. The host draws its own Add panel, so the grid draws no "Panels" header and no add
   *  button, and draws this in place of an empty grid. A `heading` still draws. */
  empty?: () => JSX.Element
}) {
  const [typedEditing, setTypedEditing] = createSignal<DashboardEditorSession>()
  const [gesture, setGesture] = createSignal<Gesture | undefined>()
  const [cell, setCell] = createSignal(MIN_CELL_PX)
  const [pitch, setPitch] = createSignal(MIN_CELL_PX)
  const [collapsed, setCollapsed] = createSignal(false)
  const [announcement, setAnnouncement] = createSignal('')
  // The render-time half of a region's constraints. A panel the owner no longer allows here is
  // dropped from this grid and nowhere else: its definition and every other placement survive
  // (region.ts, `regionAllows`). The hole it leaves is cosmetic, and only appears when a plugin
  // narrows its own region after somebody composed against the wider one.
  const panels = () => {
    const region = props.region
    const placed = panelsAt(props.scope)
    return region ? placed.filter((panel) => regionAllows(region, panel)) : placed
  }
  /** A region's cap takes the affordance away rather than failing on click, the same rule the
   *  "no plugin provides a source" gate below applies. */
  const hasRoom = () => !props.region || regionHasRoom(props.region, panels().length)
  const committed = createMemo(() => layoutAt(props.scope))
  /** What the grid draws: the live candidate while a gesture is running, else what is stored. */
  const layout = (): PanelLayout => gesture()?.layout ?? committed()
  const sizeOf = (id: PanelId) => sizeFor(panelDefinition(id)?.view.kind ?? 'list')

  let gridEl: HTMLDivElement | undefined
  const slots = new Map<PanelId, HTMLDivElement>()

  // ── Measurement ─────────────────────────────────────────────────────────────────────────────
  //
  // The one pixel measurement in the whole feature (docs/dashboards/placements.md § The grid): square cells,
  // measured by a `ResizeObserver`, at the cost of panel heights breathing with window width.
  //
  // The gap is read off the resolved `column-gap` rather than by token name, so the grid and the
  // overlay agree to the pixel whatever a style pack sets, and nothing here joins the
  // JS-reads-a-token list (ui/tokenAxes.ts, `BRIDGE_TOKENS`).
  const measure = () => {
    const el = gridEl
    if (!el) return
    const width = el.clientWidth
    if (!width) return
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0
    const size = Math.max(1, (width - (COLS - 1) * gap) / COLS)
    setCell(size)
    setPitch(size + gap)
    setCollapsed(size < MIN_CELL_PX)
  }

  // Observed from the grid's own ref, not from mount: an empty placement draws no grid, so a mount-time
  // observer never attached and the first panel published there kept the starting cell size.
  let observer: ResizeObserver | undefined
  onCleanup(() => observer?.disconnect())
  const attachGrid = (element: HTMLDivElement) => {
    gridEl = element
    observer?.disconnect()
    // The ref runs before the element is in the document, so the first measure waits a tick.
    queueMicrotask(measure)
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(measure)
    observer.observe(element)
  }

  // ── Pointer gestures ────────────────────────────────────────────────────────────────────────
  //
  // Pointer events with capture, not HTML5 drag-and-drop, which brings a ghost image to fight, no
  // `pointercancel`, and worse coordinates. `createSplitDrag` is not extended, because its call
  // sites are delta-in-pixels and this one is rect-in-cells.

  // A gesture that outlives its component would keep arranging panels that no longer exist.
  let release: (() => void) | undefined
  onCleanup(() => release?.())

  const begin = (
    id: PanelId,
    kind: 'move' | 'resize',
    event: PointerEvent,
    candidateFor: (start: Rect, dx: number, dy: number, step: number) => Rect,
  ) => {
    if (collapsed()) return
    const start = committed().rects[id]
    if (!start) return
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId)

    const originX = event.clientX
    const originY = event.clientY
    const previousUserSelect = document.body.style.userSelect
    let armed = kind === 'resize'
    let frame = 0
    let latest: PanelLayout | undefined

    const move = (pointer: PointerEvent) => {
      const dx = pointer.clientX - originX
      const dy = pointer.clientY - originY
      if (!armed && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return
      if (!armed) {
        armed = true
        document.body.style.userSelect = 'none'
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const step = pitch()
        const next = kind === 'move'
          ? applyMove(committed(), id, candidateFor(start, dx, dy, step), sizeOf)
          : applyResize(committed(), id, candidateFor(start, dx, dy, step), sizeOf)
        latest = next
        const landed = next.rects[id] ?? start
        setGesture({
          id,
          kind,
          layout: next,
          // Only a move floats under the pointer; a resize stays in its cells and grows.
          ...(kind === 'move'
            ? { offset: { x: dx - (landed.x - start.x) * step, y: dy - (landed.y - start.y) * step } }
            : {}),
        })
      })
    }

    const end = (commit: boolean) => {
      cancelAnimationFrame(frame)
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape)
      release = undefined
      // Nothing was written during the gesture, so a cancel costs nothing to honour.
      if (commit && latest) setLayoutAt(props.scope, latest)
      setGesture(undefined)
    }
    const up = () => end(true)
    const cancel = () => end(false)
    const escape = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      end(false)
    }

    release = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
  }

  const beginDrag = (id: PanelId, event: PointerEvent) => {
    // The header minus its buttons: the title span and the slack around it.
    if (event.target instanceof Element && event.target.closest('button, a, input, select')) return
    begin(id, 'move', event, (start, dx, dy, step) => ({
      ...start,
      x: start.x + Math.round(dx / step),
      y: start.y + Math.round(dy / step),
    }))
  }

  const beginResize = (id: PanelId, edge: 'e' | 's' | 'se', event: PointerEvent) => {
    event.preventDefault()
    begin(id, 'resize', event, (start, dx, dy, step) => ({
      ...start,
      w: edge === 's' ? start.w : start.w + Math.round(dx / step),
      h: edge === 'e' ? start.h : start.h + Math.round(dy / step),
    }))
  }

  // ── Keyboard layout mode ────────────────────────────────────────────────────────────────────

  const announce = (id: PanelId, next: PanelLayout) => {
    const rect = next.rects[id]
    if (rect) setAnnouncement(`Row ${rect.y + 1}, column ${rect.x + 1}, ${rect.w} wide, ${rect.h} tall`)
  }

  const keyboardGesture = () => {
    const active = gesture()
    return active?.kind === 'keyboard' ? active : undefined
  }

  const enterLayoutMode = (id: PanelId) => {
    const start = committed()
    setGesture({ id, kind: 'keyboard', layout: start })
    announce(id, start)
    // The overlay appearing is the same signal it is mid-drag: a gesture is live.
    queueMicrotask(() => slots.get(id)?.focus())
  }

  const onSlotKeyDown = (id: PanelId, event: KeyboardEvent) => {
    const active = keyboardGesture()
    if (!active || active.id !== id) return
    const step = ARROWS[event.key]
    if (step) {
      event.preventDefault()
      const rect = active.layout.rects[id]
      if (!rect) return
      // Every nudge runs the same `apply` a drag frame does, so pushes and compaction happen exactly
      // as they do under the pointer.
      const next = event.shiftKey
        ? applyResize(active.layout, id, { ...rect, w: rect.w + step[0], h: rect.h + step[1] }, sizeOf)
        : applyMove(active.layout, id, { ...rect, x: rect.x + step[0], y: rect.y + step[1] }, sizeOf)
      setGesture({ ...active, layout: next })
      announce(id, next)
      return
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      const commit = event.key === 'Enter'
      setGesture(undefined)
      setAnnouncement('')
      if (commit) setLayoutAt(props.scope, active.layout)
    }
  }

  /** Blur commits, same as pointer-up: leaving the panel is not a cancel. */
  const onSlotBlur = (id: PanelId) => {
    const active = keyboardGesture()
    if (!active || active.id !== id) return
    setGesture(undefined)
    setAnnouncement('')
    setLayoutAt(props.scope, active.layout)
  }

  // ── Menu reorder, reinterpreted onto geometry ───────────────────────────────────────────────
  //
  // Move up and move down are reinterpreted onto geometry as a swap toward the neighbour in reading
  // order (docs/dashboards/placements.md § The grid). On a one-column window they behave as they did before
  // geometry existed.

  const moveTo = (id: PanelId, delta: -1 | 1) => {
    const current = committed()
    const order = panels().map((entry) => entry.id)
    const index = order.indexOf(id)
    const neighbour = current.rects[order[index + delta] ?? '']
    const rect = current.rects[id]
    if (!neighbour || !rect) return
    setLayoutAt(props.scope, applyMove(current, id, { ...rect, x: neighbour.x, y: neighbour.y }, sizeOf))
  }

  const canMove = (id: PanelId, delta: -1 | 1) => {
    const order = panels().map((entry) => entry.id)
    const index = order.indexOf(id)
    return index >= 0 && index + delta >= 0 && index + delta < order.length
  }

  // ── Moving between placements ───────────────────────────────────────────────────────────────
  //
  // The Home tabs other than this one (docs/dashboards/placements.md § Placements). A flat labelled group
  // rather than a submenu, because `Menu` has no submenu and a list of at most seven names is
  // already keyboard-operable as rows.
  //
  // Tabs only. Moving to a task pane would be the same two calls and a different destination.

  const moveTargets = () => props.scope.surface !== 'home'
    ? []
    : homeTabs(dashboards(), props.scope.workspaceId).filter((tab) => tab.id !== (props.scope.ownerId ?? ''))

  /** Keeps the definition and takes a fresh rect at the destination. A rect is per (scope, panel), so
   *  there is nothing to carry across. The destination is in this workspace: the targets are its own
   *  dashboards, and moving a board's panel into a workspace you are not looking at is the same
   *  "somewhere nobody is looking" the wizard's Where control already refuses. */
  const moveToTab = (id: PanelId, tabId: string) => {
    unplacePanel(props.scope, id)
    placePanelAt(homeTabScope(tabId, props.scope.workspaceId), id, sizePresets(panelDefinition(id)?.view.kind ?? 'list').m)
  }

  const tabPanel = () => (props.panelAria
    ? { id: props.panelAria.id, role: 'tabpanel' as const, 'aria-labelledby': props.panelAria.labelledBy }
    : {})

  const addButton = () => (
    <Button size="sm" variant="ghost" onPress={() => setTypedEditing({})}>
      <Icon name="plus" /> Add panel
    </Button>
  )

  // ── Rendering ───────────────────────────────────────────────────────────────────────────────
  // Absolute positioning permits smooth cell transitions. The pure pixel projection is separate
  // from the gesture owner, so neither the rendered slot nor its chrome can commit layout state.
  const gap = () => pitch() - cell()
  const gridHeight = () => panelGridHeight(panels(), layout(), pitch(), gap())
  const slotStyle = (id: PanelId) => panelSlotStyle(id, layout(), collapsed(), pitch(), gap(), gesture())
  const placeholderStyle = () => panelPlaceholderStyle(layout(), pitch(), gap(), gesture()?.id)

  return (
    <Show when={panels().length || hasRoom() || props.heading}>
      <section class="dash-placement">
        {/* The fallback needs no gate: reaching it means no panels, and the Show above already
            established at least one source to offer, or a heading, which is a tab bar that has
            to survive its own tab being empty. */}
        <Show when={panels().length || props.heading || props.empty} fallback={<div class="dash-placement-add">{addButton()}</div>}>
          <Show when={props.heading || !props.empty}>
            <SectionHeader level="group" actions={<Show when={hasRoom() && !props.empty}>{addButton()}</Show>}>
              {props.heading ?? 'Panels'}
            </SectionHeader>
          </Show>
          <Show when={panels().length || !props.empty} fallback={<div {...tabPanel()}>{props.empty?.()}</div>}>
            <div
              class="dash-grid"
              ref={attachGrid}
              {...tabPanel()}
              style={{
                '--dash-cell': `${cell()}px`,
                '--dash-pitch': `${pitch()}px`,
                ...(collapsed() ? {} : { height: `${gridHeight()}px` }),
              }}
              {...(collapsed() ? { 'data-collapsed': '' } : {})}
            >
              {/* Visible only while a gesture is live. Nothing about the layout is discoverable
                  chrome until a gesture makes it relevant. */}
              <Show when={gesture()}>
                <div class="dash-grid-overlay" aria-hidden="true" />
              </Show>
              <For each={panels()}>
                {(definition) => <PanelGridItem
                  definition={definition}
                  workspaceId={props.scope.workspaceId}
                  scope={props.scope}
                  layout={{
                    collapsed,
                    style: () => slotStyle(definition.id),
                    gestureKind: () => gesture()?.id === definition.id ? gesture()!.kind : undefined,
                    keyboardActive: () => keyboardGesture()?.id === definition.id,
                    announcement,
                    register: (element) => slots.set(definition.id, element),
                    unregister: () => slots.delete(definition.id),
                    onKeyDown: (event) => onSlotKeyDown(definition.id, event),
                    onBlur: () => onSlotBlur(definition.id),
                    onBeginDrag: (event) => beginDrag(definition.id, event),
                    onBeginResize: (edge, event) => beginResize(definition.id, edge, event),
                  }}
                  actions={{
                    edit: () => setTypedEditing({ dashboardId: definition.publication!.dashboardId }),
                    beginLayout: () => enterLayoutMode(definition.id),
                    canMove: (delta) => canMove(definition.id, delta),
                    move: (delta) => moveTo(definition.id, delta),
                    moveTargets,
                    moveToTab: (tabId) => moveToTab(definition.id, tabId),
                    remove: () => unplacePanel(props.scope, definition.id),
                    delete: () => deletePanelDefinition(definition, props.scope.workspaceId),
                    deleteFailed: () => toast("Couldn't delete this panel. Try again.", { tone: 'danger' }),
                  }}
                />}
              </For>
              {/* The candidate cells, under the floating panel: the shape of the panel that lands
                  there rather than a wireframe of it. */}
              <Show when={gesture()?.kind === 'move'}>
                <div class="dash-placeholder" aria-hidden="true" style={placeholderStyle()} />
              </Show>
            </div>
          </Show>
          <div class="dash-live" aria-live="polite">{announcement()}</div>
        </Show>

        <DashboardPanelHost
          session={typedEditing()}
          scope={props.scope}
          onClose={() => setTypedEditing(undefined)}
        />

      </section>
    </Show>
  )
}
