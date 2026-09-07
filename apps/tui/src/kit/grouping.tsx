/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js'
import type { Renderable } from '../tree/compat'
import { COLLECTION_INTENTS, createCollectionIntents } from '@acorn/client-core/kit/keys/collectionIntents.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import type { Size, Space, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import { isTyping } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { isCompact } from '../appearance'
import { flatten, Line, slot } from './cells'
import { GLYPHS } from './glyphs'
import { borderCell, boxBorder, litControl, spaceCells, spaceLines } from './roles'
import { trapKeys } from '../keys/trap'
import { bindKeys } from '../keys/install'
import {
  enterParent, focusedRenderable, markParent, moveRegion, panelsChanged, pushScope, walkStops,
} from '../keys/regions'
import { stop } from '../keys/stops'
import { LIST, OVERLAY_OWN, PARENT } from '../keys/tiers'
import { ScrollViewport, type Viewport } from './scrolling'
import type { KitSection } from '@acorn/client-core/kit/components/layout/Sections.tsx'

// The kit's grouping nodes in cells, each drawn to its sentence in
// docs/ui-design.md § Every node at 80 by 24 and no further.
//
// A terminal has no floating layer and no scrim, so the three overlay nodes flatten: a `Modal` is a
// bordered box drawn in flow, a `Menu` is a list in a box under its trigger, and a `Popover` is a
// full-width block. Where a `Modal` lands is the caller's: the shell gives its overlays the whole
// screen under the topbar (../chrome/Shell.tsx), and a pane's own `Modal` draws inside the pane.
// The keys that make them modal are the store's and the keymap's, not theirs: a `Modal` and an open
// `Menu` push a scope, which is the box the keys are contained in, and a layer above the pane's that
// answers `dismiss` (../keys/regions.ts § Scopes, ../keys/trap.ts, docs/tui.md § Traps).

// `flexShrink={0}` on every block node in this file, and on the rows in ./showing.tsx. A terminal's
// answer to "there is not enough room" is to clip, never to squeeze: yoga's default is to take a
// height deficit out of every child that will give, and a one-line row given half a line lands on the
// line above it — which drew the PR pane as two screens interleaved character by character
// (docs/tui.md). The region that holds them scrolls or clips, which is
// the reader's own answer.
export function Stack(props: { gap?: Space; children: JSX.Element }) {
  return <box flexDirection="column" flexShrink={0} gap={spaceLines(props.gap ?? 'stack')}>{props.children}</box>
}

export function Inline(props: { gap?: Space; wrap?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="row" flexWrap={props.wrap ? 'wrap' : 'nowrap'} gap={spaceCells(props.gap ?? 'inline')}>
      {props.children}
    </box>
  )
}

export function Section(props: { label: string; count?: number; actions?: JSX.Element; sticky?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexShrink={0} marginTop={spaceLines('section')}>
      <box flexDirection="row" gap={1}>
        <Line role="eyebrow">{props.label}</Line>
        <Show when={props.count !== undefined}><Line role="muted">{String(props.count)}</Line></Show>
        {slot(props.actions)}
      </box>
      {props.children}
    </box>
  )
}

/** `▸ label` closed, `▾ label` open, children indented two cells. Uncontrolled state is the kit's,
 *  the same rule the DOM fold keeps; `persistKey` has nowhere to persist to yet and is ignored. */
export function Fold(props: {
  label: string
  count?: number
  meta?: JSX.Element
  actions?: JSX.Element
  level?: 'pane' | 'group' | 'sub'
  persistKey?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: JSX.Element
}) {
  const [local, setLocal] = createSignal(props.defaultOpen ?? false)
  const open = () => (props.onOpenChange ? props.open ?? false : local())
  const toggle = () => {
    const next = !open()
    setLocal(next)
    props.onOpenChange?.(next)
  }
  // The header row is the stop, and the children stay after it as siblings, so reading order runs
  // header then contents: `↓` from an open fold's header enters its first child.
  const control = stop({ onPress: toggle })
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
        <Line {...litControl({ focused: control.focused() })}>{open() ? '▾' : '▸'}</Line>
        <Line {...litControl({ focused: control.focused(), strong: true })}>{props.label}</Line>
        <Show when={props.count !== undefined}><Line role="muted">{String(props.count)}</Line></Show>
        {slot(props.meta)}
        {slot(props.actions)}
      </box>
      <Show when={open()}>
        <box flexDirection="column" paddingLeft={2}>{props.children}</box>
      </Show>
    </box>
  )
}

/** A box-drawing frame, or a blank line above and below in compact density. The `stripe` tone is the
 *  `border` role's own answer: one column of `▍` in the tone's colour. */
