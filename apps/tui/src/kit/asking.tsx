/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createSignal, For, Index, on, onCleanup, Show, untrack, type JSX } from 'solid-js'
import type { Renderable } from '../tree/compat'
import { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm.ts'
import {
  COLLECTION_INTENTS, createCollectionIntents,
} from '@acorn/client-core/kit/keys/collectionIntents.ts'
import { registerIntentLayer } from '@acorn/client-core/kit/keys/keymapHost.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import type { Size } from '@acorn/client-core/kit/tokens/tokens.ts'
// The prop types, not the components. A node's props are one contract on both hosts — a pane compiles
// against one of them and runs on either — and this host had hand-written copies that had quietly lost
// `tip`, `iconOnly`, `min` and the rest, so nothing in the roster type-checked
// (docs/tui.md). `import type` is erased, so the DOM components behind
// this module never reach the bundle and the barrel rule holds
// (docs/tui.md).
import type { ButtonProps, InputProps, SelectProps } from '@acorn/client-core/kit/components/primitives.tsx'
import type { PickerProps } from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import type { MentionTextareaProps } from '@acorn/client-core/kit/components/inputs/MentionTextarea.tsx'
import type { ItemProps } from '../keys/collection'
import { focusedRenderable, focusRenderable, focusWithin, markEntry, moveStop, stopsIn } from '../keys/regions'
import { stop } from '../keys/stops'
import { STOP } from '../keys/tiers'
import { bindKeys } from '../keys/install'
import { flatten, hasNode, Line, slot } from './cells'
import { boxBorder, litControl } from './roles'
import { slotColor } from '../appearance'
import { create, edit, paste, setValue, type Field, type Press } from './field'
import { toVisual, wrapRows, type Row } from '../wrap'
import { requestFrame } from '../tree/frames'
import type { Node } from '../tree/node'
import { Menu } from './grouping'
import { copyToTerminal } from './copy'

// The kit's asking nodes in cells.
//
// A control is also a stop, and on this host that has to be said out loud: a `<button>` is focusable
// and raises a click on Enter by itself, and a cell renderable does neither. So every node below whose
// focus role is a stop hands its box to `stop()`, which makes it focusable, binds `activate` to the
// handler the prop already carried, and answers whether it has the keys — which is what `litControl`
// draws (../keys/stops.ts).
//
// Two things are true of every control here and of nothing on the DOM. A control has no intrinsic
// width in a terminal — `Input` draws three characters wide and scrolls its own content unless it is
// told to take the room its row has left — and an edit buffer owns its own text, so a `value` that
// changes from outside has to be written into the renderable rather than passed as a prop.
//
// **A field is a contract rather than a class**, the shape `./scrolling.tsx` set for the scroll
// viewport. `fieldRef` below owns the edit buffer, the wrap and the caret, and the node carries the
// value, the caret's offset and the scroll as props paint reads. What the rest of the app reaches a
// field through is six names — `value`, `plainText`, `setText`, `insertText`, `handleKeyPress` and
// `handlePaste` — which is what keeps `Composer`, `MentionTextarea` and the dispatcher's typing
// hand-off one piece of code (docs/tui.md § The five key groups).

/** `[ label ]`. `bare` drops the brackets, for a control that is a word inside a sentence. */
export function Button(props: ButtonProps) {
  // A terminal draws the button's words, not its glyph. An icon-only button's child is a node with no
  // text to read off it — `flatten` would print `[object Object]`, which is how the agents pane's
  // header read before the sweep — and the kit makes such a button carry `label`, which is the words
  // (docs/ui-design.md § The closed kit).
  const body = () => (hasNode(props.children) ? props.label ?? '' : flatten(props.children) || props.label || '')
  const control = stop({
    onPress: () => props.onPress?.(),
    disabled: () => !!props.disabled,
  })
  return (
    <Show when={!props.hidden}>
      {/* A box around the line, because the keys are bound to a renderable and a `Line` may be a tree
          the caller handed in. A row containing one run of text is as wide as the run. */}
      <box flexDirection="row" flexShrink={0} ref={control.ref}>
        <Line {...litControl({
          focused: control.focused(),
          strong: props.pressed || props.armed,
          disabled: props.disabled,
          tone: props.tone,
        })}>
          {props.variant === 'bare' ? body() : `[${body()}]`}
        </Line>
      </box>
    </Show>
  )
}

/** `[ Delete? ]` after the first press: the armed button is the prompt, which is the same rule the
 *  DOM keeps and the same shared helper behind it. */
export function ConfirmButton(props: ButtonProps & {
  confirmLabel?: string
  timeoutMs?: number
  skipConfirm?: boolean
  onConfirm: () => void
}) {
  const armed = createArmedConfirm(() => props.timeoutMs ?? 3000)
  const body = () => flatten(props.children) || props.label || ''
  // One button, so one key: `request` is keyed because the armed state usually lives outside a single
  // control, and this is the degenerate case the DOM's ConfirmButton is too.
  const press = () => {
    if (props.skipConfirm || armed.request('confirm')) props.onConfirm()
  }
  const isArmed = () => armed.armed() !== null
  return (
    <Button
      variant={props.variant}
      tone={isArmed() ? 'danger' : props.tone}
      size={props.size}
      disabled={props.disabled}
      armed={isArmed()}
      onPress={press}
    >
      {isArmed() ? `${props.confirmLabel ?? body()}?` : body()}
    </Button>
  )
}

/** What the rest of this app asks of a field.
 *
 *  All six are installed on the node by `fieldRef` below, so `Composer`, `MentionTextarea`, the
 *  `commit` layer and the dispatcher's typing hand-off reach a field through this shape rather than
 *  through the component that drew it (../keys/install.ts § typeInto). */
type FieldApi = {
  value: string
  plainText: string
  setText: (text: string) => void
  insertText: (text: string) => void
  handleKeyPress: (key: Press) => boolean
  handlePaste: (event: { text: string }) => void
}

/**
 * A field: the model is a signal here and four props there.
 *
 * The whole of both fields, because the two differ by one thing. `newline` says whether Return
 * inserts one, which is the one binding an `Input` overrides, and it
 * doubles as "does this field wrap" — a one-row field slides sideways where a wrapped one slides up
 * and down, and one `scroll` number says both (../paint/paint.ts § drawField).
 *
 * Nothing on the node knows how to edit. The model is a signal here and a set of props there, so a
 * node cannot be in an edit state the component disagrees with, and paint reads four numbers
 * (../paint/paint.ts § drawField).
 *
 * Returns the `ref` its two call sites install, because a `ref` callback cannot return a signal —
 * the same reason `../keys/stops.ts § stop` is shaped that way.
 */
function fieldRef(spec: {
  value: () => string
  newline: boolean
  onInput?: (value: string) => void
  onSubmit?: (value: string) => void
}): (element: unknown) => void {
  const [model, setModel] = createSignal<Field>(create(spec.value()))
  const [box, setBox] = createSignal<Node>()
  const [scroll, setScroll] = createSignal(0)

  // Whether this field has the keys, asked of the store rather than held here, which is the same
  // one-way mirror every other stop in this file uses (../keys/stops.ts § stop).
  const focused = (): boolean => {
    const node = box()
    return !!node && focusedRenderable() === (node as unknown as Renderable)
  }

  /** The visual rows of a value at the width the last layout gave the field.
   *
   *  The same pure function paint and Yoga wrap with, rather than a read of the cache they share, and
   *  that is deliberate twice over: the cache is keyed by the `value` prop this component writes, so
   *  reading it here would depend on the effect below having already run, and a wrap of a 400-line
   *  note is 163 microseconds — affordable per keystroke, which is the only place this is called
   *  (../wrap.ts). */
  const rows = (text: string): readonly Row[] => {
    const node = box()
    return wrapRows(text, spec.newline && node ? Math.max(node.rect.w, 1) : Infinity)
  }

  /** Slide the field so the caret is inside its box: sideways for a one-row field, up and down for a
   *  wrapped one. Clamped here rather than in paint, so `scroll` is a fact about where the field is
   *  looking rather than a hint paint has to second-guess. */
  const follow = (field: Field, lines: readonly Row[]): void => {
    const node = box()
    if (!node) return
    const here = toVisual(field.text, lines, field.cursor, field.assoc)
    const room = Math.max(spec.newline ? node.rect.h : node.rect.w, 1)
    const at = spec.newline ? here.row : here.col
    setScroll((was) => {
      if (at < was) return at
      // A cell of room for the caret itself at the far edge, which is where it sits after the last
      // character somebody typed.
      if (at > was + room - 1) return at - room + 1
      return was
    })
  }

  const apply = (next: Field): void => {
    const changed = next.text !== untrack(model).text
    setModel(next)
    if (changed) spec.onInput?.(next.text)
    follow(next, rows(next.text))
  }

  const handleKeyPress = (key: Press): boolean => {
    const field = untrack(model)
    const next = edit(field, key, rows(field.text), spec.newline)
    if (next !== false) {
      apply(next)
      return true
    }
    // Return in a one-row field submits, which is the one binding `InputRenderable` overrides on the
    // textarea it extends. Here rather than in the table, because a submit is not an edit and the
    // model has nothing to say about it (./field.ts § edit).
    if (!spec.newline && (key.name === 'return' || key.name === 'linefeed') && !key.ctrl && !key.meta) {
      spec.onSubmit?.(field.text)
      return true
    }
    return false
  }

  /** A whole value written in from outside. The caret keeps its place where it can and the field looks
   *  at its start again, which is what `setText` means by resetting the buffer it replaces: a scroll
   *  left over from a longer value would otherwise be looking past the end of a shorter one. */
  const write = (text: string): void => {
    setModel((was) => setValue(was, text))
    setScroll(0)
  }

  // A value set from outside, written in only when it differs, and read untracked so the effect
  // depends on the prop and not on the model it is about to write. Without the guard every keystroke
  // in an uncontrolled field would be undone by the empty prop behind it, which is the same guard the
  // OpenTUI half spells as `field.value !== value`.
  createEffect(() => {
    const incoming = spec.value()
    if (untrack(model).text !== incoming) write(incoming)
  })

  // The model into the node's props, where paint reads it, and a frame to draw the move. Written from
  // an effect rather than spelled as JSX attributes because `../tree/jsx.ts § InputProps` carries none
  // of these four: they are the component's own state on its own node, not something a call site
  // passes in (./scrolling.tsx § viewportBox).
  createEffect(() => {
    const node = box()
    if (!node) return
    const field = model()
    node.props.value = field.text
    node.props.cursor = field.cursor
    node.props.assoc = field.assoc
    node.props.scroll = scroll()
    node.props.focused = focused()
    // A `textarea`'s height is its wrapped rows, and Yoga will not call a measure function it does
    // not think is stale. An `input` has no measure function to mark — it is a cell tall by
    // `../tree/node.ts § INTRINSIC` — and marking one that has none aborts the wasm module. Through
    // the handle on the node rather than through `../layout/`, which this file may not import: that
    // module reaches `yoga-layout` and this one is in `App`'s eager graph
    // (../wrap.ts § The cache is here rather than in ./layout/measure.ts).
    if (spec.newline) node.yoga?.markDirty()
    requestFrame()
  })

  const api: FieldApi = {
    get value() { return model().text },
    get plainText() { return model().text },
    set value(text: string) { write(text) },
    setText: write,
    insertText: (text: string) => { apply(paste(untrack(model), text, spec.newline)) },
    handleKeyPress,
    handlePaste: (event: { text: string }) => { apply(paste(untrack(model), event.text, spec.newline)) },
  }

  // Tab is the next control before it is the next region.
  //
  // The arrows type in a field — the typing shadow claims them so the caret can move — which left a
  // field the end of its panel's walk: the `[Comment]` button beside a composer, the review box under
  // it and its three verbs were unreachable from the keyboard, and a reader who pressed Down into the
  // box could only press Escape back to the strip and Down into the same box again. Tab is the key
  // somebody in a form presses for this on the DOM, and it is lazygit's inside its commit box; gh-dash
  // does not need one because its comment box is a mode rather than a stop in the reading order
  // (references/lazygit § commit_message_controller.go, references/gh-dash § prview).
  //
  // It costs the region cycle nothing. The walk answers first and says whether it moved, and at the
  // panel's edge it declines, so the region layer below still has its Tab
  // (../keys/install.ts § HOST_KEYS).
  const step = (delta: 1 | -1) => (): boolean => {
    const before = focusedRenderable()
    moveStop(delta)
    return focusedRenderable() !== before
  }

  return (element: unknown) => {
    const node = element as Node
    setBox(node)
    // Descriptors rather than a spread, or the two getters would be copied as whatever string they
    // answered at mount (./scrolling.tsx § api).
    Object.defineProperties(node, Object.getOwnPropertyDescriptors(api))
    // At `STOP`, bound to the field itself, which is the one tier the typing shadow leaves alone
    // (../keys/tiers.ts § TYPING).
    bindKeys(node as unknown as Renderable, [
      { key: 'tab', cmd: step(1) },
      { key: 'shift+tab', cmd: step(-1) },
    ], STOP, { mode: 'focus' })
  }
}

/** The two colours a field would otherwise invent. A field that names neither draws its text opaque
 *  white and its placeholder `#666666` — neither is one of the sixteen a terminal has or comes from
 *  any theme, so both say a slot out loud
 *  (../appearance.ts, docs/ui-design.md § Roles, and what each host makes of them). */
const fieldColors = () => ({
  textColor: slotColor('default'),
  placeholderColor: slotColor('muted'),
})

export function Input(props: InputProps) {
  const install = fieldRef({
    value: () => (props.value === undefined ? '' : String(props.value)),
    newline: false,
    onInput: (value) => props.onInput?.(value),
    onSubmit: (value) => props.onSubmit?.(value),
  })
  return (
    <input
      // A `width` role is not a number and should not become one, so the host decides: a field takes
      // the room its row has left, which is what the stylesheet decides on the DOM.
      flexGrow={props.width === 'narrow' ? 0 : 1}
      {...fieldColors()}
      placeholder={props.placeholder ?? ''}
      ref={install as (element: Renderable) => void}
    />
  )
}


type TextareaProps = {
  size?: Extract<Size, 'sm' | 'md'>
  invalid?: boolean
  width?: 'full' | 'auto' | 'narrow'
  label?: string
  title?: string
  id?: string
  name?: string
  disabled?: boolean
  required?: boolean
  autofocus?: boolean
  assist?: boolean
  value?: string
  placeholder?: string
  rows?: number
  grow?: boolean
  /** Draw the field's own frame. Default true; `Composer` passes false because it draws one already
   *  (§ Textarea). Not on the shared `TextareaProps` — the DOM has no box to double up. */
  boxed?: boolean
  mono?: boolean
  readOnly?: boolean
  maxLength?: number
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  /** The `commit` intent, with the buffer's own text. Not on the shared `TextareaProps`, which has no
   *  submit at all: on the DOM a composer's Enter is a `keydown` the caller reads, and here it is an
   *  intent the field has to bind because nothing else can reach a focused edit buffer. */
  onSubmit?: (value: string) => void
  onBlur?: () => void
  onFocus?: () => void
  ref?: unknown
}

/** Everything a `Textarea` does that is not the edit buffer: the caller's `ref`, and the one chord
 *  that reaches a field while somebody is typing. Its own function because it is the half of the
 *  component that has nothing to do with what is typed into it. */
function textareaRef(props: TextareaProps, element: Renderable & FieldApi): void {
  // The `ref` prop was decorative until something needed the renderable: a `Composer` reads the
  // buffer's text when its submit button is pressed, and there is no other way to ask.
  if (typeof props.ref === 'function') (props.ref as (node: Renderable & FieldApi) => void)(element)
  // `commit` is a chord — Ctrl+Return on this host — so it reaches a focused field: it is one of
  // the typing-exempt intents by design (client-core kit/keys/intents.ts § TYPING_EXEMPT). Bound
  // in `focus` mode, so a composer inside a list does not answer for the list.
  onCleanup(registerIntentLayer(element, ['commit'], () => {
    if (props.disabled || !props.onSubmit) return false
    props.onSubmit(element.plainText)
    return true
  }, { priority: STOP, mode: 'focus' }))
}

export function Textarea(props: TextareaProps) {
  const [box, setBox] = createSignal<Renderable>()
  // The two callbacks the shared props declare and the DOM half has always fired. They were declared
  // here and never called, so a caller that gated something on "the keys are in this field" got one
  // answer on the desktop and none here — the changes pane's commit chords are gated on exactly
  // that.
  //
  // Read off the region store rather than off an event, because that is where focus is on a host with
  // no pointer (../keys/regions.ts). Deferred, so a field that mounts unfocused does not report a
  // blur nobody performed.
  createEffect(on(
    () => focusWithin(box()),
    (has) => (has ? props.onFocus?.() : props.onBlur?.()),
    { defer: true },
  ))
  const install = fieldRef({
    value: () => props.value ?? '',
    newline: true,
    onInput: (value) => props.onInput?.(value),
  })
  // The box the node's own sentence promises, and it earns its two rows twice over. It is the only
  // thing separating a message box from whatever is stacked above it — on the agents pane that is a
  // transcript, a row of provider pickers and an expand toggle, and unboxed the field read as one
  // more line of that pile. And it is where a reader looks to see whether the keys are in the field,
  // which a caret alone cannot say once the field is empty.
  //
  // `boxed` is how a caller that draws its own frame turns it off: `Composer` is a bordered box around
  // a field, a hint and a send button, so a second border inside its first is a box in a box
  // (§ Composer). Not on the shared `TextareaProps`, because on the DOM the two borders are one CSS
  // rule apart and nobody needed to say it.
  // A border and no padding. The frame is what separates the field from whatever is stacked above it
  // and what says where the keys are; a pad inside it would cost two more columns of the reader's own
  // text for nothing, and at the widths a terminal deals in that is a wrapped word.
  const boxed = () => props.boxed !== false
  return (
    <box
      flexDirection="column"
      flexGrow={props.grow ? 1 : 0}
      flexShrink={0}
      minWidth={0}
      {...(boxed() ? boxBorder('surface', { tone: focusWithin(box()) ? 'accent' : 'neutral' }) : {})}
      ref={setBox}
    >
      <textarea
        flexGrow={props.grow ? 1 : 0}
        // `rows` is "visible lines" on the shared props and was dropped here, so every field was
        // exactly as tall as what was in it: an empty message box was one line, and the composer's
        // own "Expand the message box" toggle — which is a swap from 3 rows to 18 — did nothing at
        // all. A floor rather than a height, because a field taller than its `rows` should still show
        // what has been typed into it (../layout/measure.ts § measureField).
        {...(props.grow ? {} : { minHeight: Math.max(1, props.rows ?? 1) })}
        {...fieldColors()}
        placeholder={props.placeholder ?? ''}
        ref={(element: Renderable) => {
          install(element)
          // `install` has just put the field's own API on the node, so from here it is one
          // (§ FieldApi).
          textareaRef(props, element as Renderable & FieldApi)
        }}
      />
    </box>
  )
}


/** `[ value ▾ ]`, opening a `Menu`. The list is the menu's; this is the trigger and the value. */
export function Select(props: SelectProps) {
  const current = () => props.options.find((option) => option.value === props.value)
  return (
    <Menu
      ariaLabel={props.label ?? 'Select'}
      disabled={() => !!props.disabled}
      trigger={(state) => (
        <Line {...litControl({ focused: state.focused(), disabled: props.disabled })}>
          {`[ ${current()?.label ?? ''} ▾ ]`}
        </Line>
      )}
    >
      {(context) => (
        <For each={props.options}>
          {(option) => (
            <Option
              label={option.label}
              chosen={option.value === props.value}
              disabled={option.disabled}
              onPress={() => {
                props.onChange?.(option.value)
                context.close()
              }}
            />
          )}
        </For>
      )}
    </Menu>
  )
}

/** One line of an open list: a stop, so `↓` and `↑` reach it and `activate` picks it.
 *
 *  Shared by `Select` and anything else that draws a plain list inside a `Menu`. The chosen row keeps
 *  the `match` role it has everywhere else in the kit; focus wins over it, because a reader moving
 *  through a list needs to see where they are more than what they had. */
function Option(props: { label: string; chosen?: boolean; disabled?: boolean; onPress: () => void }) {
  const control = stop({ onPress: () => props.onPress(), disabled: () => !!props.disabled })
  const lit = () => (control.focused()
    ? { role: 'strong' as const, tone: 'accent' as const }
    : { role: props.chosen ? 'match' as const : 'body' as const, tone: props.disabled ? 'muted' as const : undefined })
  return (
    <box flexDirection="row" flexShrink={0} ref={control.ref}>
      <Line {...lit()}>{props.label}</Line>
    </box>
  )
}

/** `[x] label`; Space toggles, through the `select` intent rather than through a key handler here. */
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
  const control = stop({
    onPress: () => props.onChange?.(!props.checked),
    disabled: () => !!props.disabled,
  })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled })}>{mark()}</Line>
      <Show when={props.label}><Line>{props.label}</Line></Show>
      <Show when={props.hint}><Line role="muted">{props.hint!}</Line></Show>
    </box>
  )
}

