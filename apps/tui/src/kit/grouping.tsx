/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show, type JSX } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import type { Size, Space, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import { isCompact } from '../appearance'
import { flatten, Line, slot } from './cells'
import { borderCell, boxBorder, spaceCells, spaceLines } from './roles'
import { trapKeys } from '../keys/trap'
import { bindKeys } from '../keys/install'
import { markTabStop, moveFocusFrom, moveRegion } from '../keys/regions'
import { ScrollViewport } from './scrolling'
import type { KitSection } from '@acorn/client-core/kit/components/layout/Sections.tsx'

// The kit's grouping nodes in cells, each drawn to its sentence in
// docs/ui-design.md § Every node at 80 by 24 and no further.
//
// A terminal has no floating layer and no scrim, so the three overlay nodes flatten: a `Modal` is a
// bordered box where the pane would go, a `Menu` is a list in a box under its trigger, and a
// `Popover` is a full-width block. The keys that make them modal are the keymap's, not theirs: a
// `Modal` and an open `Menu` push a layer above the pane's that answers `dismiss` and swallows the
// rest (../keys/trap.ts, docs/tui.md § Traps).

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
    <box flexDirection="row" flexWrap={props.wrap ? 'wrap' : 'no-wrap'} gap={spaceCells(props.gap ?? 'inline')}>
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
  // Registered so `activate` can reach it once phase 2 gives a fold its own focus stop. Until then a
  // fold opens where its pane sets `open`, which is what the controlled panes already do.
  const toggle = () => {
    const next = !open()
    setLocal(next)
    props.onOpenChange?.(next)
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1} flexShrink={0} onMouseDown={toggle}>
        <Line role="body">{open() ? '▾' : '▸'}</Line>
        <Line role="strong">{props.label}</Line>
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
  return (
    <box flexDirection="row" flexShrink={0} marginTop={isCompact() ? 0 : 1} marginBottom={isCompact() ? 0 : 1}>
      <Show when={props.stripe}>
        {(tone) => <Line tone={tone()}>{borderCell('stripe').glyph}</Line>}
      </Show>
      <box
        flexGrow={1}
        flexDirection="column"
        {...boxBorder('surface', { when: !isCompact() })}
        title={props.title}
        paddingLeft={isCompact() ? 0 : 1}
        paddingRight={isCompact() ? 0 : 1}
      >
        {props.children}
      </box>
    </box>
  )
}

/** Cards in sequence with a dim rule between turns. `follow` is a no-op: a column of cells pins to
 *  its last child by construction, and the scroll is the region's. */
export function Timeline(props: { ariaLabel?: string; follow?: boolean; viewKey?: string; children: JSX.Element }) {
  return <box flexDirection="column" flexGrow={1}>{props.children}</box>
}

/** One turn in a `Timeline`. The compound half, and it has to exist: `Timeline.Turn` on a `Timeline`
 *  with no `Turn` is `undefined` passed to `createComponent`, which is a pane that fails to draw
 *  rather than a pane that draws badly. Found by the pane sweep, on the PR conversation
 *  (docs/tui.md). */
Timeline.Turn = (props: { children: JSX.Element }) => (
  <box flexDirection="column" marginTop={spaceLines('row')}>{props.children}</box>
)

/** `Tab  [Tab]  Tab` on one line, the selected one in brackets.
 *
 *  Each label in a box that refuses to shrink, for the reason `../kit/cells.tsx` § Run gives about a
 *  row of `text` renderables: yoga takes a width deficit out of every child that will give, and a
 *  `text` shrunk below its content clips itself rather than the row. A strip too narrow for its tabs
 *  drew `[PR review]Agent` with the gap eaten and every later gap down to one cell. Refusing to
 *  shrink means the row clips at its end instead, which is the answer every block node in this file
 *  gives and the one a terminal gives. */