export function Card(props: {
  interactive?: boolean
  selected?: boolean
  stripe?: Extract<Tone, 'accent' | 'ok' | 'warn' | 'danger'>
  pad?: Extract<Size, 'sm' | 'md'>
  disabled?: boolean
  onPress?: () => void
  title?: string
  focus?: boolean
  children: JSX.Element
}) {
  const control = stop({
    onPress: () => props.onPress?.(),
    disabled: () => !!props.disabled,
  })
  // A focused card draws its own frame in the accent tone, which is the nearest thing a box has to a
  // focus ring. Compact density draws no frame at all, so there the stripe column stands in — the same
  // one cell of `▍` a toned card already spends (../kit/roles.ts § borderCell).
  const lit = () => control.focused()
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      marginTop={isCompact() ? 0 : 1}
      marginBottom={isCompact() ? 0 : 1}
      ref={(element: Renderable) => { if (props.onPress) control.ref(element) }}
    >
      <Show when={props.stripe || lit()}>
        <Line tone={lit() ? 'accent' : props.stripe}>{borderCell('stripe').glyph}</Line>
      </Show>
      <box
        flexGrow={1}
        flexDirection="column"
        {...boxBorder('surface', { when: !isCompact(), ...(lit() ? { tone: 'accent' as const } : {}) })}
        title={props.title}
        paddingLeft={isCompact() ? 0 : 1}
        paddingRight={isCompact() ? 0 : 1}
      >
        {props.children}
      </box>
    </box>
  )
}

/** Cards in sequence with a dim rule between turns.
 *
 *  `follow` makes this node the scroller and holds it on the last turn, which is what it means on the
 *  DOM too: there, `.ui-timeline-scroll` is the scroll container and `.layout-region-detail` around it
 *  is `overflow: hidden` (client-core/infra/styles/shell.css). The terminal keeps that division. It
 *  matters for what sits beside the timeline rather than for the timeline itself: the agents pane's
 *  detail column is a header, this, and the composer, and only a transcript that owns its own scroll
 *  leaves the other two pinned where the reader can always reach them. While the whole column
 *  scrolled, typing a message meant first finding the box.
 *
 *  Held on the last turn only while the reader is already there. Scrolling up to read history stops
 *  it and coming back to the foot starts it again, which is the viewport's own rule (./scrolling.tsx
 *  § place).
 *
 *  Without `follow` it is a plain column and whatever is around it scrolls, which is what github's
 *  pull request conversation wants.
 *
 *  `viewKey` is dropped. It is the DOM's per-view scroll memory, and this host has one offset per
 *  mounted viewport rather than a map of remembered ones.
 *
 *  `props.follow` is read once rather than through a `Show`, because it is a constant at every call
 *  site and a reactive read would rebuild every turn the moment it flipped. */
export function Timeline(props: { ariaLabel?: string; follow?: boolean; viewKey?: string; children: JSX.Element }) {
  if (!props.follow) return <box flexDirection="column" flexGrow={1}>{props.children}</box>
  let view: Viewport | undefined
  return (
    <ScrollViewport onBox={(box) => { view = box }}>
      {/* An inner box sized by the turns. The viewport's content box is free-sized, so this one's
          height is the turns' own — which is the event `follow` is about. Reading the viewport's own
          height instead would chase every change in the region around it. */}
      <box
        flexDirection="column"
        flexShrink={0}
        onSizeChange={() => view?.stickToBottom()}
      >
        {props.children}
      </box>
    </ScrollViewport>
  )
}

/** One turn in a `Timeline`. The compound half, and it has to exist: `Timeline.Turn` on a `Timeline`
 *  with no `Turn` is `undefined` passed to `createComponent`, which is a pane that fails to draw
 *  rather than a pane that draws badly. Found by the pane sweep, on the PR conversation
 *  (docs/tui.md). */
Timeline.Turn = (props: { children: JSX.Element }) => (
  <box flexDirection="column" marginTop={spaceLines('row')}>{props.children}</box>
)

// ── Which panels a strip owns ─────────────────────────────────────────────────────────────────
//
// A strip and its panels are siblings, so neither can reach the other by walking the tree, and the
// relation has to be named somewhere. `idPrefix` is that name: both nodes already require it, for
// exactly this pairing on the DOM, where it builds the `aria-controls` ids. So the terminal reads the
// same prop rather than asking a caller for a second one.
//
// Not a Solid context, which would work for `Sections` — where `Tabs` and `TabPanel` share a parent
// component — and fail for the plugins that draw the two halves in sibling components (the editor's
// side strip draws its Search panel from a component of its own).
//
// One map for the whole host, keyed by a string, and the ceiling that comes with that: two strips
// sharing a prefix would share a panel set. Nothing on this host can do it — one pane is mounted at a
// time (../chrome/PaneRow.tsx) — and `Sections` keys its prefix by the surface id anyway.
//
// An array rather than a set, and the same array every time. `markParent` hands the region store a
// getter, the store asks it while it walks the tree, and a getter that built `[...set]` per call
// allocated one array per parent stop per node visited (../keys/regions.ts § isPanel). The list only
// changes when a panel mounts or unmounts, so it is rebuilt there and handed back by reference.
const panelsByPrefix = new Map<string, Renderable[]>()

