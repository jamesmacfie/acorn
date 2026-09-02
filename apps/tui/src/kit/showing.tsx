/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Index, Show, untrack, type JSX } from 'solid-js'
import type { BoxRenderable, MouseEvent } from '@opentui/core'
import type { Size, TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import {
  COLLECTION_INTENTS, createCollectionIntents, type CollectionItem,
} from '@acorn/client-core/kit/keys/collectionIntents.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import type { CodeRow, DiffFile, Row as DiffRowT } from '@acorn/client-core/kit/diff/diffModel.ts'
import { buildDiffRows, plainTokenize } from '@acorn/client-core/kit/diff/diffModel.ts'
import type { PluginAnnotationKey } from '@acorn/protocol/extensionPoints.ts'
import { annotationKey } from '@acorn/client-core/host/annotations/annotationKey.ts'
import { annotationsFor, requestAnnotations } from '@acorn/client-core/host/annotations/annotations.ts'
import { createCellCollection, type ItemProps } from '../keys/collection'
import { stop } from '../keys/stops'
import { flatten, hasNode, Line, pad, Run, runStyle, slot } from './cells'
import { markdownLines, type Line as MarkdownLine } from './markdown'
import { borderCell, litControl, rule, spaceCells } from './roles'
import { GLYPHS } from './glyphs'
import { spinnerFrame } from './tick'
import { focusRenderable, focusedRenderable, scheduleSettle } from '../keys/regions'

// The kit's showing nodes in cells. One component per sentence in
// docs/ui-design.md § Every node at 80 by 24; where a node is `reduced`, `support.ts` says what is
// lost and the component loses exactly that.

export function Text(props: { emphasis?: TextRole; tone?: Tone; wrap?: boolean; children: JSX.Element }) {
  return <Line role={props.emphasis} tone={props.tone} wrap={props.wrap}>{props.children}</Line>
}

/** The text, underlined, pressable. Underline is the `control` border role's answer, which is what a
 *  link is: a run of text with an edge under it. */
export function Link(props: { href?: string; onPress?: () => void; children: JSX.Element }) {
  // A link with a handler presses it. A link with only an `href` prints the URL on the line below,
  // which is what this host already does with anything it cannot open for you (../kit/copy.ts) —
  // there is no browser to hand it to and a terminal's own OSC 8 support is not something to guess at.
  const [shown, setShown] = createSignal(false)
  const control = stop({
    onPress: () => {
      if (props.onPress) return props.onPress()
      if (props.href) setShown(true)
    },
  })
  const role = () => (control.focused() ? 'strong' : 'body')
  const style = () => ({
    ...runStyle(role(), 'accent'),
    attributes: (runStyle(role(), 'accent').attributes ?? 0) | borderCell('control').attributes,
  })
  return (
    <box flexDirection="column" flexShrink={0} ref={control.ref}>
      <text {...style()}>{flatten(props.children)}</text>
      <Show when={shown()}><Line role="mono">{props.href!}</Line></Show>
    </box>
  )
}

export function Heading(props: { level?: 1 | 2 | 3; eyebrow?: string; children: JSX.Element }) {
  return (
    <box flexDirection="column">
      <Show when={props.eyebrow}><Line role="eyebrow">{props.eyebrow!}</Line></Show>
      <Line role="heading">{props.children}</Line>
    </box>
  )
}

// ── Lists ─────────────────────────────────────────────────────────────────────────────────────

/** The fewest cells a row's own words are worth. Below it the row stops giving and runs off the right
 *  edge instead, where the frame cuts it — so in a twenty-eight cell rail a pull request reads as its
 *  number and its title, and the timestamp and the row actions are simply not there. The alternative
 *  is a row where every field is present and none of them is legible, which is what this host drew
 *  while its parts still shrank. */
const TITLE_CELLS = 16

/** The order a row gives up cells in when it is wider than the panel it is drawn in: the trailing
 *  controls first, then the meta, then the title, and never the caret or the leading glyphs. Yoga
 *  shrinks a child in proportion to `flexShrink` times its width, so these are ranks rather than
 *  ratios — a row action gives up its last cell before the title gives up its first. */
const SHRINK = { title: 1, meta: 20, trailing: 100 }

/** One of a row's fixed parts, in a box that holds its own width.
 *
 *  A component rather than a function returning JSX, and the difference matters on a retained
 *  renderer: a function called from inside the row's JSX runs again whenever the row's props are read
 *  again, and each run tries to put the caller's *same* renderables inside a *new* box — reparenting
 *  the whole part on every read, which used to surface as "already destroyed, skipping add" and now
 *  is merely churn the retained tree never needed. The `Show` builds the box once and only the
 *  contents move. */
function Part(props: { shrink: number; children: JSX.Element }) {
  return (
    <Show when={props.children}>
      <box flexDirection="row" gap={1} flexShrink={props.shrink} overflow="hidden">{slot(props.children)}</box>
    </Show>
  )
}

/** One line: the caret for where the keys are, the leading slot, the title, the meta at the far end.
 *
 *  `reveal` hides the trailing controls until hover on the DOM. There is no hover, so they always
 *  show — the one prop this host answers by ignoring, noted in the node's row in the 80×24 table. */
export function Row(props: {
  item?: ItemProps
  metaFields?: number
  selected?: boolean
  nested?: boolean
  depth?: number
  reveal?: boolean
  density?: 'compact' | 'default' | 'roomy'
  onPress?: () => void
  href?: string
  offset?: number
  height?: number
  label?: string
  onHover?: (entered: boolean) => void
  variant?: 'default' | 'stacked' | 'tree'
  leading?: JSX.Element
  trailing?: JSX.Element
  meta?: JSX.Element
  title?: string
  children: JSX.Element
}) {
  // The active row is the collection's, the selected row is the pane's, and in a terminal they are
  // drawn by the same two cells: a caret for where the keys are, the `match` role for what is chosen.
  const isActive = () => !!props.item?.active()
  // A row inside a collection hands its press over, so `activate` can reach it: on the DOM a `Row` is
  // a button and Enter on it raises a click by itself, and there is no element here to do that
  // (../keys/collection.ts).
  if (props.item) props.item.press(() => props.onPress?.())
  // The parts of a row that keep their cells when the row is wider than the panel it is in. A `text`
  // is a box to yoga, so a row of them at a width they do not fit is a row of boxes each shrunk and
  // each clipping its own content — the failure ../kit/cells.tsx § Run already names, one level up:
  // `[ST]` drew as `[ST`, the gaps closed, and the one-cell caret column shrank to nothing, so a
  // focused list looked exactly like an unfocused one. Only the title gives; everything else holds
  // its width and the row clips at the frame.
  return (
    <box
      flexDirection="row"
      gap={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={props.depth ? props.depth * 2 : 0}
      ref={(element: BoxRenderable) => {
        // The row is where focus lands, so the collection can put it there and a region's first stop
        // can find it. `item` is the collection's; a row outside one is not a stop, which is what
        // `focusRoles.ts` says a `Row` is — an item, never a stop of its own.
        if (!props.item) return
        element.focusable = true
        props.item.ref(element)
      }}
    >
      <box flexShrink={0}><Line tone="accent">{isActive() ? '›' : ' '}</Line></box>
      <Part shrink={0}>{props.leading}</Part>
      {/* Words get the row's own role; a tree brought its own, and the row only decides how the parts
          sit. `stacked` is a title over a subtitle, which is what it is on the DOM — drawing both on
          one line ran the agents session titles into their model names with no space between
          (docs/tui.md). */}
      <box
        flexShrink={SHRINK.title}
        minWidth={TITLE_CELLS}
        overflow="hidden"
        flexDirection={props.variant === 'stacked' ? 'column' : 'row'}
        gap={props.variant === 'stacked' ? 0 : 1}
      >
        <Show
          when={hasNode(props.children)}
          fallback={<Line role={props.selected ? 'match' : 'body'}>{props.children}</Line>}
        >
          {slot(props.children)}
        </Show>
      </box>
      <box flexGrow={1} />
      <Part shrink={SHRINK.meta}>{props.meta}</Part>
      <Part shrink={SHRINK.trailing}>{props.trailing}</Part>
    </box>
  )
}

/** `Row` indented by `depth` with `▸` or `▾`. A wrapper, as on the DOM, so `Row`'s API stays flat. */
export function TreeRow(props: {
  item?: ItemProps
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  depth?: number
  selected?: boolean
  onPress?: () => void
  leading?: JSX.Element
  trailing?: JSX.Element
  meta?: JSX.Element
  reveal?: boolean
  title?: string
  children: JSX.Element
}) {
  return (
    <Row
      item={props.item}
      selected={props.selected}
      depth={props.depth}
      density="compact"
      variant="tree"
      meta={props.meta}
      trailing={props.trailing}
      onPress={props.onPress}
      leading={<box flexDirection="row" gap={1}><Line>{props.expandable ? (props.expanded ? '▾' : '▸') : ' '}</Line>{slot(props.leading)}</box>}
    >
      {props.children}
    </Row>
  )
}

/** The row's actions at the right end, always drawn, never on hover.
 *
 *  Its children are a render prop taking the menu's own context, because a `Menu.Item` needs it to
 *  close the list — and drawing them directly handed that function to Solid, which called it with
 *  nothing and left every item with `context: undefined`. Found by the pane sweep, on the agents
 *  session list (docs/tui.md).
 *
 *  The DOM's is an ellipsis button opening a menu. Here the items are the row's trailing glyphs, which
 *  is what the node's own sentence says (docs/ui-design.md § Every node at 80 by 24): there is no
 *  pointer to open a menu with, and a row of glyphs is one fewer press. So the context they are handed
 *  closes nothing, because there is no list to close.
 */
export function RowActions(props: { ariaLabel: string; children: (menu: { close: () => void }) => JSX.Element }) {
  return <box flexDirection="row" gap={1}>{props.children({ close: () => {} })}</box>
}

/** The scrollbar's two cells: the run the window covers, and the rest of the list under it. lazygit
 *  draws the same bar down the right edge of a panel that has more in it than it can show, and it is
 *  the only thing on this host that says "there is more below" — a terminal has no scroll position a
 *  reader can feel for. */
const THUMB = '█'
const TRACK = '│'

/** Items on successive lines. `virtual` is the scroll window and changes nothing else: the component
 *  is the virtualiser, because OpenTUI has none, and it draws only the rows that fit. */
export function Rows<T extends CollectionItem>(props: {
  id: string
  ariaLabel?: string
  items: readonly T[]
  tree?: boolean
  virtual?: boolean
  selected?: string | null
  onSelect?: (key: string) => void
  onActivate?: (key: string) => void
  onExpand?: (key: string, expand: boolean) => void
  onMenu?: (key: string) => void
  children: (item: T, itemProps: ItemProps, selected: () => boolean, place: Record<string, never>) => JSX.Element
}) {
  const items = createMemo(() => props.items)
  // One collection per `Rows`, keyed by the pane's own id, which is what the host store has always
  // been keyed by. Phase 0's stand-in was one store for every list on screen; this is the real thing
  // (../keys/collection.ts).
  const collection = createCellCollection({
    id: () => props.id,
    items,
    // Moving the caret selects. This host's own answer, and the same kind of departure the focus
    // rules already make: with no pointer there is nothing else the caret could mean, and a reader
    // arrowing down a list of pull requests is asking to see them (docs/tui.md § Collections).
    //
    // Only `onSelect` fires on a move. `onActivate` still waits for Enter, so showing something is
    // immediate and opening it stays deliberate — which is the split `collectionIntents.ts` already
    // draws between `pick` and activate.
    selectOnMove: true,
    ...(props.selected === undefined ? {} : { selected: () => props.selected }),
    ...(props.onSelect ? { onSelect: props.onSelect } : {}),
    ...(props.onActivate ? { onActivate: props.onActivate } : {}),
    ...(props.onExpand ? { onExpand: props.onExpand } : {}),
    ...(props.onMenu ? { onMenu: props.onMenu } : {}),
  })
  const NO_PLACE = {} as Record<string, never>

  let box: BoxRenderable | undefined
  const [rows, setRows] = createSignal(0)
  // Where the window starts. Kept rather than derived, so it moves only when the caret would leave
  // it: centring on the active row scrolled the whole list under the reader on every press, which is
  // not what any list in a terminal does. lazygit's rule — the view holds still until the caret walks
  // off an edge, then follows by exactly as much as it has to.
  const [top, setTop] = createSignal(0)
  let lastActive: string | null = null
  const clampTop = (value: number, length = items().length, fit = rows()) =>
    Math.max(0, Math.min(value, Math.max(0, length - fit)))

  // Keyboard movement remains authoritative for the caret: when the active key changes, reveal it
  // by the smallest amount. A mouse wheel changes `top` without changing `active`, so it can inspect
  // rows away from the selection and this effect only clamps that offset after a resize/refetch.
  createEffect(() => {
    const all = items()
    const fit = rows()
    const active = collection.active()
    const current = clampTop(untrack(top), all.length, fit)
    let next = current
    if (!props.virtual || !fit || all.length <= fit) next = 0
    else if (active !== lastActive) {
      const at = Math.max(0, all.findIndex((item) => item.key === active))
      next = Math.max(0, Math.min(Math.max(current, at - fit + 1), at, all.length - fit))
    }
    lastActive = active
    if (next !== untrack(top)) setTop(next)
  })

  const window = createMemo(() => {
    const all = items()
    const fit = rows()
    if (!props.virtual || !fit || all.length <= fit) {
      return { from: 0, items: all }
    }
    const from = clampTop(top(), all.length, fit)
    // Exactly what fits and no more. There is no scroll offset to overscan into: the box draws from
    // its own first row, so a row drawn beyond the window is a row drawn over the frame below it.
    return { from, items: all.slice(from, from + fit) }
  })

  // A virtual wheel may remove the focused row from the drawn slice. The collection box holds focus
  // while that row has no renderable; if a later wheel/key movement brings it back, restore the row
  // and therefore its caret. The key layer is focus-within on the same box, so keyboard fallback is
  // live in both states.
  createEffect(() => {
    window().from
    if (!box || focusedRenderable() !== box || !collection.focusActive()) return
    box.focusable = false
  })

  // A region's contents are `lazy` and its rows come from a query, so a pane opens before its list
  // exists and the region lands the keys on its own box for want of anything better. Every arrival of
  // rows — the first response and every refetch after it — is a reason for the store to look again
  // (../keys/regions.ts § The settle pass).
  createEffect(() => {
    items()
    scheduleSettle()
  })

  /** Where the thumb sits, or nothing where the whole list is on screen. */
  const bar = createMemo(() => {
    const all = items().length
    const fit = rows()
    if (!props.virtual || !fit || all <= fit) return null
    const size = Math.max(1, Math.round((fit * fit) / all))
    return { fit, size, at: Math.round((window().from * (fit - size)) / (all - fit)) }
  })

  return (
    <box
      flexDirection="row"
      // A virtual list is given its height by the panel it is in and windows to it. Left to size
      // itself it is as tall as its contents, which is the same number it then measures to decide how
      // many rows fit — so it always fitted, always drew everything, and overflowed the frame
      // (../panel.tsx). Every other list keeps the kit's rule and takes the room its rows need.
      {...(props.virtual ? { flexGrow: 1, flexBasis: 0, flexShrink: 1 } : { flexShrink: 0 })}
      ref={(element: BoxRenderable) => { box = element; setRows(element.height); collection.attach(element); scheduleSettle() }}
      onSizeChange={() => setRows(box?.height ?? 0)}
      onMouseScroll={(event: MouseEvent) => {
        if (!props.virtual) return
        const direction = event.scroll?.direction
        if (direction !== 'up' && direction !== 'down') return
        const amount = Math.max(1, Math.round(event.scroll?.delta ?? 1))
        const next = clampTop(top() + (direction === 'down' ? amount : -amount))
        if (next === top()) return
        if (box) {
          // Pointer focus has no browser `focusin` to bridge into the region store. The virtual list
          // owns that bridge because it owns the wheel offset (docs/tui.md § Collections).
          box.focusable = true
          focusRenderable(box)
        }
        setTop(next)
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        <For each={window().items}>
          {(item) => props.children(item, collection.itemProps(item.key), () => collection.selected() === item.key, NO_PLACE)}
        </For>
      </box>
      <Show when={bar()}>
        {(place) => (
          <box flexDirection="column" flexShrink={0}>
            <Index each={Array.from({ length: place().fit })}>
              {(_cell, row) => (
                <Line role={row >= place().at && row < place().at + place().size ? 'strong' : 'muted'}>
                  {row >= place().at && row < place().at + place().size ? THUMB : TRACK}
                </Line>
              )}
            </Index>
          </box>
        )}
      </Show>
    </box>
  )
}

// ── Marks ─────────────────────────────────────────────────────────────────────────────────────

/** `[text]` in the tone's colour. */
export function Badge(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  shape?: 'tag' | 'pill'
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  children: JSX.Element
}) {
  return <Line tone={props.tone}>{`[${flatten(props.children)}]`}</Line>
}

/** `(text)`, with a trailing `✕` when removable. */
export function Chip(props: {
  tone?: Extract<Tone, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'>
  color?: string
  onRemove?: () => void
  onPress?: () => void
  leading?: JSX.Element
  size?: Extract<Size, 'xs' | 'sm'>
  dashed?: boolean
  reveal?: boolean
  selected?: boolean
  title?: string
  children: JSX.Element
}) {
  // `conditional`, as the table says: a chip with neither handler is text, and takes no place in the
  // cycle. `activate` presses it and `delete` removes it, which is the split the `✕` already drew.
  const control = stop({
    ...(props.onPress ? { onPress: () => props.onPress!() } : {}),
    ...(props.onRemove ? { on: { delete: () => { props.onRemove!(); return true } } } : {}),
  })
  const acts = () => !!props.onPress || !!props.onRemove
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      ref={(element: BoxRenderable) => { if (acts()) control.ref(element) }}
    >
      {slot(props.leading)}
      <Line {...litControl({ focused: control.focused(), strong: props.selected, tone: props.tone })}>
        {`(${flatten(props.children)}${props.onRemove ? ' ✕' : ''})`}
      </Line>
    </box>
  )
}

export function ChipRow(props: { ariaLabel?: string; children: JSX.Element }) {
  return <box flexDirection="row" flexWrap="wrap" gap={spaceCells('inline')}>{props.children}</box>
}

/** `●` in the tone's colour, `○` for neutral. `pulse` is a state, not a motion: a terminal that has
 *  to redraw a cell ten times a second to say "starting" is spending a frame on a full stop. */
export function StatusDot(props: {
  tone: Extract<Tone, 'ok' | 'warn' | 'danger' | 'muted' | 'accent'>
  mixed?: boolean
  pulse?: boolean
  label?: string
  size?: Extract<Size, 'sm' | 'md'>
}) {
  return <Line tone={props.tone}>{props.mixed ? '◐' : props.tone === 'muted' ? '○' : '●'}</Line>
}

/** Initials in brackets; no image. Two letters, because a login is a word and a terminal column is
 *  not a circle. */
export function UserAvatar(props: { login: string | null | undefined; size?: 'sm' | 'md' }) {
  const initials = () => {
    const login = props.login?.trim() ?? ''
    if (!login) return '··'
    const parts = login.split(/[^a-zA-Z0-9]+/).filter(Boolean)
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : login.slice(0, 2)).toUpperCase()
  }
  return <Line role="muted">{`[${initials()}]`}</Line>
}

/** A glyph from the name table, an emoji as itself, and nothing for a Lucide name with no glyph.
 *  Drawing the name as words instead would push every row it sits in sideways by six cells. */
export function Icon(props: { name: string; size?: number | string; title?: string; tone?: Tone | 'brand'; spin?: boolean }) {
  const glyph = () => GLYPHS[props.name] ?? ([...props.name].length === 1 ? props.name : '')
  const tone = () => (props.tone === 'brand' ? 'accent' : props.tone)
  return <Show when={glyph()}>{(mark) => <Line tone={tone()}>{mark()}</Line>}</Show>
}

/** `⌘K` or `ctrl+k`, per host. The chord arrives already spelled for this platform; the node is the
 *  box around it, and a terminal has no box. */
export function Kbd(props: { size?: Extract<Size, 'xs' | 'sm'>; children: JSX.Element }) {
  return <Line role="strong">{flatten(props.children)}</Line>
}

// A braille cycle, which is the one animation a terminal does well.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** reduced: a braille cycle, on the shell's one tick (./tick.ts). One timer for the whole screen
 *  rather than one per spinner, which is the same thing the DOM gets for free by putting the
 *  animation in CSS. Before the shell starts the tick this is frame zero and stays there. */
export function Spinner(_props: { size?: 'sm' | 'md'; label?: string }) {
  return <Line role="muted">{SPINNER[spinnerFrame() % SPINNER.length]}</Line>
}

// ── Facts ─────────────────────────────────────────────────────────────────────────────────────

/** Two columns, labels dim; `grouping="rows"` is one pair per line, which in cells is what both
 *  groupings are. */
export function Facts(props: {
  items: readonly { label: string; value: JSX.Element; mono?: boolean; wide?: boolean }[]
  size?: 'sm' | 'md'
  grouping?: 'tiles' | 'rows'
}) {
  const width = () => Math.max(0, ...props.items.map((item) => item.label.length))
  return (
    <box flexDirection="column">
      <For each={props.items}>
        {(item) => (
          <box flexDirection="row" gap={1}>
            <Line role="muted">{pad(item.label, width())}</Line>
            {slot(item.value)}
          </box>
        )}
      </For>
    </box>
  )
}

export function DescriptionList(props: { layout?: 'columns' | 'facts'; size?: 'sm' | 'md'; children: JSX.Element }) {
  return <box flexDirection="column">{props.children}</box>
}
DescriptionList.Item = (props: { label: JSX.Element; mono?: boolean; children: JSX.Element }) => (
  <box flexDirection="row" gap={1}>
    <Line role="muted">{flatten(props.label)}</Line>
    {slot(props.children)}
  </box>
)

/** `████░░░░ 62%`. Eight cells, because a meter that spends a whole row on a ratio is a chart. */
export function Meter(props: {
  value: number
  tone?: Extract<Tone, 'accent' | 'warn' | 'danger'> | 'auto'
  label: string
  size?: Extract<Size, 'sm' | 'md'>
}) {
  const CELLS = 8
  const ratio = () => Math.min(1, Math.max(0, props.value))
  const tone = () => {
    if (props.tone !== 'auto') return props.tone ?? 'accent'
    return ratio() >= 0.9 ? 'danger' : ratio() >= 0.75 ? 'warn' : 'accent'
  }
  const filled = () => Math.round(ratio() * CELLS)
  return (
    <box flexDirection="row" gap={1}>
      <Line tone={tone()}>{'█'.repeat(filled()) + '░'.repeat(CELLS - filled())}</Line>
      <Line role="muted">{`${Math.round(ratio() * 100)}%`}</Line>
    </box>
  )
}

/** Monospace lines with a dim rule above and below. Every line in a terminal is monospace, so the
 *  rules are what says "this is a block and not a paragraph". */
export function CodeBlock(props: {
  copy?: boolean | string
  onCopy?: (text: string) => void
  wrap?: boolean
  size?: 'xs' | 'sm'
  maxHeight?: 'none' | 'block'
  children: JSX.Element
}) {
  const RULE = 40
  return (
    <box flexDirection="column">
      <Line role="muted">{rule(RULE)}</Line>
      <For each={flatten(props.children).split('\n')}>
        {(line) => <Line role="mono" wrap={props.wrap}>{line}</Line>}
      </For>
      <Line role="muted">{rule(RULE)}</Line>
    </box>
  )
}

/** Monospace lines with the find bar as the bottom line. `follow` is what the region's scroll does;
 *  the tail is at the bottom because a column of cells grows downward. */
export function Log(props: { lines: readonly string[]; follow?: boolean; find?: JSX.Element; ariaLabel: string }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="column" flexGrow={1} overflow="scroll">
        <For each={props.lines}>{(line) => <Line role="mono">{line}</Line>}</For>
      </box>
      {slot(props.find)}
    </box>
  )
}