/** `[x] label`, the same two cells as a Checkbox, because in a terminal a switch is a checkbox that
 *  took a different route to the same state. */
export function ToggleButton(props: ButtonProps & { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  const control = stop({
    onPress: () => props.onPressedChange(!props.pressed),
    disabled: () => !!props.disabled,
  })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled })}>{props.pressed ? '[x]' : '[ ]'}</Line>
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled, tone: props.tone })}>
        {flatten(props.children) || props.label || ''}
      </Line>
    </box>
  )
}

/** `( a | [b] | c )`, the selected one in brackets. */
export function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  size?: Extract<Size, 'sm' | 'md'>
  ariaLabel: string
}) {
  const body = () => `( ${props.options.map((option) => (option.value === props.value ? `[${option.label}]` : option.label)).join(' | ')} )`
  // A collection whose roving place is its value rather than a renderable, which is the exception
  // `focusRoles.ts` writes down for `Grid`: there is nothing per option to focus in one run of text,
  // so the strip holds the keys and `←`/`→` move the value. The list rules — what wraps, what Home
  // and End do, how far a page key moves — are the shared ones, so a segmented control cannot drift
  // from every other collection in the app (client-core kit/keys/collectionIntents.ts).
  const keys = createCollectionIntents({
    id: () => props.ariaLabel,
    items: () => props.options.map((option) => ({ key: option.value, label: option.label })),
    orientation: 'horizontal',
    // Moving picks, which is what a segmented control is: there is nothing else its arrows could mean.
    selectOnMove: true,
    selected: () => props.value,
    onSelect: (key) => props.onChange(key as T),
    // Nothing to land on and nothing to activate: the strip is the one stop and the value is the caret.
    land: () => {},
    onItem: () => false,
  })
  const control = stop({
    on: Object.fromEntries(COLLECTION_INTENTS.map((intent) => [intent, () => keys.handle(intent)])) as
      Partial<Record<Intent, () => boolean>>,
  })
  return (
    <box flexDirection="row" flexShrink={0} ref={control.ref}>
      <Line {...litControl({ focused: control.focused() })}>{body()}</Line>
    </box>
  )
}

