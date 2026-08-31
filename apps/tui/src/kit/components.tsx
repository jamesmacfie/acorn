/** @jsxImportSource @opentui/solid */
// The JSX source is set per file rather than in tsconfig.json. A whole-program setting would also
// apply to client-core's own components, which tsc pulls into this program and which are written
// against Solid's DOM types — and `@opentui/solid` is not a dependency of that package, so it could
// not resolve there anyway. The bundle's transform is universal for everything (vite.config.ts); this
// pragma only tells tsc which JSX namespace this file's tags are checked against.
import { createEffect, createMemo, For, Show, type JSX } from 'solid-js'
import type { TextareaRenderable } from '@opentui/core'
import type { Size, Space, TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import type { CollectionItem } from '@acorn/client-core/kit/keys/collection.ts'
import { active as activeRow, registerRowPress, registerRows, type ItemProps } from './collection'
import { spaceCells, textAttributes, textTransform, toneAttributes, toneColor } from './roles'

// The kit on OpenTUI: one component per node, drawn to the sentence in
// docs/ui-design.md § Every node at 80 by 24 and no further.
//
// These are the same names, the same props and the same meanings as client-core's DOM kit. That is
// the whole test: a pane written against the kit imports `@acorn/plugin-api/ui`, and on this host that
// facade resolves here (vite.config.ts). The pane does not change and does not know.
//
// Phase 0 draws the fifteen nodes the Notes pane spends and nothing else, so the spike stays a spike.
// Where a prop has no terminal meaning it is ignored rather than approximated, and the ones worth
// arguing about are listed in docs/future/terminal/findings.md.

const text = (role: TextRole | undefined, tone: Tone | undefined) => ({
  attributes: textAttributes[role ?? 'body'] | toneAttributes(tone ?? 'neutral'),
  ...(toneColor[tone ?? 'neutral'] ? { fg: toneColor[tone ?? 'neutral']! } : {}),
})

/** A prop that takes "some UI" and is often handed a bare string.
 *
 *  On the DOM a string child of a `<div>` is a text node and nobody thinks about it. In cells a run of
 *  text must have a `text` parent, so every slot the kit types as `JSX.Element` — `leading`,
 *  `trailing`, `meta`, `actions`, `icon` — has to be checked before it is placed. This is the one
 *  structural difference the spike found between the two hosts, and it belongs to the host, not to the
 *  caller: a pane writing `meta={'\u{1F916}'}` is writing correct kit. */
const slot = (value: JSX.Element): JSX.Element => {
  if (value === null || value === undefined || value === false || value === true) return null
  if (typeof value === 'string' || typeof value === 'number') {
    return value === '' ? null : <text>{String(value)}</text>
  }
  return value
}

/** Children as one string, for a node that draws a line rather than a box. A terminal has no inline
 *  flow: `text` takes content, so a run of words has to arrive as words. */
const flatten = (value: unknown): string => {
  if (value === null || value === undefined || value === false || value === true) return ''
  if (Array.isArray(value)) return value.map(flatten).join('')
  if (typeof value === 'function') return flatten((value as () => unknown)())
  return String(value)
}

// ── Grouping ──────────────────────────────────────────────────────────────────────────────────

export function Stack(props: { gap?: Space; children: JSX.Element }) {
  return <box flexDirection="column" gap={spaceCells[props.gap ?? 'stack']}>{props.children}</box>
}

export function Section(props: { label: string; count?: number; actions?: JSX.Element; sticky?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text {...text('eyebrow', undefined)}>{textTransform('eyebrow', props.label)}</text>
        <Show when={props.count !== undefined}><text {...text('muted', undefined)}>{String(props.count)}</text></Show>
        {slot(props.actions)}
      </box>
      {props.children}
    </box>
  )
}

export function Toolbar(props: { variant?: 'bar' | 'actions'; size?: Size; ariaLabel?: string; children: JSX.Element }) {
  return <box flexDirection="row" gap={1}>{props.children}</box>
}
// `flexGrow` on an empty box is what "push what follows to the far end" is in a cell layout.
export const ToolbarSpacer = () => <box flexGrow={1} />
Toolbar.Spacer = ToolbarSpacer

// ── Showing ───────────────────────────────────────────────────────────────────────────────────

export function Text(props: { emphasis?: TextRole; tone?: Tone; wrap?: boolean; children: JSX.Element }) {
  return (
    <text {...text(props.emphasis, props.tone)} wrapMode={props.wrap ? 'word' : 'none'}>
      {textTransform(props.emphasis ?? 'body', flatten(props.children))}
    </text>
  )
}

export function Alert(props: { tone?: Tone; variant?: 'inline' | 'banner'; title?: string; actions?: JSX.Element; onDismiss?: () => void; children: JSX.Element }) {
  const tone = () => props.tone ?? 'danger'
  return (
    <box flexDirection="row" gap={1}>
      <text {...text('strong', tone())}>!</text>
      <Show when={props.title}><text {...text('strong', tone())}>{props.title!}</text></Show>
      <text {...text('body', tone())} wrapMode="word">{flatten(props.children)}</text>
      {slot(props.actions)}
    </box>
  )
}

export function EmptyState(props: { icon?: JSX.Element; title?: string; action?: JSX.Element; busy?: boolean; align?: 'center' | 'start'; size?: Size; children?: JSX.Element }) {
  return (
    <box flexDirection="column" paddingTop={1} paddingLeft={2}>
      <Show when={props.title}><text {...text('strong', undefined)}>{props.title!}</text></Show>
      <text {...text('muted', undefined)} wrapMode="word">{props.busy ? 'loading…' : flatten(props.children)}</text>
      {slot(props.action)}
    </box>
  )
}

/** The `reduced` node the spike leans on hardest. Phase 0 draws the source, wrapped, which is the
 *  honest floor of what the 80×24 table promises: images dropped, links as text.
 *
 *  OpenTUI has a native `markdown` renderable and phase 1 should use it. Not here, because it requires
 *  a `SyntaxStyle`, which means the tree-sitter assets and a decision about which theme they are
 *  styled with — a decision the appearance layer owns and the spike should not make for it. */
export function Markdown(props: { text: string; copy?: boolean; onCopy?: (text: string) => void; onClick?: (event: MouseEvent) => void; onSelect?: (href: string) => void }) {
  return <text wrapMode="word">{props.text}</text>
}

export function Row(props: {
  item?: ItemProps
  selected?: boolean
  density?: 'compact' | 'default' | 'roomy'
  reveal?: boolean
  depth?: number
  label?: string
  title?: string
  variant?: 'default' | 'stacked' | 'tree'
  onPress?: () => void
  onHover?: (entered: boolean) => void
  leading?: JSX.Element
  trailing?: JSX.Element
  meta?: JSX.Element
  children: JSX.Element
}) {
  // The active row is the collection's, the selected row is the pane's, and in a terminal they are
  // drawn by the same two cells: a caret for where the keys are, reverse video for what is chosen.
  const isActive = () => !!props.item && activeRow() === props.item.key
  // A row inside a collection hands its press over, so `activate` can reach it. A row outside one is a
  // lone stop with nothing to reach it yet; phase 2 gives it focus of its own.
  if (props.item) registerRowPress(props.item.key, () => props.onPress?.())
  return (
    <box flexDirection="row" gap={1} paddingLeft={props.depth ? props.depth * 2 : 0}>
      <text {...text('body', 'accent')}>{isActive() ? '›' : ' '}</text>
      {slot(props.leading)}
      <text attributes={props.selected ? textAttributes.match : textAttributes.body}>{flatten(props.children)}</text>
      {slot(props.meta)}
      {/* `reveal` hides the trailing controls until hover, and a terminal has no hover, so they
          always show. See docs/future/terminal/findings.md. */}
      {slot(props.trailing)}
    </box>
  )
}

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
  registerRows({
    id: props.id,
    get items() { return items() },
    ...(props.onActivate ? { activate: props.onActivate } : {}),
    ...(props.onSelect ? { select: props.onSelect } : {}),
  })
  const NO_PLACE = {} as Record<string, never>
  return (
    <box flexDirection="column">
      <For each={items()}>
        {(item) => props.children(item, { key: item.key }, () => props.selected === item.key, NO_PLACE)}
      </For>
    </box>
  )
}