/** Lines of runs, as the markdown pass produced them. Its own component because provider HTML goes
 *  through the same pass and is drawn the same way (../kit/host.tsx § ProviderHtml). */
export function Lines(props: { lines: MarkdownLine[] }) {
  return (
    // A long document is clipped or scrolled by its region; it must never shrink to the viewport.
    // Without this, yoga takes a height deficit out of every wrapped paragraph and later blocks
    // overwrite the rows it removed — the same invariant as every block in ./grouping.tsx.
    <box flexDirection="column" flexShrink={0}>
      <For each={props.lines}>
        {(line) => (
          <Show when={!line.rule} fallback={<Line role="muted">{rule(40)}</Line>}>
            {/* One `text` with a `span` per run, not a row of `Line`s: a row of text renderables is a
                row of boxes to yoga, and at a width they do not fit each one is shrunk and clips its
                own content — which cut three letters out of every run of a wrapped paragraph
                (../kit/cells.tsx § Run). `width` and `minWidth` make yoga measure the same wrap width
                the text buffer draws; without them it reserves one row for an unwrapped line while
                the buffer paints several, and the next paragraph overwrites those rows. */}
            <box flexDirection="row" flexShrink={0} width="100%" minWidth={0} paddingLeft={line.indent ?? 0}>
              <text wrapMode="word" flexGrow={1} minWidth={0}>
                <For each={line.runs}>{(run) => <Run role={run.role} tone={run.tone}>{run.text}</Run>}</For>
              </text>
            </box>
          </Show>
        )}
      </For>
    </box>
  )
}