/** A field that opens a `Menu` filtered by typing. */
export function Picker<T>(props: PickerProps<T>) {
  const [query, setQuery] = createSignal('')
  // Each row carries its own pick, because the two forms this node takes identify a row differently:
  // the data form by id, the callback form by the caller's own opaque item. The DOM half maps an index
  // back to the item for the same reason; keeping the closure is the same answer with less arithmetic.
  const rows = () => {
    if (props.items) {
      const needle = query().trim().toLowerCase()
      return props.items
        .filter((item) => !needle || `${item.label} ${item.note ?? ''}`.toLowerCase().includes(needle))
        .map((item) => ({
          label: item.label,
          description: item.note,
          active: item.active,
          disabled: item.disabled,
          pick: () => props.onPick?.(item.id),
        }))
    }
    return (props.results?.(query()) ?? []).map((item) => ({
      label: props.rowLabel?.(item) ?? '',
      description: props.rowDescription?.(item),
      active: props.isActive?.(item) ?? false,
      disabled: props.isDisabled?.(item) ?? false,
      pick: () => props.onSelect?.(item),
    }))
  }
  return (
    <Menu
      ariaLabel={props.ariaLabel ?? flatten(props.label)}
      disabled={() => !!props.disabled}
      trigger={(state) => (
        <Line {...litControl({ focused: state.focused(), disabled: props.disabled })}>
          {`[ ${flatten(props.label)} ▾ ]`}
        </Line>
      )}
    >
      {(context) => (
        <box flexDirection="column">
          <Input kind="filter" placeholder={props.placeholder} value={query()} onInput={setQuery} />
          {slot(props.tools)}
          {slot(props.status)}
          <Show when={rows().length} fallback={<Line role="muted">{props.emptyText}</Line>}>
            <For each={rows()}>
              {(row) => (
                <PickerRow
                  label={row.label}
                  description={row.description}
                  active={row.active}
                  disabled={row.disabled}
                  onSelect={() => {
                    row.pick()
                    if (!props.keepOpen) context.close()
                  }}
                />
              )}
            </For>
          </Show>
        </box>
      )}
    </Menu>
  )
}