/** No prefix has any panels yet, without minting an array to say so. */
const NO_PANELS: readonly Renderable[] = []

/** The panels a strip owns, as the stored list. Never mutated by a caller. */
export const panelsFor = (idPrefix: string): readonly Renderable[] => panelsByPrefix.get(idPrefix) ?? NO_PANELS

/** Give a strip a panel to own, for as long as the caller is drawn.
 *
 *  `TabPanel` calls this for itself. The `tabs` layout frames its panel with `Panel` instead of a
 *  `TabPanel` and calls this directly, which is the only other way a panel gets drawn. */
export function registerPanel(idPrefix: string, box: Renderable): void {
  panelsByPrefix.set(idPrefix, [...panelsFor(idPrefix), box])
  // And the store, which keeps a set of every panel on screen so that "is this box somebody's panel"
  // is one lookup rather than a scan of the strips. It is derived from these same lists, so this says
  // they moved rather than saying anything the strips do not already know
  // (../keys/regions.ts § panelBoxes).
  panelsChanged()
  onCleanup(() => {
    const rest = panelsFor(idPrefix).filter((panel) => panel !== box)
    if (rest.length) panelsByPrefix.set(idPrefix, rest)
    else panelsByPrefix.delete(idPrefix)
    panelsChanged()
  })
}

/** The mark a tab carries goes in front of its label rather than beside it, because a cell row has
 *  no baseline to align an icon against. A Lucide name with no glyph of its own drops out
 *  (../kit/glyphs.ts), and `title` has nowhere to hover. */
const labelOf = (tab: { label: string; icon?: string }): string => {
  const glyph = tab.icon ? GLYPHS[tab.icon] : undefined
  return glyph ? `${glyph} ${tab.label}` : tab.label
}

/** `Tab  [Tab]  Tab` on one line, the selected one in brackets.
 *
 *  Each label in a box that refuses to shrink, for the reason `../kit/cells.tsx` § Run gives about a
 *  row of `text` renderables: yoga takes a width deficit out of every child that will give, and a
 *  `text` shrunk below its content clips itself rather than the row. A strip too narrow for its tabs
 *  drew `[PR review]Agent` with the gap eaten and every later gap down to one cell. Refusing to
 *  shrink means the row clips at its end instead, which is the answer every block node in this file
 *  gives and the one a terminal gives. */
export function Tabs(props: {
  tabs: readonly { id: string; label: string; count?: number; icon?: string; title?: string }[]
  active: string
  onChange: (id: string) => void
  idPrefix: string
  ariaLabel: string
  actions?: JSX.Element
}) {
  const step = (delta: 1 | -1): boolean => {
    const at = props.tabs.findIndex((tab) => tab.id === props.active)
    const next = props.tabs[at + delta]
    // An edge is a bubble, not a wall: with nothing to the left there is nothing for this strip to
    // do, so the key goes down the tiers and the region tier moves one column. Left in every control
    // now means the same thing, and the footer says `column` where that is what the key will do
    // (docs/tui.md § The five key groups). The retired rule claimed the key and moved nothing, which
    // made one key mean five things across one screen.
    if (!next) return false
    props.onChange(next.id)
    return true
  }
  return (
    // Wrapped rather than clipped. A strip is only useful if every tab on it is readable, and a pull
    // request has seven — which at a hundred cells fits and at sixty does not, and the half that did
    // not fit was drawn over whatever sat beside it. Two lines of tabs cost one row and lose nothing.
    // `columnGap` rather than `gap`: yoga's `gap` sets both axes, so two cells between tabs was also
    // two blank rows between wrapped lines.
    <box
      flexDirection="row"
      flexWrap="wrap"
      columnGap={2}
      rowGap={0}
      flexShrink={0}
      overflow="hidden"
      ref={(element: Renderable) => {
        // Which nodes are reachable is declared where the node is built, and this is where a strip is
        // built. `markParent` used to set the flag, which put the one declaration a `Tabs` makes
        // about itself in the region store (../keys/regions.ts § markParent).
        element.focusable = true
        // A strip with panels is a parent stop: Down enters the one it is showing and Escape from
        // anything inside that panel comes back here. A strip with none — GitHub's Open/Closed
        // filter — owns an empty set and stays an ordinary control, which is what `markParent`'s
        // getter is for.
        // `step` as well, so Left and Right from a control inside one of those panels change the tab
        // rather than leaving the pane (../keys/regions.ts § crossParent).
        markParent(element, () => panelsFor(props.idPrefix), step)
        bindKeys(element, [
          ...['left', 'h'].map((key) => ({ key, cmd: () => step(-1) })),
          ...['right', 'l'].map((key) => ({ key, cmd: () => step(1) })),
          // Into the panel this strip is showing. A strip with no panels — a filter — falls through
          // to the next stop beside it, and a top-level pane strip is its own region, so its Down
          // edge continues into the following pane region instead.
          ...['down', 'j'].map((key) => ({
            key,
            cmd: () => enterParent(element) || walkStops(element, 1) || moveRegion(1),
          })),
          // And back out the way it came. Up is the previous stop beside the strip and nothing else:
          // a strip is one stop from outside, so its own tabs are not what Up walks. `walkStops`
          // answers false where the strip is the first stop in the box around it, which is the
          // bubble the contract asks for (docs/tui.md § The five key groups). Without this a strip
          // was the one stop on the screen with no Up at all: a reader who reached a `Sections` strip
          // by walking down to it had no arrow that took them back off it.
          ...['up', 'k'].map((key) => ({ key, cmd: () => walkStops(element, -1) })),
        ], PARENT, { mode: 'focus' })
      }}
    >
      <For each={props.tabs}>
        {(tab) => (
          // `height={1}`, because a wrapped flex line is as tall as its tallest child and a child
          // with no height of its own takes the container's — which drew the second row of tabs three
          // rows below the first.
          <box flexShrink={0} height={1}>
            <Line role={props.active === tab.id ? 'strong' : 'body'} tone={props.active === tab.id ? 'accent' : undefined}>
              {props.active === tab.id ? `[${labelOf(tab)}]` : labelOf(tab)}
              {tab.count === undefined ? '' : ` ${tab.count}`}
            </Line>
          </box>
        )}
      </For>
      <box flexGrow={1} />
      {slot(props.actions)}
    </box>
  )
}