/** reduced: no images, and a link is its text with the URL beside it in dim. The policy is the
 *  shell's; this draws what it decided (./markdown.ts). */
export function Markdown(props: {
  text: string
  images?: 'inline' | 'placeholder'
  copy?: boolean
  onCopy?: (text: string) => void
  onSelect?: (href: string) => void
}) {
  const lines = createMemo(() => markdownLines(props.text))
  return <Lines lines={lines()} />
}

// ── Tables ────────────────────────────────────────────────────────────────────────────────────

// The narrowest a column may be before it is worth dropping instead. Below this a cell is an
// ellipsis and the reader learns nothing from the column being there.
const MIN_COLUMN = 6
const PRIORITY_ORDER = { low: 0, normal: 1, high: 2 } as const

type Column = { priority: 'high' | 'normal' | 'low'; label: string }
type TableState = {
  width: () => number
  register: (column: Column) => number
  hidden: (index: number) => boolean
  columnWidth: () => number
}

// A table decides its own columns, so the head and the cells have to hear the decision. A module
// signal rather than a context, because a table's rows are drawn by the caller and a context would
// mean the caller wrapping them: one table is being built at a time in a synchronous render pass,
// which is the same assumption `Rows` makes about its own registration.
let building: TableState | null = null

/** reduced: box-drawn, truncating columns by the priority its heads declare. */
export function Table(props: { size?: 'sm' | 'md'; stickyHead?: boolean; minWidth?: number; children: JSX.Element }) {
  let box: BoxRenderable | undefined
  const [width, setWidth] = createSignal(80)
  const [columns, setColumns] = createSignal<Column[]>([])

  const fits = createMemo(() => Math.max(1, Math.floor(width() / MIN_COLUMN)))
  // Drop the lowest priority first, then the rightmost of equal priority, which is the order a reader
  // gives up on a table's columns anyway.
  const kept = createMemo(() => {
    const all = columns().map((column, index) => ({ ...column, index }))
    if (all.length <= fits()) return new Set(all.map((column) => column.index))
    const order = [...all].sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || a.index - b.index)
    return new Set(order.slice(0, fits()).map((column) => column.index))
  })
  const lost = () => columns().filter((_column, index) => !kept().has(index)).map((column) => column.label)

  const state: TableState = {
    width,
    register: (column) => {
      let index = 0
      setColumns((current) => {
        index = current.length
        return [...current, column]
      })
      return index
    },
    hidden: (index) => columns().length > 0 && !kept().has(index),
    columnWidth: () => Math.max(MIN_COLUMN, Math.floor(width() / Math.max(1, kept().size))),
  }
  building = state

  return (
    <box
      flexDirection="column"
      ref={(element: BoxRenderable) => { box = element; setWidth(element.width) }}
      onSizeChange={() => setWidth(box?.width ?? 80)}
    >
      {props.children}
      {/* Naming what was lost, rather than counting it: a reader who can see that two columns are
          missing still has to widen the pane to find out whether either was the one they wanted. */}
      <Show when={lost().length}>
        <Line role="muted">{`+ ${lost().join(' ')}`}</Line>
      </Show>
    </box>
  )
}

