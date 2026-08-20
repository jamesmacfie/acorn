import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js'
import { collectionContribution, collectionContributions } from '../registries/collections'
import { Button, SectionHeader } from '../ui/primitives'
import { createArmedConfirm } from '../ui/confirm'
import Icon from '../ui/Icon'
import { Menu } from '../ui/Menu'
import {
  applyMove,
  applyResize,
  COLS,
  sizeFor,
  sizePresets,
  type PanelLayout,
  type Rect,
} from './layout'
import type { PanelDefinition, PanelId } from './model'
import Panel from './Panel'
import PanelEditor from './PanelEditor'
import PanelWizard from './PanelWizard'
import {
  regionAllows,
  regionCollections,
  regionHasRoom,
  regionViews,
  type PanelRegion,
} from './region'
import {
  dashboards,
  homeTabs,
  homeTabScope,
  layoutAt,
  panelDefinition,
  panelsAt,
  placePanel,
  placePanelAt,
  removePanel,
  savePanel,
  setLayoutAt,
  unplacePanel,
  type PlacementScope,
} from './persist'
import './dashboards.css'

// One PLACEMENT (docs/dashboards.md § Placements): the grid of panels a person put somewhere, plus
// the chrome for putting one there, arranging it and taking it away. Panel itself is
// placement-agnostic and owns a panel's frame, freshness and body; this owns the arrangement.
//
// It takes a scope rather than assuming home because `panelsAt` / `layoutAt` already do — a task
// pane or a plugin-reserved region is this component with a different scope, not a second one.
//
// ALL LAYOUT ARITHMETIC IS IN `layout.ts`. This file turns pixels into a candidate rect and renders
// what the pure functions answer; it decides nothing about where a panel lands. THE PREVIEW DURING A
// GESTURE IS THE REAL LAYOUT ALGORITHM RUNNING ON THE CANDIDATE POSITION, not a separate visual
// effect — release persists exactly what was on screen, so there is no commit computation that could
// disagree with the preview, and cancel is free because nothing was written.
//
// EVERY POINTER GESTURE HAS A KEYBOARD EQUIVALENT DRIVEN THROUGH THE SAME FUNCTIONS. That was a
// commitment made when reorder shipped as menu items: drag lands ON TOP of the accessible path,
// never instead of it. Move up / move down survive, reinterpreted onto geometry, and "Move / resize"
// is the arrow-key form of the drag.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO:
//
//   It never announces itself. With nothing placed there is no heading, no empty grid and no
//   invitation — just one ghost button under whatever the surface already showed. A person who
//   never asked for dashboards should not be able to tell this shipped.
//
//   It offers nothing when no plugin provides a collection. An "Add panel" that opens an empty
//   picker is worse than no button, so the affordance is gated on there being something to add.
//   Panels already placed still render — a plugin going away must not take a composition with it.

/** Below this the cells are too small to mean anything, so the grid collapses to one column. */
const MIN_CELL_PX = 44

/** Pixels of movement before a drag arms, so a sloppy click on the title is still a click. */
const DRAG_THRESHOLD_PX = 4

type GestureKind = 'move' | 'resize' | 'keyboard'