/** The panel half. `hidden` rather than unmounting, the same thunk rule the DOM layout keeps, so a
 *  panel holds its state across a switch. */
export function TabPanel(props: {
  idPrefix: string
  id: string
  active: string
  children: JSX.Element
}) {
  return (
    <ScrollViewport
      visible={props.active === props.id}
      onBox={(box) => registerPanel(props.idPrefix, box)}
    >
      {props.children}
    </ScrollViewport>
  )
}

/** A bar of controls.
 *
 *  It wraps rather than clips. A bar is written for a window and drawn here in a pane column — the
 *  agents pane header is four controls and a title in about fifty cells — and a row that shrinks its
 *  children cuts their labels to `[Sessio` and `[ Ne`, which names nothing. Yoga moves what does not
 *  fit onto the next line before it shrinks anything, so an overfull bar costs a line instead of its
 *  words, and a bar that fits is laid out exactly as it was.
 *
 *  The gap is the column gap alone. Yoga's `gap` sets both axes, so a wrapped bar gained a blank row
 *  between its lines.
 *
 *  Nothing here wraps `props.children`. A context provider around them would put them inside a memo
 *  of Solid's own, and re-running a toolbar's children as a unit used to break the changes pane: a
 *  callback-form `<Show>` in that bar had its accessor read again after its condition went false,
 *  which stock Solid refuses as `Stale read from <Show>`. Our copy holds the last value instead
 *  (patches/README.md), but the bar still has no reason to re-run its children. An open panel widens
 *  itself instead (§ `Menu`). */
export function Toolbar(props: { variant?: 'bar' | 'actions'; size?: 'sm' | 'md'; ariaLabel?: string; children: JSX.Element }) {
  return <box flexDirection="row" flexWrap="wrap" columnGap={spaceCells('inline')}>{props.children}</box>
}

/** `flexGrow` on an empty box is what "push what follows to the far end" is in a cell layout. */
export const ToolbarSpacer = () => <box flexGrow={1} />
Toolbar.Spacer = ToolbarSpacer
Toolbar.Group = (props: { children: JSX.Element }) => <box flexDirection="row">{props.children}</box>

/** A centred box over the content. Nothing dims behind it, because dimming a whole screen of cells
 *  costs a repaint of every one of them and buys a reader who can already see the border nothing.
 *
 *  What makes it modal is the scope it pushes. `keys/trap.ts` on the DOM contains Tab by walking
 *  focusable elements; there is nothing to walk here, so the box itself goes on the region store's
 *  scope stack while it is drawn and the store stops answering for anything behind it. Tab then has
 *  nowhere to go rather than walking behind the dialog. The one key layer left is the one that
 *  closes it (docs/tui.md § Traps). The shell's overlay stack answers a different question, which is
 *  which overlay to draw (../chrome/state.ts). */