/** reduced: the column's label in the bold header line; the lowest priority is dropped first, and a
 *  muted line under the table names what was lost. */
export function TableHead(props: { align?: 'start' | 'center' | 'end'; priority?: 'high' | 'normal' | 'low'; children?: JSX.Element }) {
  const table = building
  const index = table?.register({ priority: props.priority ?? 'normal', label: flatten(props.children) }) ?? 0
  return (
    <Show when={!table?.hidden(index)}>
      <Line role="strong">{pad(flatten(props.children), table?.columnWidth() ?? 12)}</Line>
    </Show>
  )
}

/** reduced: one line, cells separated by `│`, truncated by column priority. */
export function TableRow(props: { head?: boolean; onPress?: () => void; children: JSX.Element }) {
  const control = stop({ onPress: () => props.onPress?.() })
  return (
    <box
      flexDirection="row"
      gap={1}
      ref={(element: BoxRenderable) => { if (props.onPress) control.ref(element) }}
    >
      {props.children}
      {/* The caret goes after the cells rather than before them, and it is the one place in the kit
          where it does: a table's columns line up across rows, and a cell of caret in front of the
          first one would move every column of the focused row one to the right. The cells themselves
          are the caller's `TableCell`s, so this row cannot restyle them. */}
      <Show when={control.focused()}><Line tone="accent">›</Line></Show>
    </box>
  )
}