export function Tabs(props: {
  tabs: readonly { id: string; label: string; count?: number }[]
  active: string
  onChange: (id: string) => void
  idPrefix: string
  ariaLabel: string
  actions?: JSX.Element
  /** This strip is the structural parent of the region content below it. */
  entry?: boolean
}) {
  const step = (delta: 1 | -1): boolean => {
    const at = props.tabs.findIndex((tab) => tab.id === props.active)
    const next = props.tabs[at + delta]
    // A tab edge is a wall. Escape owns the upward/back edge; letting a failed Left bubble to the
    // region layer made the first tab unexpectedly throw the reader back into the rail.
    if (!next) return true
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
      ref={(element: BoxRenderable) => {
        markTabStop(element, props.entry)
        bindKeys(element, [
          ...['left', 'h'].map((key) => ({ key, cmd: () => step(-1) })),
          ...['right', 'l'].map((key) => ({ key, cmd: () => step(1) })),
          // The selected panel is the next stop in the same region. A top-level pane strip is its
          // own region, so its Down edge continues into the following pane region instead.
          ...['down', 'j'].map((key) => ({
            key,
            cmd: () => moveFocusFrom(element, 1) || moveRegion(1),
          })),
        ], 45, { mode: 'focus' })
      }}
    >
      <For each={props.tabs}>
        {(tab) => (
          // `height={1}`, because a wrapped flex line is as tall as its tallest child and a child
          // with no height of its own takes the container's — which drew the second row of tabs three
          // rows below the first.
          <box flexShrink={0} height={1}>
            <Line role={props.active === tab.id ? 'strong' : 'body'} tone={props.active === tab.id ? 'accent' : undefined}>
              {props.active === tab.id ? `[${tab.label}]` : tab.label}
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
export function TabPanel(props: { idPrefix: string; id: string; active: string; children: JSX.Element }) {
  return (
    <ScrollViewport visible={props.active === props.id}>
      {props.children}
    </ScrollViewport>
  )
}

export function Toolbar(props: { variant?: 'bar' | 'actions'; size?: 'sm' | 'md'; ariaLabel?: string; children: JSX.Element }) {
  return <box flexDirection="row" gap={spaceCells('inline')}>{props.children}</box>
}

/** `flexGrow` on an empty box is what "push what follows to the far end" is in a cell layout. */
export const ToolbarSpacer = () => <box flexGrow={1} />
Toolbar.Spacer = ToolbarSpacer
Toolbar.Group = (props: { children: JSX.Element }) => <box flexDirection="row">{props.children}</box>

/** A centred box over the content. Nothing dims behind it, because dimming a whole screen of cells
 *  costs a repaint of every one of them and buys a reader who can already see the border nothing.
 *
 *  What makes it modal is the key layer it owns. `keys/trap.ts` on the DOM contains Tab by walking
 *  focusable elements; there is nothing to walk here, so a modal traps by pushing a layer above the
 *  pane's that answers `dismiss` and swallows the rest until it closes
 *  (docs/tui.md § Traps). That is what a terminal modal is, and it is
 *  the same thing the shell's overlay stack does (../chrome/state.ts). */
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
  trigger: (state: { open: () => boolean; toggle: () => void }) => JSX.Element
  placement?: string
  ariaLabel: string
  open?: () => boolean
  onOpenChange?: (open: boolean) => void
  children: (context: { close: () => void }) => JSX.Element
}) {
  const [local, setLocal] = createSignal(false)
  const open = () => props.open?.() ?? local()
  const set = (next: boolean) => {
    setLocal(next)
    props.onOpenChange?.(next)
  }
  return (
    <box flexDirection="column">
      {props.trigger({ open, toggle: () => set(!open()) })}
      <Show when={open()}>
        {/* Open, so it owns the layer: the same trap a `Modal` is, mounted and unmounted with the
            list rather than with the trigger. */}
        <MenuList close={() => set(false)}>{props.children({ close: () => set(false) })}</MenuList>
      </Show>
    </box>
  )
}

/** The open half of a `Menu`, so the trap's life is the list's rather than the trigger's: a component
 *  that only exists while the list is open takes the keys on mount and gives them back on unmount. */
function MenuList(props: { close: () => void; children: JSX.Element }) {
  trapKeys(() => props.close())
  return (
    <box flexDirection="column" {...boxBorder('surface')} paddingLeft={1} paddingRight={1}>
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
}) => (
  <box
    flexDirection="row"
    gap={1}
    onMouseDown={() => {
      if (props.disabled) return
      props.onSelect()
      if (props.closeOnSelect !== false) props.context.close()
    }}
  >
    {slot(props.leading)}
    <Line tone={props.disabled ? 'muted' : props.tone === 'danger' ? 'danger' : undefined}>{flatten(props.children)}</Line>
    <box flexGrow={1} />
    {slot(props.trailing)}
  </box>
)

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
    <box flexDirection="column">
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
  let box: BoxRenderable | undefined
  const [width, setWidth] = createSignal(NARROW_AT)
  const narrow = () => width() < NARROW_AT
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      ref={(element: BoxRenderable) => { box = element; setWidth(element.width) }}
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
    <box flexDirection="column" flexGrow={1} overflow={props.scroll ? 'scroll' : 'visible'}>
      {/* In a box of its own so the deficit a taller-than-the-screen column creates cannot be taken out
          of the label: a one-line run given half a line lands on the line above it, which drew this
          column's own name over the heading under it
          (docs/tui.md). */}
      <Show when={props.label}><box flexShrink={0}><Line role="eyebrow">{props.label!}</Line></box></Show>
      {props.children}
    </box>
  )
}

export function DetailColumn(props: { scroll?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1} overflow={props.scroll ? 'scroll' : 'visible'}>
      {props.children}
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
  return (
    <box flexDirection="row" gap={2}>
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
  let box: BoxRenderable | undefined
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
      ref={(element: BoxRenderable) => {
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
          entry
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