export function Modal(props: {
  onDismiss: () => void
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'wide'
  align?: 'top' | 'center'
  layout?: 'stack' | 'split'
  role?: 'dialog' | 'alertdialog'
  dismissOn?: readonly ('escape' | 'backdrop')[]
  labelledBy?: string
  children: JSX.Element
}) {
  // Open is mounted, so the trap's life is this component's: it takes the keys now and gives them
  // back when the caller stops drawing it.
  if (props.dismissOn === undefined || props.dismissOn.includes('escape')) trapKeys(() => props.onDismiss())
  return (
    <box
      flexDirection="column"
      {...boxBorder('surface')}
      title={props.title}
      paddingLeft={1}
      paddingRight={1}
      // Containing the keys and landing them are two halves of one thing, and pushing the scope is
      // both: the store lands them on the first stop inside the box and answers nothing behind it.
      // Only the first half used to be here, so unless the caller also reached for a focus helper of
      // this app's the reader got a dialog they could not answer. Every modal a plugin draws was in
      // that state, because a plugin only has the kit (../keys/regions.ts § pushScope).
      ref={(element: Renderable) => onCleanup(pushScope(element))}
    >
      {props.children}
    </box>
  )
}

/** The lines between the title rule and the actions line. */
export function ModalBody(props: { children: JSX.Element }) {
  return <box flexDirection="column" flexGrow={1}>{props.children}</box>
}

/** The compound spellings, so a pane may write either.
 *
 *  `ModalBody` and `Modal.Body` are the same node under two names — the kit table flattens compound
 *  halves and a pane writes whichever reads better at its call site. The DOM kit carries both; this
 *  one carried only the flat pair, so eight panes in the roster did not compile
 *  (docs/tui.md). */
export function ModalActions(props: { children: JSX.Element }) {
  return (
    <box flexDirection="row" gap={1} marginTop={spaceLines('section')}>
      <box flexGrow={1} />
      {props.children}
    </box>
  )
}

/** A vertical list in a box. The trigger draws in place; the list opens under it rather than over
 *  anything, because there is no layer to open over. */
export function Menu(props: {
  /** `focused` is this host's addition to the shared trigger state, and it is the one thing a cell
   *  trigger cannot work out for itself: the box the keys are bound to is the menu's, not its. */
  trigger: (state: { open: () => boolean; toggle: () => void; focused: () => boolean }) => JSX.Element
  placement?: string
  ariaLabel: string
  open?: () => boolean
  onOpenChange?: (open: boolean) => void
  disabled?: () => boolean
  children: (context: { close: () => void }) => JSX.Element
}) {
  const [local, setLocal] = createSignal(false)
  const open = () => props.open?.() ?? local()
  const set = (next: boolean) => {
    setLocal(next)
    props.onOpenChange?.(next)
  }
  const control = stop({
    onPress: () => set(!open()),
    disabled: () => props.disabled?.() ?? false,
    // Enter here opens the list rather than doing something, and the footer says so.
    opens: true,
  })
  return (
    // Open, the box claims the whole line it is on. A row shares its width between its children, so a
    // list laid out where its trigger sits gets the trigger's few cells: the agents pane's
    // New-session list drew `ClaAv`, a provider's name and its status colliding inside ten of them.
    // A full basis under the wrap in `Toolbar` above puts the box on a line of its own with the bar's
    // full width, which is what `Popover`'s sentence in docs/ui-design.md has always promised. There
    // is no floating layer here and no `overflow` to relax — clipping is unconditional
    // (../paint/paint.ts) — so widening the box is the only place the width can come from. Outside a
    // row this changes nothing: a box in a column is already the full width.
    <box flexDirection="column" {...(open() ? { flexBasis: '100%' as const } : {})}>
      {/* The trigger's characters are the caller's; the box around them is the stop. */}
      <box flexDirection="row" flexShrink={0} ref={control.ref}>
        {props.trigger({ open, toggle: () => set(!open()), focused: control.focused })}
      </box>
      <Show when={open()}>
        {/* Open, so it owns the layer: the same trap a `Modal` is, mounted and unmounted with the
            list rather than with the trigger. */}
        <MenuList close={() => set(false)}>{props.children({ close: () => set(false) })}</MenuList>
      </Show>
    </box>
  )
}

/** The open half of a `Menu`, so the scope's life is the list's rather than the trigger's: a
 *  component that only exists while the list is open contains the keys on mount and gives them back
 *  on unmount. */