/** reduced: the cell's text in its column's width, ellipsised where it does not fit. */
export function TableCell(props: { align?: 'start' | 'center' | 'end'; header?: boolean; children?: JSX.Element }) {
  const table = building
  return <Line role={props.header ? 'strong' : 'body'}>{pad(flatten(props.children), table?.columnWidth() ?? 12)}</Line>
}

/** reduced: as `Table`, with a row-range indicator instead of a scrollbar, and cells that are
 *  strings, which is what makes the arithmetic possible at all. */
export function Grid(props: {
  columns: readonly string[]
  rows: readonly (readonly string[])[]
  selected?: number | null
  onSelect?: (index: number) => void
  ariaLabel: string
}) {
  let box: BoxRenderable | undefined
  const [size, setSize] = createSignal({ width: 80, height: 10 })
  const measure = (element: BoxRenderable | undefined) => {
    if (element) setSize({ width: element.width, height: element.height })
  }
  const fits = () => Math.max(1, Math.floor(size().width / MIN_COLUMN))
  const shown = () => props.columns.slice(0, fits())
  const columnWidth = () => Math.max(MIN_COLUMN, Math.floor(size().width / Math.max(1, shown().length)))
  // Two lines go to the header and the range, so the window is what is left.
  const visible = () => Math.max(1, size().height - 2)
  const from = () => {
    const at = props.selected ?? 0
    return Math.min(Math.max(0, at - Math.floor(visible() / 2)), Math.max(0, props.rows.length - visible()))
  }
  const line = (cells: readonly string[]) => shown().map((_column, index) => pad(cells[index] ?? '', columnWidth())).join('│')

  // The exception `focusRoles.ts` writes down, realised. A grid's rows are strings rather than
  // renderables — that is what makes its arithmetic possible at all — so there is nothing per row to
  // focus: the grid is the one stop, `↑`/`↓` move the `selected` index the caller holds, and the
  // window follows it. Same intents, same wrapping, same page keys as every other collection, because
  // they are the shared ones (client-core kit/keys/collectionIntents.ts).
  const keys = createCollectionIntents({
    id: () => props.ariaLabel,
    items: () => props.rows.map((_row, index) => ({ key: String(index) })),
    selectOnMove: true,
    selected: () => (props.selected === null || props.selected === undefined ? null : String(props.selected)),
    onSelect: (key) => props.onSelect?.(Number(key)),
    land: () => {},
    onItem: () => false,
  })
  const control = stop({
    on: Object.fromEntries(COLLECTION_INTENTS.map((intent) => [intent, () => keys.handle(intent)])) as
      Partial<Record<Intent, () => boolean>>,
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      ref={(element: BoxRenderable) => {
        box = element
        measure(element)
        control.ref(element)
      }}
      onSizeChange={() => measure(box)}
    >
      <Line role="strong">{line(props.columns)}</Line>
      <Index each={props.rows.slice(from(), from() + visible())}>
        {(row, index) => (
          <Line role={props.selected === from() + index ? 'match' : 'body'}>{line(row())}</Line>
        )}
      </Index>
      <Line role="muted">
        {`${props.rows.length ? from() + 1 : 0}–${Math.min(props.rows.length, from() + visible())} of ${props.rows.length}`}
        {props.columns.length > shown().length ? ` · ${props.columns.length - shown().length} more columns` : ''}
      </Line>
    </box>
  )
}

// ── Diff ──────────────────────────────────────────────────────────────────────────────────────

/** reduced: no intra-line word highlight. The gutter is the change, the colour is the direction.
 *
 *  One `text` with two runs in it, and `flexShrink={0}` on it, and both halves of that are the same
 *  bug in two directions. A row of two `Line`s is a row of two boxes, so a line wider than the column
 *  shrank both and each clipped its own content, which put the gutter's last digit against the `+`
 *  and lost the space between them; a run inside one `text` clips once, at the end, where a reader
 *  expects it (../kit/cells.tsx § Run). And a column of rows taller than the panel shrank every row
 *  instead of scrolling, so four hundred diff lines were drawn into thirty rows on top of each other
 *  — the smear this node shipped with. A diff row is one line high and never less. */
export function DiffLine(props: { r: CodeRow; canAdd?: boolean; highlight?: unknown }) {
  const mark = () => (props.r.kind === 'insert' ? '+' : props.r.kind === 'delete' ? '-' : ' ')
  const tone = () => (props.r.kind === 'insert' ? 'ok' : props.r.kind === 'delete' ? 'danger' : undefined)
  return (
    <text flexShrink={0} wrapMode="none">
      <Run role="muted">{`${String(props.r.oldNo ?? '').padStart(4)} ${String(props.r.newNo ?? '').padStart(4)} `}</Run>
      <Run tone={tone()}>{`${mark()}${props.r.raw}`}</Run>
    </text>
  )
}

/** reduced: the path in bold with `+n −m` at the far end, and no collapse control. */
export function FileHead(props: { file: DiffFile; anchorId?: string; collapsed?: boolean; onToggleCollapse?: (path: string) => void }) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <Line role="strong">{props.file.path}</Line>
      <box flexGrow={1} />
      <Line tone="ok">{`+${props.file.additions ?? 0}`}</Line>
      <Line tone="danger">{`−${props.file.deletions ?? 0}`}</Line>
    </box>
  )
}