type Gesture = {
  id: PanelId
  kind: GestureKind
  /** `apply`'s output for the current candidate. This is what renders. */
  layout: PanelLayout
  /** How far the dragged panel is from the cell it currently occupies, so it tracks the pointer
   *  between snaps instead of jumping a whole cell at a time. */
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
  /** Replaces the "Panels" heading in the same seat. Home's tab bar takes it when there is more than
   *  one dashboard — tabs ARE the heading then (docs/dashboards.md § Persistence). Its presence is
   *  also what keeps the header row on an EMPTY placement, so a freshly created tab still has a bar. */
  heading?: JSX.Element
  /** `role="tabpanel"` wiring for the grid, when something above it is a tablist. */
  panelAria?: { id: string; labelledBy: string }
  /** Present when this grid is a rectangle a PLUGIN reserved, carrying what the owner allows there
   *  (region.ts). Absent for Home and the task pane, which are the user's own surfaces and constrain
   *  nothing. Every rule it carries is applied in exactly two places below — the offer and the
   *  render — and nowhere else in this file. */
  region?: PanelRegion
}) {
  // The sheet's session. The wrapper distinguishes "open" from "closed", which a bare
  // `PanelDefinition | undefined` cannot — it is opened with no panel by nothing today, and with a
  // draft the wizard handed over (`creating`) or a placed panel being edited.
  const [editing, setEditing] = createSignal<{ panel?: PanelDefinition; creating?: boolean } | undefined>()
  const [adding, setAdding] = createSignal(false)
  const [gesture, setGesture] = createSignal<Gesture | undefined>()
  const [cell, setCell] = createSignal(MIN_CELL_PX)
  const [pitch, setPitch] = createSignal(MIN_CELL_PX)
  const [collapsed, setCollapsed] = createSignal(false)
  const [announcement, setAnnouncement] = createSignal('')
  const confirmDelete = createArmedConfirm()

  // The RENDER-time half of a region's constraints. A panel the owner no longer allows here is dropped
  // from this grid and from nowhere else: its definition, and every other placement of it, survive
  // (region.ts § regionAllows). The hole it leaves in the geometry is cosmetic and only appears when a
  // plugin narrows its own region after somebody composed against the wider one.
  const panels = () => {
    const region = props.region
    const placed = panelsAt(props.scope)
    return region ? placed.filter((panel) => regionAllows(region, panel, collectionContribution)) : placed
  }
  /** The EDIT-time half: the editor's selectors simply do not offer what the region disallows, which is
   *  what makes a disallowed panel unrepresentable rather than validated. */
  const collections = () => {
    const region = props.region
    return region ? regionCollections(region, collectionContributions()) : collectionContributions()
  }
  const views = () => props.region && regionViews(props.region)
  /** A region's cap is the owner's, and it takes the affordance away rather than failing on click — the
   *  same rule the "no plugin provides a collection" gate below already applies. */
  const hasRoom = () => !props.region || regionHasRoom(props.region, panels().length)
  const committed = createMemo(() => layoutAt(props.scope))
  /** What the grid draws: the live candidate while a gesture is running, else what is stored. */
  const layout = (): PanelLayout => gesture()?.layout ?? committed()
  const sizeOf = (id: PanelId) => sizeFor(panelDefinition(id)?.view.kind ?? 'list')

  let gridEl: HTMLDivElement | undefined
  const slots = new Map<PanelId, HTMLDivElement>()

  // ── Measurement ─────────────────────────────────────────────────────────────────────────────
  //
  // The one pixel measurement in the whole feature, and it exists to make cells SQUARE — which is
  // what makes the overlay read as graph paper and "3 wide, 2 tall" mean something visually. The
  // browser owns every other pixel via CSS grid.
  //
  // The gap is read off the RESOLVED `column-gap` rather than by token name: the grid and the
  // overlay then agree to the pixel whatever a style pack sets, and nothing here joins the
  // JS-reads-a-token list (ui/tokenAxes.ts § BRIDGE_TOKENS).
  //
  // The accepted consequence: panel heights breathe with window width. If that proves annoying the
  // knob is one line — clamp `size` to a range — and the persisted model does not change.
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

  onMount(() => {
    measure()
    if (typeof ResizeObserver === 'undefined' || !gridEl) return
    const observer = new ResizeObserver(measure)
    observer.observe(gridEl)
    onCleanup(() => observer.disconnect())
  })

  // ── Pointer gestures ────────────────────────────────────────────────────────────────────────
  //
  // Pointer events with capture, not HTML5 drag-and-drop: the house mechanic (ui/split.ts) is
  // already pointer-capture with rAF coalescing and user-select suppression, and HTML5 DnD brings a
  // ghost image we would fight, no `pointercancel`, and worse coordinates. `createSplitDrag` itself
  // is not extended — its own comment says its three call sites are delta-in-pixels, and this one is
  // rect-in-cells.

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
  // Move up / move down survive because they are the path that works with no pointer at all. On a
  // one-column window they behave exactly as they did before geometry existed, which is the
  // continuity that matters; on a wide one they swap toward the neighbour in reading order.

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
  // The Home tabs other than this one (docs/dashboards.md § Persistence). A flat labelled group
  // rather than a submenu: `Menu` has no submenu and one is not worth inventing for a list of at most
  // seven names that is already keyboard-operable as rows.
  //
  // Only tabs. Moving to a TASK PANE is the same two calls and a different destination, and it waits
  // for someone to want it (README § smaller items) — aiming at a pane from Home would put a panel
  // where nobody is looking, which is the argument the wizard's Where control already makes.

  const moveTargets = () => props.scope.surface !== 'home'
    ? []
    : homeTabs(dashboards()).filter((tab) => tab.id !== (props.scope.ownerId ?? ''))

  /** Keeps the DEFINITION and takes a fresh rect at the destination — a rect is per (scope, panel),
   *  so there is nothing to carry across. */
  const moveToTab = (id: PanelId, tabId: string) => {
    unplacePanel(props.scope, id)
    placePanelAt(homeTabScope(tabId), id, sizePresets(panelDefinition(id)?.view.kind ?? 'list').m)
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────────────────────

  const chrome = (definition: PanelDefinition) => (
    <Menu
      ariaLabel={`${definition.title} panel actions`}
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <Button
          size="xs"
          variant="ghost"
          iconOnly
          aria-label={`${definition.title} panel actions`}
          // Header actions fade out when the pointer leaves the panel — and opening this menu moves
          // both pointer and focus into a portal, so without this the trigger vanishes under its own
          // open menu.
          {...(open() ? { 'data-open': '' } : {})}
          onClick={toggle}
        >
          <Icon name="ellipsis" />
        </Button>
      )}
    >
      {(menu) => (
        <>
          {/* The same generated editor the add flow opens, handed the panel it is editing. */}
          <Menu.Item context={menu} onSelect={() => setEditing({ panel: definition })}>Edit</Menu.Item>
          <Menu.Separator />
          <Show when={!collapsed()}>
            <Menu.Item context={menu} onSelect={() => enterLayoutMode(definition.id)}>Move / resize</Menu.Item>
          </Show>
          <Menu.Item
            context={menu}
            disabled={!canMove(definition.id, -1)}
            onSelect={() => moveTo(definition.id, -1)}
          >
            Move up
          </Menu.Item>
          <Menu.Item
            context={menu}
            disabled={!canMove(definition.id, 1)}
            onSelect={() => moveTo(definition.id, 1)}
          >
            Move down
          </Menu.Item>
          <Show when={moveTargets().length}>
            <Menu.Separator />
            <Menu.Label>Move to</Menu.Label>
            <For each={moveTargets()}>
              {(tab) => (
                <Menu.Item context={menu} onSelect={() => moveToTab(definition.id, tab.id)}>{tab.name}</Menu.Item>
              )}
            </For>
          </Show>
          <Menu.Separator />
          {/* REMOVE AND DELETE ARE TWO DIFFERENT THINGS now that a panel can be placed in more than
              one surface (docs/dashboards.md § Placements). Taking a board off Home must not destroy
              the definition the same board renders from in a task pane. */}
          <Menu.Item context={menu} onSelect={() => unplacePanel(props.scope, definition.id)}>
            Remove from here
          </Menu.Item>
          {/* Armed, because the editor has made a definition genuinely expensive to recompose —
              filters, a sort, a projection, a whole mapping matrix — and one misclick used to cost
              all of it. The idiom every other destructive row in the app uses. */}
          <Menu.Item
            context={menu}
            tone="danger"
            closeOnSelect={confirmDelete.armed() === definition.id}
            onSelect={() => {
              if (confirmDelete.request(definition.id)) removePanel(definition.id)
            }}
          >
            {confirmDelete.armed() === definition.id ? 'Delete — press again' : 'Delete panel'}
          </Menu.Item>
        </>
      )}
    </Menu>
  )

  const addButton = () => (
    <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
      <Icon name="plus" /> Add panel
    </Button>
  )

  // ── Rendering ───────────────────────────────────────────────────────────────────────────────
  //
  // Twelve columns, rows one square cell tall — but slots are positioned ABSOLUTELY from the same
  // measurement rather than by `grid-area`. The reason is motion: `grid-area` cannot be transitioned,
  // so push-down and compaction jumped between frames and a drag read as a reshuffle rather than a
  // chain reaction. `top/left/width/height` can be transitioned, and computing them is `measure` run
  // backwards, so the browser and this file cannot disagree about where a cell is. FLIP transforms
  // over CSS grid were the alternative and were refused: they are fragile under the re-layout this
  // grid does every frame, and they fight the sub-cell translate the dragged panel already carries.
  //
  // The container therefore has no in-flow children and must state its own height, which follows the
  // LIVE layout — so a mid-gesture preview resizes the container, which the ResizeObserver above
  // sees. That is only safe because `measure` reads the width and writes nothing back into the
  // layout. An observer that re-applied the committed model would stomp the preview every frame.
  //
  // The collapsed state emits none of it and the slots fall back into ordinary block flow, stacked in
  // document order — which `placements` is kept sorted to on every commit.

  /** The gap, back out of the two measurements: pitch is a cell plus one gap. */
  const gap = () => pitch() - cell()

  const boxOf = (rect: Rect): JSX.CSSProperties => ({
    left: `${rect.x * pitch()}px`,
    top: `${rect.y * pitch()}px`,
    width: `${rect.w * pitch() - gap()}px`,
    height: `${rect.h * pitch() - gap()}px`,
  })

  /** How deep the live layout reaches — the grid's height, since nothing inside it is in flow. */
  const gridHeight = () => {
    const current = layout()
    const rows = panels().reduce((deepest, entry) => {
      const rect = current.rects[entry.id]
      return rect ? Math.max(deepest, rect.y + rect.h) : deepest
    }, 0)
    return Math.max(0, rows * pitch() - gap())
  }

  const slotStyle = (id: PanelId): JSX.CSSProperties => {
    const rect = layout().rects[id]
    if (collapsed() || !rect) return {}
    const active = gesture()
    const offset = active?.id === id ? active.offset : undefined
    return {
      ...boxOf(rect),
      // A hair of lift composed with the tracking translate, so the payload and the cells it came
      // from never look like the same object.
      ...(offset ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(1.015)` } : {}),
    }
  }

  /** The cells a dragged panel would land in, under the panel floating above them. Kept as a STYLE
   *  rather than a rect the placeholder is `Show`n by, because a `Show` on the rect would be keyed on
   *  a fresh object every frame and rebuild the element — and a rebuilt element does not transition
   *  between the cells it is supposed to glide across. */
  const placeholderStyle = (): JSX.CSSProperties => {
    const active = gesture()
    const rect = active && layout().rects[active.id]
    return rect ? boxOf(rect) : {}
  }

  const handle = (id: PanelId, edge: 'e' | 's' | 'se') => (
    <div
      class={`dash-resize dash-resize-${edge}`}
      // Not a button: it is a grabbable edge, and the keyboard path to the same outcome is the
      // menu's layout mode rather than nine tab stops per panel.
      aria-hidden="true"
      onPointerDown={(event) => beginResize(id, edge, event)}
    />
  )

  return (
    <Show when={panels().length || collections().length || props.heading}>
      <section class="dash-placement">
        {/* The fallback needs no gate of its own: reaching it means no panels, and the Show above
            already established that there is then at least one collection to offer — or a heading,
            which is a tab bar that must survive its own tab being empty. */}
        <Show when={panels().length || props.heading} fallback={<div class="dash-placement-add">{addButton()}</div>}>
          <SectionHeader level="group" actions={<Show when={collections().length && hasRoom()}>{addButton()}</Show>}>
            {props.heading ?? 'Panels'}
          </SectionHeader>
          <div
            class="dash-grid"
            ref={gridEl}
            {...(props.panelAria
              ? { id: props.panelAria.id, role: 'tabpanel', 'aria-labelledby': props.panelAria.labelledBy }
              : {})}
            style={{
              '--dash-cell': `${cell()}px`,
              '--dash-pitch': `${pitch()}px`,
              ...(collapsed() ? {} : { height: `${gridHeight()}px` }),
            }}
            {...(collapsed() ? { 'data-collapsed': '' } : {})}
          >
            {/* Visible ONLY while a gesture is live — it appears on arm and vanishes on release,
                iOS-widget style. Nothing about the layout is discoverable chrome until a gesture
                makes it relevant. */}
            <Show when={gesture()}>
              <div class="dash-grid-overlay" aria-hidden="true" />
            </Show>
            <For each={panels()}>
              {(definition) => (
                <div
                  class="dash-slot"
                  ref={(el) => {
                    slots.set(definition.id, el)
                    onCleanup(() => slots.delete(definition.id))
                  }}
                  style={slotStyle(definition.id)}
                  tabindex={-1}
                  {...(gesture()?.id === definition.id ? { 'data-gesture': gesture()!.kind } : {})}
                  {...(keyboardGesture()?.id === definition.id
                    ? {
                      'aria-roledescription': 'movable panel',
                      'aria-label': `${definition.title}. Arrows move, shift and arrows resize, Enter to finish, Escape to cancel.`,
                    }
                    : {})}
                  onKeyDown={(event) => onSlotKeyDown(definition.id, event)}
                  onBlur={() => onSlotBlur(definition.id)}
                >
                  <Panel
                    definition={definition}
                    actions={chrome(definition)}
                    headProps={collapsed()
                      ? {}
                      : { onPointerDown: (event: PointerEvent) => beginDrag(definition.id, event) }}
                  />
                  <Show when={!collapsed()}>
                    {handle(definition.id, 'e')}
                    {handle(definition.id, 's')}
                    {handle(definition.id, 'se')}
                  </Show>
                  {/* Sighted keyboard users got strictly less than screen-reader users here: the live
                      region below said where the panel was and nothing on screen did. This is the
                      same computed string drawn a second time, so it carries no state of its own. */}
                  <Show when={keyboardGesture()?.id === definition.id}>
                    <div class="dash-caption" aria-hidden="true">{announcement()}</div>
                  </Show>
                </div>
              )}
            </For>
            {/* The candidate cells, under the panel that is floating above them — the shape of the
                panel that will land there rather than a wireframe of it. */}
            <Show when={gesture()?.kind === 'move'}>
              <div class="dash-placeholder" aria-hidden="true" style={placeholderStyle()} />
            </Show>
          </div>
          <div class="dash-live" aria-live="polite">{announcement()}</div>
        </Show>

        {/* CREATION IS STAGED, EDITING IS NOT (docs/dashboards.md § The generated editor). The
            wizard exists because a panel that does not exist yet cannot be judged from a form; an
            existing one is already on screen, so its editor is the whole sheet at once. The sheet
            remains able to do everything the wizard can — the wizard's footer hands the draft
            straight to it. */}
        <Show when={adding()}>
          <PanelWizard
            collections={collections()}
            {...(views() ? { views: views()! } : {})}
            scope={props.scope}
            onClose={() => setAdding(false)}
            onOpenEditor={(panel) => setEditing({ panel, creating: true })}
            onCreate={(panel, scope, rect) => {
              savePanel(panel)
              placePanelAt(scope, panel.id, rect)
            }}
          />
        </Show>

        <Show when={editing()}>
          {(session) => (
            <PanelEditor
              collections={collections()}
              {...(views() ? { views: views()! } : {})}
              {...(session().panel ? { panel: session().panel } : {})}
              {...(session().creating ? { creating: true } : {})}
              onClose={() => setEditing(undefined)}
              onSave={(panel) => {
                savePanel(panel)
                // Placed only when it is not already here. An edit that re-placed the panel would
                // silently move it to the end of the grid every time somebody changed its title —
                // and now would also throw away its rect.
                if (!panels().some((entry) => entry.id === panel.id)) placePanel(props.scope, panel.id)
              }}
            />
          )}
        </Show>
      </section>
    </Show>
  )
}