function MenuList(props: { close: () => void; children: JSX.Element }) {
  trapKeys(() => props.close())
  return (
    <box
      flexDirection="column"
      {...boxBorder('surface')}
      paddingLeft={1}
      paddingRight={1}
      ref={(element: Renderable) => {
        // The keys go into the list and come back to the trigger when it closes, and nothing outside
        // the list answers while it is open (../keys/regions.ts § pushScope).
        onCleanup(pushScope(element))
        // `↓` and `↑` walk the list's own stops. Not a collection, because a menu's children are
        // whatever opened it — a run of options, a filter field and a list of rows, a plugin's own
        // nodes — and there is no item list to key one by. The design asked for a `Rows` here; a
        // `Rows` needs the items, and `MenuList` is handed a tree.
        //
        // `within` is the list rather than the neighbours of whatever has the keys, because the stops
        // behind an open list are not reachable while its scope holds them
        // (../keys/regions.ts § walkStops).
        const walk = (delta: 1 | -1) => () => walkStops(focusedRenderable(), delta, { within: element })
        bindKeys(element, [
          { key: 'j', cmd: walk(1) },
          { key: 'k', cmd: walk(-1) },
          { key: 'down', cmd: walk(1) },
          { key: 'up', cmd: walk(-1) },
        ], LIST)
        // And the arrows again, above the typing shadow, while a filter field inside this menu has
        // the keys. Two answers, because the two keys differ there: `j` in a picker's filter is a
        // `j`, and a list under a field is the only thing an arrow there could mean — the same
        // exception the palette takes above the dismiss layer (../keys/trap.ts § overlayKeys).
        //
        // A layer that comes and goes rather than a matcher on the pair, which is the shape the whole
        // typing gate has on this host: a matcher would switch the engine's active-key cache off for
        // the process and the footer asks it per render (../keys/tiers.ts § TYPING). The tier is only
        // reached while somebody is typing, and while somebody is typing the collection tier the
        // `LIST` pair above defers to is shadowed anyway, so nothing it was protecting is in reach.
        createEffect(() => {
          focusedRenderable()
          if (!isTyping()) return
          bindKeys(element, [
            { key: 'down', cmd: walk(1) },
            { key: 'up', cmd: walk(-1) },
          ], OVERLAY_OWN)
        })
      }}
    >
      {props.children}
    </box>
  )
}

Modal.Body = ModalBody
Modal.Actions = ModalActions

/** One action in a `Menu`. `onSelect` fires and the list closes.
 *
 *  A row rather than a button, because the only thing a reader can drive in a cell overlay is a
 *  collection — the same reason the quit confirmation is a list (../chrome/Shell.tsx). The context is
 *  the menu's own, so an item closes the list it is in. */
Menu.Item = (props: {
  context: { close: () => void }
  onSelect: () => void
  disabled?: boolean
  closeOnSelect?: boolean
  tone?: 'neutral' | 'danger'
  leading?: JSX.Element
  trailing?: JSX.Element
  title?: string
  children: JSX.Element
}) => {
  const control = stop({
    onPress: () => {
      props.onSelect()
      if (props.closeOnSelect !== false) props.context.close()
    },
    disabled: () => !!props.disabled,
  })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line tone="accent">{control.focused() ? '›' : ' '}</Line>
      {slot(props.leading)}
      <Line {...litControl({
        focused: control.focused(),
        disabled: props.disabled,
        tone: props.tone === 'danger' ? 'danger' : undefined,
      })}>
        {flatten(props.children)}
      </Line>
      <box flexGrow={1} />
      {slot(props.trailing)}
    </box>
  )
}

/** reduced: the panel opens as a full-width block under its anchor, not floating. That is the whole
 *  loss, and it is the one every terminal overlay takes. */
export function Popover(props: {
  trigger: (state: { open: () => boolean; toggle: () => void }) => JSX.Element
  placement?: string
  minWidth?: number | 'anchor'
  disabled?: boolean
  role?: 'menu' | 'listbox' | 'dialog'
  ariaLabel?: string
  onDismiss?: () => void
  children: JSX.Element | ((state: { close: () => void }) => JSX.Element)
}) {
  const [open, setOpen] = createSignal(false)
  const close = () => {
    setOpen(false)
    props.onDismiss?.()
  }
  return (
    // The whole line while it is open, for the reason `Menu` gives above. The composer's sent-context
    // preview and the pane header's usage panel are both toolbar children.
    <box flexDirection="column" {...(open() ? { flexBasis: '100%' as const } : {})}>
      {props.trigger({ open, toggle: () => (props.disabled ? undefined : setOpen(!open())) })}
      <Show when={open()}>
        <box flexDirection="column" {...boxBorder('surface')} paddingLeft={1} paddingRight={1}>
          {typeof props.children === 'function' ? props.children({ close }) : props.children}
        </box>
      </Show>
    </box>
  )
}

// The narrow ceiling for the two-column nodes. The same number the `list-detail` layout uses, and for
// the same reason: below it there is no room for a list and a document side by side. A node asks its
// own box how wide it turned out; nothing here reads the terminal.
const NARROW_AT = 80
const LIST_CELLS = 32