/** reduced: a dim line saying what is not being shown, with no control to act on it. */
export function NonCodeRow(props: { row: Exclude<DiffRowT, CodeRow> }) {
  const text = () => {
    const row = props.row
    switch (row.kind) {
      case 'file': return row.file.path
      case 'hunk': return row.text
      case 'gap': return `… ${row.count ?? 'more'} unchanged lines`
      case 'nodiff': return 'no changes'
      case 'load': return row.status === 'error' ? 'could not load this diff' : 'loading…'
      case 'thread': return `${row.thread.comments.length} comment${row.thread.comments.length === 1 ? '' : 's'}`
      default: return ''
    }
  }
  return <text flexShrink={0} wrapMode="none" {...runStyle('muted')}>{text()}</text>
}

/** absent: side-by-side needs 160 cells, so a terminal diff is unified. */
export const SplitCell = (_props: { r: CodeRow | null; gutter: number | null }) => null

/** One item's marks, drawn where the owner put them. The DOM stacks icon, text and owner in a row of
 *  spans; here they are the same three in the same order, on one line.
 *
 *  Here rather than on `../kit/host.tsx` with the other cooperative nodes, because `DiffPane` below
 *  draws it and that barrel imports this file. Re-exported from there, so a pane spells the same
 *  import on both hosts. */