/** One line in that menu: glyph, label, dim hint. */
export function PickerRow(props: {
  label: string
  description?: string
  active?: boolean
  disabled?: boolean
  leading?: JSX.Element
  role?: 'option'
  onSelect: () => void
  onHover?: () => void
}) {
  // `focusRoles.ts` calls this an item, and inside a `Rows` it is one. Inside an open `Menu` there is
  // no collection to be an item of — the list is drawn by whoever opened it — so here it is a stop and
  // the menu's own `↓`/`↑` walk its stops (../keys/regions.ts § walkStops).
  const control = stop({ onPress: () => props.onSelect(), disabled: () => !!props.disabled })
  return (
    <box flexDirection="row" gap={1} flexShrink={0} ref={control.ref}>
      <Line tone="accent">{control.focused() || props.active ? '›' : ' '}</Line>
      {slot(props.leading)}
      <Line {...litControl({ focused: control.focused(), disabled: props.disabled })}>{props.label}</Line>
      <Show when={props.description}><Line role="muted">{props.description!}</Line></Show>
    </box>
  )
}

/** A boxed field with a `> ` prompt; commit submits. The prompt is what tells a reader which of the
 *  boxes on screen takes what they type. */
export function Composer(props: {
  value: string
  onInput?: (value: string) => void
  onSubmit: (value: string) => void
  busy?: boolean
  disabled?: boolean
  error?: string
  placeholder?: string
  submitLabel?: string
  secondary?: JSX.Element
  mentions?: string[]
  hint?: JSX.Element
  rows?: number
}) {
  let area: (Renderable & FieldApi) | undefined
  // One send, two ways in: `commit` inside the field, and the button. Both read the buffer rather than
  // the prop, because a caller that draws a composer without wiring `onInput` still has the text in
  // front of the reader — and `busy` and `disabled` refuse both, in one place.
  const send = (value?: string) => {
    if (props.disabled || props.busy) return
    props.onSubmit(value ?? (area ? area.plainText : props.value))
  }
  return (
    <box flexDirection="column" {...boxBorder('surface')} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <Line tone="accent">{'>'}</Line>
        <Textarea
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          rows={props.rows ?? 3}
          boxed={false}
          grow
          ref={(element: Renderable) => { area = element as Renderable & FieldApi }}
          onInput={(value) => props.onInput?.(value)}
          onSubmit={(value) => send(value)}
        />
      </box>
      <Show when={props.error}><Line tone="danger">{props.error!}</Line></Show>
      <box flexDirection="row" gap={1}>
        {slot(props.hint)}
        <box flexGrow={1} />
        {slot(props.secondary)}
        <Button tone="accent" disabled={props.disabled || props.busy} onPress={() => send()}>
          {props.submitLabel ?? 'Comment'}
        </Button>
      </box>
    </box>
  )
}