// ── Asking ────────────────────────────────────────────────────────────────────────────────────

export function Button(props: {
  label?: string
  variant?: 'solid' | 'outline' | 'ghost' | 'bare'
  tone?: Tone
  size?: Size
  iconOnly?: boolean
  busy?: boolean
  disabled?: boolean
  pressed?: boolean
  title?: string
  hidden?: boolean
  href?: string
  onPress?: () => void
  children?: JSX.Element
}) {
  const body = () => flatten(props.children) || props.label || ''
  return (
    <Show when={!props.hidden}>
      <text {...text(props.pressed ? 'strong' : 'body', props.disabled ? 'muted' : props.tone)}>
        {props.variant === 'bare' ? body() : `[${body()}]`}
      </text>
    </Show>
  )
}

export function ToggleButton(props: { label?: string; size?: Size; tone?: Tone; disabled?: boolean; pressed: boolean; onPressedChange: (pressed: boolean) => void; children?: JSX.Element }) {
  return <Button label={props.label} size={props.size} tone={props.tone} disabled={props.disabled} pressed={props.pressed}>{props.children}</Button>
}

export function Checkbox(props: {
  label?: JSX.Element
  hint?: string
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  switch?: boolean
  size?: Size
  nested?: boolean
  ariaLabel?: string
  title?: string
  id?: string
  name?: string
  onChange?: (checked: boolean) => void
}) {
  const mark = () => (props.indeterminate ? '[-]' : props.checked ? '[x]' : '[ ]')
  return (
    <box flexDirection="row" gap={1}>
      <text {...text('body', props.disabled ? 'muted' : undefined)}>{mark()}</text>
      <Show when={props.label}><text>{flatten(props.label)}</text></Show>
    </box>
  )
}