export function AnnotationMarks(props: { point: string; itemKey: PluginAnnotationKey }) {
  const marks = () => annotationsFor(props.point, props.itemKey)
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <For each={marks()}>
        {(mark) => (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <Show when={mark.icon}>{(name) => <Icon name={name()} />}</Show>
            <Line tone={mark.severity === 'danger' ? 'danger' : mark.severity === 'warn' ? 'warn' : undefined}>{mark.text}</Line>
            <Line role="muted">{mark.pluginId}</Line>
          </box>
        )}
      </For>
    </box>
  )
}

/** reduced: unified only, and no syntax colour. `buildDiffRows` is the same parse the DOM viewer
 *  runs; what is dropped is the highlighter it feeds, which needs a grammar and a theme.
 *
 *  `annotations` is a point id, and it is a prop rather than something the source supplies for the
 *  reason the DOM viewer gives: the marks are drawn inside the row, so their placement is this
 *  component's business. A mark is text — it is not a stop and it changes nothing about how the diff
 *  is driven (docs/tui.md § What a plugin loses here). */
export function DiffPane(props: { source: { files: () => DiffFile[] | undefined; loading: () => boolean }; annotations?: string }) {
  const rows = createMemo(() =>
    (props.source.files() ?? []).map((file) => ({ file, rows: buildDiffRows(file, plainTokenize) })))

  // Every code row this pane holds, asked about in one request per contributor rather than one per
  // line. There is no virtual window here — the pane is one scrolling box and every row is built — so
  // "the visible rows" is all of them. `requestAnnotations` compares the key set and does nothing when
  // it has already asked, so a redraw costs a string compare (client-core/host/annotations).
  createEffect(() => {
    const point = props.annotations
    if (!point) return
    requestAnnotations(point, rows().flatMap((entry) => entry.rows.flatMap((row) =>
      (row.kind === 'normal' || row.kind === 'insert' || row.kind === 'delete' ? [annotationKey(row as CodeRow)] : []))))
  })

  return (
    <box flexDirection="column" flexGrow={1} overflow="scroll">
      <Show when={props.source.files()} fallback={<Line role="muted">{props.source.loading() ? 'loading…' : 'no changes'}</Line>}>
        <For each={rows()}>
          {(entry) => (
            /* `flexShrink={0}` for the reason each row inside carries it: a column of files taller
               than the panel is squeezed rather than scrolled, and one file's rows are then drawn
               over the next file's. The scroll is this pane's, at the box above. */
            <box flexDirection="column" flexShrink={0}>
              <FileHead file={entry.file} />
              <For each={entry.rows}>
                {(row) => (
                  <Show when={row.kind === 'normal' || row.kind === 'insert' || row.kind === 'delete'} fallback={<NonCodeRow row={row as Exclude<DiffRowT, CodeRow>} />}>
                    <AnnotatedDiffLine r={row as CodeRow} point={props.annotations} />
                  </Show>
                )}
              </For>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

/** A diff line, plus whatever another plugin knows about it, on the line below it.
 *
 *  Below rather than at the end of the code, which is where this was written and where nobody could
 *  read it: a diff line is `wrapMode="none"` and as wide as the patch, so anything after it is past
 *  the frame and clipped. It is also where the DOM puts them — `lineExtra`, under the row, inside the
 *  row's measured height — so the two hosts now agree. Indented past the gutter so a reader can see
 *  which line it is about (§ DiffLine mints the same two four-cell columns).
 *
 *  Only a marked line gets the wrapper. `DiffLine` is one `text` on purpose, and an unmarked line is
 *  the node it always was. */
const GUTTER_CELLS = 10

function AnnotatedDiffLine(props: { r: CodeRow; point?: string }) {
  const marks = () => (props.point ? annotationsFor(props.point, annotationKey(props.r)).length : 0)
  return (
    <Show when={props.point && marks()} fallback={<DiffLine r={props.r} />}>
      <box flexDirection="column" flexShrink={0}>
        <DiffLine r={props.r} />
        <box flexDirection="row" paddingLeft={GUTTER_CELLS} flexShrink={0} overflow="hidden">
          <AnnotationMarks point={props.point!} itemKey={annotationKey(props.r)} />
        </box>
      </box>
    </Show>
  )
}

// ── Saying ────────────────────────────────────────────────────────────────────────────────────

/** One line prefixed with the tone's glyph. */
export function Alert(props: {
  tone?: Tone
  variant?: 'inline' | 'banner'
  title?: string
  actions?: JSX.Element
  onDismiss?: () => void
  children: JSX.Element
}) {
  const tone = () => props.tone ?? 'danger'
  const glyph = () => (tone() === 'ok' ? '✓' : tone() === 'warn' ? '!' : tone() === 'accent' ? 'i' : '✕')
  return (
    <box flexDirection="row" gap={1}>
      <Line role="strong" tone={tone()}>{glyph()}</Line>
      <Show when={props.title}><Line role="strong" tone={tone()}>{props.title!}</Line></Show>
      <Line tone={tone()} wrap>{props.children}</Line>
      {slot(props.actions)}
    </box>
  )
}

/** Centred dim text. Centred by padding rather than by measuring: a pane that has room for an empty
 *  state has room for two cells of it. */
export function EmptyState(props: {
  icon?: JSX.Element
  title?: string
  action?: JSX.Element
  busy?: boolean
  align?: 'center' | 'start'
  size?: Size
  children?: JSX.Element
}) {
  return (
    <box flexDirection="column" paddingTop={1} paddingLeft={2}>
      <Show when={props.title}><Line role="strong">{props.title!}</Line></Show>
      <Line role="muted" wrap>{props.busy ? 'loading…' : flatten(props.children)}</Line>
      {slot(props.action)}
    </box>
  )
}