/** reduced: no inline highlight of the completed token; the menu is a list under the field. Colouring
 *  a run inside an edit buffer means a mirror element over the field, and a terminal has no layer to
 *  put one on. */
export function MentionTextarea(props: MentionTextareaProps) {
  // The word being typed after a sigil, which is the whole of what the mirror was for.
  const active = () => {
    const sigils = props.sources?.map((source) => source.sigil) ?? (props.mentions ? ['@'] : [])
    const word = /(\S+)$/.exec(props.value)?.[1] ?? ''
    const sigil = sigils.find((candidate) => word.startsWith(candidate))
    return sigil ? { sigil, query: word.slice(sigil.length) } : null
  }
  const suggestions = () => {
    const current = active()
    if (!current) return []
    const source = props.sources?.find((candidate) => candidate.sigil === current.sigil)
    if (source) return source.suggest(current.query)
    return (props.mentions ?? [])
      .filter((name) => name.toLowerCase().includes(current.query.toLowerCase()))
      .slice(0, 8)
      .map((name) => ({ value: `@${name}`, label: name }))
  }
  // Completing the word being typed, which is what choosing a suggestion means. The DOM half splices
  // by cursor offset; there is no cursor to ask here, so it replaces the trailing word — which is the
  // same edit for every case `active()` recognises, because that is the word it found.
  const complete = (value: string) => {
    if (!active()) return
    props.onInput(props.value.replace(/\S+$/, `${value} `))
  }
  let list: Renderable | undefined
  return (
    <box flexDirection="column">
      {slot(props.overlay)}
      <Textarea
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={props.rows ?? 3}
        // The agents composer is a `MentionTextarea` rather than a `Composer`, and it wants the same
        // send. The shared prop calls this "Enter without a modifier", which is the DOM's chat-style
        // Enter; in a terminal Enter in a text field is a newline and nothing else can be, so it is
        // the `commit` chord here — the same key the footer already names beside a focused field.
        {...(props.onSubmit ? { onSubmit: () => props.onSubmit!() } : {})}
        ref={(element: Renderable) => {
          // Landing here is the point of the pane. A reader who opens an agent run has come to write
          // to it, so this field is what entering the region gives the keys to, and the transcript
          // beside it is reached with Escape or Tab (../keys/regions.ts § markEntry).
          markEntry(element)
          // Two keys that fire while somebody is typing, and the reason is the shape: the field IS
          // the typing target and the list under it is the field's own, so neither can mean "type
          // this" and there is nothing else for them to reach. They say so with their tier: `STOP`
          // sits above the typing shadow, and both are bound to the field itself, which is the one
          // thing the shadow deliberately leaves alone (../keys/tiers.ts § TYPING). The palette needs
          // the same thing for the same reason and gets it above the trap instead
          // (../keys/trap.ts § overlayKeys).
          bindKeys(element, [{
            key: 'down',
            cmd: () => {
              if (!list || !suggestions().length) return false
              // Entering the list, not walking it: the field is not one of its stops, so there is
              // nothing to step from (../keys/regions.ts § walkStops).
              return focusRenderable(stopsIn(list)[0])
            },
          }, {
            // Enter sends, which is what the shared prop has always said this field does: `onSubmit`
            // is documented as "Enter without a modifier. Absent leaves Enter as a newline", and the
            // DOM half reads exactly that (client-core/kit/components/inputs/MentionTextarea.tsx).
            // This host had it on the `commit` chord alone, so the composer's own hint — "Shift+Enter
            // for newline" — described a keyboard nobody had. `commit` still works, and Shift+Return
            // is not this binding, so it falls through to the typing path and inserts the newline.
            //
            // On a terminal that ignores the kitty keyboard protocol there is one byte for both, so
            // Shift+Return sends too and a newline has to come from the ＋ picker or a paste. That is
            // the same terminal on which `ctrl+return` never arrived either (../input/terminal.ts).
            key: 'return',
            cmd: () => {
              // An open list takes it first, and takes the row it is showing at the top — the DOM
              // chooses `suggestions()[selected()]` and lands on the same row when nobody has moved.
              const [first] = suggestions()
              if (first) { complete(first.value); return true }
              if (!props.onSubmit) return false
              props.onSubmit()
              return true
            },
          }], STOP, { mode: 'focus' })
        }}
        onInput={props.onInput}
      />
      <Show when={suggestions().length}>
        <box flexDirection="column" paddingLeft={2} ref={(element: Renderable) => { list = element }}>
          <For each={suggestions()}>
            {(suggestion) => (
              <PickerRow
                label={suggestion.label}
                description={'detail' in suggestion ? suggestion.detail : undefined}
                onSelect={() => complete(suggestion.value)}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

/** A two-column table with editable cells, each cell a stop. `<Index>`, not `<For>`: `<For>` keys by
 *  object identity, so replacing a row on every keystroke tears down its field and drops the cursor.
 *  The gotcha is the same on both hosts. */
export function KeyValueEditor(props: {
  rows: readonly { enabled?: boolean; key: string; value: string }[]
  onChange: (rows: { enabled?: boolean; key: string; value: string }[]) => void
  columns?: readonly { id: string; header: string; render: (row: { enabled?: boolean; key: string; value: string }, update: (patch: Partial<{ enabled: boolean; key: string; value: string }>) => void, index: number) => JSX.Element }[]
  rowHint?: (row: { enabled?: boolean; key: string; value: string }) => string | undefined
  enableColumn?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
  ariaLabel: string
}) {
  const blank = () => ({ key: '', value: '', enabled: true })
  const padded = () => [...props.rows, blank()]
  const write = (index: number, patch: Partial<{ enabled: boolean; key: string; value: string }>) => {
    const next = [...props.rows]
    if (index === props.rows.length) next.push({ ...blank(), ...patch })
    else next[index] = { ...next[index], ...patch }
    props.onChange(next.filter((row, at) => row.key || row.value || at === index))
  }
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <Line role="strong">{props.keyPlaceholder ?? 'Name'}</Line>
        <Line role="strong">{props.valuePlaceholder ?? 'Value'}</Line>
      </box>
      <Index each={padded()}>
        {(row, index) => (
          <box flexDirection="row" gap={1}>
            <Show when={props.enableColumn !== false}>
              <Checkbox checked={row().enabled} onChange={(checked) => write(index, { enabled: checked })} />
            </Show>
            <Input value={row().key} placeholder={props.keyPlaceholder ?? 'Name'} onInput={(value) => write(index, { key: value })} />
            <Input value={row().value} placeholder={props.valuePlaceholder ?? 'Value'} onInput={(value) => write(index, { value })} />
          </box>
        )}
      </Index>
    </box>
  )
}

/** `/ query  3/12` on one line. */
export function FindBar(props: {
  query: string
  onQuery: (query: string) => void
  count?: { current: number; total: number }
  onNext: () => void
  onPrev: () => void
  onClose?: () => void
  toggles?: JSX.Element
  status?: JSX.Element
  placeholder?: string
  ref?: unknown
}) {
  return (
    <box flexDirection="row" gap={1}>
      <Line tone="accent">/</Line>
      <Input kind="filter" placeholder={props.placeholder ?? 'Find…'} value={props.query} onInput={props.onQuery} />
      <Show when={props.count}>
        {(count) => (
          <Line role="muted">{count().total ? `${count().current}/${count().total}` : 'no matches'}</Line>
        )}
      </Show>
      {slot(props.status)}
      {slot(props.toggles)}
    </box>
  )
}

/** The label above its child. */
export function Field(props: {
  label?: string
  hint?: string
  error?: string
  layout?: 'stack' | 'row' | 'split'
  group?: boolean
  children: JSX.Element
}) {
  return (
    <box flexDirection={props.layout === 'row' ? 'row' : 'column'} gap={props.layout === 'row' ? 1 : 0}>
      <Show when={props.label}><Line role="muted">{props.label!}</Line></Show>
      {props.children}
      <Show when={props.hint}><Line role="muted">{props.hint!}</Line></Show>
      <Show when={props.error}><Line tone="danger">{props.error!}</Line></Show>
    </box>
  )
}

/** fallback: the level is `fallback` because a terminal cannot reach the clipboard portably. Where
 *  the terminal advertises OSC 52 the button works and the level is `full` at runtime; where it does
 *  not, the host prints the value on its own line to copy by hand (./copy.ts). */
// `always` is accepted and ignored. On the DOM host it turns off a hover reveal; a terminal has no
// hover, so this copy is drawn either way and a caller that needs the button visible on both hosts
// should not have to ask twice.
export function CopyButton(props: { text: () => string; onCopy?: (text: string) => void; title?: string; always?: boolean }) {
  const [shown, setShown] = createSignal(false)
  const copy = () => {
    const text = props.text()
    if (props.onCopy) return props.onCopy(text)
    if (!copyToTerminal(text)) setShown(true)
  }
  return (
    <box flexDirection="column">
      <Button variant="bare" onPress={copy}>⧉</Button>
      <Show when={shown()}><Line role="mono">{props.text()}</Line></Show>
    </box>
  )
}

/** A `Picker` over the connected models, grouped by provider. */
export function ModelConnectionPicker(props: {
  connections: readonly { connection: { id: string; label?: string }; provider: { models?: readonly { id: string; label?: string }[] } }[]
  connectionId: string
  modelId: string
  onChange: (selection: { connectionId: string; modelId: string }) => void
}) {
  const current = () => props.connections.find((entry) => entry.connection.id === props.connectionId) ?? props.connections[0]
  const models = () => current()?.provider.models ?? []
  return (
    <box flexDirection="row" gap={1}>
      <Show when={props.connections.length > 1}>
        <Select
          label="Connection"
          value={props.connectionId}
          options={props.connections.map((entry) => ({ value: entry.connection.id, label: entry.connection.label ?? entry.connection.id }))}
          onChange={(connectionId) => props.onChange({ connectionId, modelId: props.modelId })}
        />
      </Show>
      <Select
        label="Model"
        value={props.modelId}
        options={models().map((model) => ({ value: model.id, label: model.label ?? model.id }))}
        onChange={(modelId) => props.onChange({ connectionId: props.connectionId, modelId })}
      />
    </box>
  )
}

export type { ItemProps }