/** reduced: two columns above 80 cells, one at a time below. Which one is drawn below the ceiling is
 *  "the detail if there is one", because a caller that passed a detail has something to show. */
export function ListDetail(props: {
  list?: JSX.Element
  split?: boolean
  listLabel?: string
  listWidth?: 'narrow' | 'default' | 'wide'
  scrollDetail?: boolean
  detailAs?: 'div' | 'main'
  children: JSX.Element
}) {
  let box: Renderable | undefined
  const [width, setWidth] = createSignal(NARROW_AT)
  const narrow = () => width() < NARROW_AT
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      ref={(element: Renderable) => { box = element; setWidth(element.width) }}
      onSizeChange={() => setWidth(box?.width ?? NARROW_AT)}
    >
      {/* `split` is the form where both columns are children — a `ListColumn` and a `DetailColumn` —
          rather than one of them arriving in `list`. The DOM hands those straight to its grid; this
          gated on `list ?? split` and so drew an empty 32-cell gutter beside the pr pane's navigator
          for a `list` nobody passed (docs/tui.md).
          Below 80 cells the two stack instead of sitting side by side, which is this node's own
          answer to "one column at a time": it has no keys of its own to switch with, and a column of
          38 cells is a column nobody can read. */}
      <Show when={props.list !== undefined} fallback={
        <box flexDirection={narrow() ? 'column' : 'row'} flexGrow={1}>{props.children}</box>
      }>
        <Show when={!narrow()}>
          <box flexDirection="column" width={LIST_CELLS}>{props.list}</box>
          <box width={1}><Line>│</Line></box>
        </Show>
        <box flexDirection="column" flexGrow={1}>{props.children}</box>
      </Show>
    </box>
  )
}

/** reduced: the left column, or the whole width when the split has collapsed. The width is the
 *  parent's; this node draws the label and the scroll. */
export function ListColumn(props: { label?: string; scroll?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {/* In a box of its own so the deficit a taller-than-the-screen column creates cannot be taken out
          of the label: a one-line run given half a line lands on the line above it, which drew this
          column's own name over the heading under it
          (docs/tui.md). */}
      <Show when={props.label}><box flexShrink={0}><Line role="eyebrow">{props.label!}</Line></box></Show>
      {/* The label sits above the viewport and not inside it. It is the column's own name, so it
          stays put while the rows under it move; scrolling a heading off its own list leaves a
          reader looking at rows that belong to nothing. */}
      {props.scroll ? <ScrollViewport>{props.children}</ScrollViewport> : props.children}
    </box>
  )
}

export function DetailColumn(props: { scroll?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {props.scroll ? <ScrollViewport>{props.children}</ScrollViewport> : props.children}
    </box>
  )
}

/** absent: a terminal split moves by a key, not a grip. Nothing is drawn and nothing is a stop. */
export const SplitHandle = (_props: { axis: 'x' | 'y'; drag: unknown }) => null

/** One line of tab labels with a `×` on the current one. */
export function DocumentTabs(props: {
  tabs: readonly { id: string; label: string; dirty?: boolean; status?: 'ok' | 'warn' | 'muted'; ephemeral?: boolean; pending?: boolean; title?: string }[]
  active: string
  onActivate: (id: string) => void
  onClose?: (id: string) => void
  onPromote?: (id: string) => void
  actions?: JSX.Element
  idPrefix: string
  ariaLabel: string
}) {
  // A horizontal collection, the same shape `SegmentedControl` is and for the same reason: there is
  // nothing per tab to focus in one run of text, so the strip holds the keys and `←`/`→` move the
  // value. The list rules — what wraps, where the first press lands — are the shared ones
  // (client-core kit/keys/collectionIntents.ts).
  //
  // Not a parent stop, unlike a `Tabs` with panels. The document an editor tab opens is the layout's
  // own region below the strip, not a panel this strip owns, so `↓` leaves the strip by the ordinary
  // walk rather than entering something.
  const keys = createCollectionIntents({
    id: () => props.idPrefix,
    items: () => props.tabs.map((tab) => ({ key: tab.id, label: tab.label })),
    orientation: 'horizontal',
    // Moving opens, which is what a document strip means: a reader walking the tabs is reading them.
    selectOnMove: true,
    selected: () => props.active,
    onSelect: (id) => props.onActivate(id),
    land: () => {},
    onItem: () => false,
  })
  const control = stop({
    on: {
      ...Object.fromEntries(COLLECTION_INTENTS.map((intent) => [intent, () => keys.handle(intent)])),
      // The collection declines `activate` because `onItem` is false — there is no per-tab renderable
      // to stand on — so Enter is answered here: it re-opens whatever the caret is already on, which
      // is how a reader gets back to the document after walking away from it.
      activate: () => { props.onActivate(props.active); return true },
      delete: () => {
        if (!props.onClose) return false
        props.onClose(props.active)
        return true
      },
    } as Partial<Record<Intent, () => boolean>>,
  })
  return (
    <box flexDirection="row" gap={2} ref={control.ref}>
      {/* The caret every collection draws, for the reason the pane strip gives: the current tab is
          already marked, and a mark that means two things means neither (../chrome/PaneRow.tsx). */}
      <Line tone="accent">{control.focused() ? '\u203a' : ' '}</Line>
      <For each={props.tabs}>
        {(tab) => (
          <Line
            role={props.active === tab.id ? 'strong' : 'body'}
            tone={tab.dirty ? 'accent' : tab.status === 'warn' ? 'warn' : undefined}
          >
            {tab.label}{tab.dirty ? ' ●' : ''}{props.active === tab.id && props.onClose ? ' ×' : ''}
          </Line>
        )}
      </For>
      <box flexGrow={1} />
      {slot(props.actions)}
    </box>
  )
}