export function Input(props: {
  kind?: string
  size?: Size
  label?: string
  title?: string
  placeholder?: string
  value?: string
  disabled?: boolean
  readOnly?: boolean
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onSubmit?: (value: string) => void
  ref?: unknown
}) {
  return (
    <input
      // A control has no intrinsic width in cells, and a `width` role is not a number, so a field
      // takes the room its row has left. That is what `Input` does on the DOM too; it just gets there
      // through a stylesheet.
      flexGrow={1}
      value={props.value ?? ''}
      placeholder={props.placeholder ?? ''}
      onInput={(value: string) => props.onInput?.(value)}
      // `unknown`, because the renderable's own option and the reconciler's typed prop disagree about
      // what a submit carries and the intersection accepts only a handler that takes both.
      onSubmit={(value: unknown) => props.onSubmit?.(typeof value === 'string' ? value : (props.value ?? ''))}
    />
  )
}

export function Textarea(props: {
  size?: Size
  label?: string
  placeholder?: string
  value?: string
  rows?: number
  grow?: boolean
  mono?: boolean
  assist?: boolean
  readOnly?: boolean
  disabled?: boolean
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onBlur?: () => void
  ref?: unknown
}) {
  let area: TextareaRenderable | undefined
  // A `textarea` renderable owns an edit buffer, so `initialValue` is read once and the reader owns it
  // after that. A pane that changes `value` from outside — Notes opening a different note into the same
  // box — has to be written in, and only when it differs, or every keystroke would rewrite the buffer
  // under the cursor.
  createEffect(() => {
    const value = props.value ?? ''
    if (area && area.plainText !== value) area.setText(value)
  })
  return (
    <textarea
      flexGrow={props.grow ? 1 : 0}
      // `initialValue`, not a child: a string child of an edit buffer is an orphan text node.
      initialValue={props.value ?? ''}
      placeholder={props.placeholder ?? ''}
      ref={(element: TextareaRenderable) => { area = element }}
      // The change event carries no payload — OpenTUI's own comment on it says to ask the renderable
      // for the text — so this is the one node in the kit that needs a handle on what it drew.
      onContentChange={() => props.onInput?.(area?.plainText ?? '')}
    />
  )
}