/** A bold line with its actions at the far end. */
export function SectionHeader(props: {
  level?: 'pane' | 'group' | 'sub'
  sticky?: boolean
  count?: number
  actions?: JSX.Element
  children: JSX.Element
}) {
  return (
    <box flexDirection="row" gap={1}>
      <Line role="strong">{flatten(props.children)}</Line>
      <Show when={props.count !== undefined}><Line role="muted">{String(props.count)}</Line></Show>
      <box flexGrow={1} />
      {slot(props.actions)}
    </box>
  )
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────────

/** Cells below which `main` stops being a column of its own and becomes the last tab.
 *
 *  Higher than `ListDetail`'s 80, and for a reason the two columns do not share. A list beside a
 *  detail is a picker beside a document, and a picker reads fine in thirty cells. Here both halves
 *  hold a document — a pull request's checks beside its diff — and a diff in half of 100 cells is a
 *  diff wrapped at 45, which is not a diff anybody reads. */
const MAIN_COLUMN_AT = 120

/** reduced: a strip of tabs over one panel, because a terminal has no second column to spend on six
 *  folds nobody can see the bottom of.
 *
 *  The tab order is the reading order the DOM draws down its column: the header, then each section.
 *  `main` keeps a column of its own while there is room for one and joins the strip below that, which
 *  is the same collapse `ListDetail` makes at its own width.
 *
 *  The strip is a real parent stop: Left/Right selects, Down enters the selected panel, Escape from
 *  that panel comes back, and a second Escape crosses to the rail (../keys/regions.ts). */
export function Sections(props: {
  id: string
  ariaLabel?: string
  header?: KitSection
  sections: readonly KitSection[]
  main?: KitSection
}) {
  let box: Renderable | undefined
  const [cells, setCells] = createSignal(MAIN_COLUMN_AT)
  const wide = () => cells() >= MAIN_COLUMN_AT && !!props.main
  const tabs = (): KitSection[] => [
    ...(props.header ? [props.header] : []),
    ...props.sections,
    ...(props.main && !wide() ? [props.main] : []),
  ]
  const [chosen, setChosen] = createSignal('')
  // Falls back rather than storing a default, so a surface whose section set changes under it lands
  // on its first tab instead of on nothing. The same rule the `tabs` layout keeps.
  const active = () => (tabs().some((tab) => tab.id === chosen()) ? chosen() : tabs()[0]?.id ?? '')
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      ref={(element: Renderable) => {
        box = element
        setCells(element.width)
      }}
      onSizeChange={() => setCells(box?.width ?? MAIN_COLUMN_AT)}
    >
      <box
        flexDirection="column"
        flexGrow={1}
        minWidth={0}
      >
        <Tabs
          tabs={tabs().map((tab) => ({ id: tab.id, label: tab.label, ...(tab.count === undefined ? {} : { count: tab.count }) }))}
          active={active()}
          onChange={setChosen}
          idPrefix={props.id}
          ariaLabel={props.ariaLabel ?? 'Sections'}
          {...(() => { const found = tabs().find((tab) => tab.id === active())?.actions; return found ? { actions: found() } : {} })()}
        />
        <For each={tabs()}>
          {(tab) => (
            <TabPanel idPrefix={props.id} id={tab.id} active={active()}>
              {tab.render()}
            </TabPanel>
          )}
        </For>
      </box>
      {/* `minWidth={0}` on both halves, because a flex child's floor is its own content and a diff is
          routinely wider than its share (../layouts/ListDetail.tsx). */}
      <Show when={wide() && props.main}>
        {(main) => (
          <box flexDirection="column" flexGrow={1} minWidth={0}>
            <SectionHeader {...(main().actions ? { actions: main().actions!() } : {})}>{main().label}</SectionHeader>
            <ScrollViewport>{main().render()}</ScrollViewport>
          </box>
        )}
      </Show>
    </box>
  )
}
