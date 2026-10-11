/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import type { InputProps } from '@acorn/client-core/kit/components/primitives.tsx'
import type { Size } from '@acorn/client-core/kit/tokens'
import { registerIntentLayer } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { focusWithin, requestRenderableFocus } from '../../keys/regions'
import { STOP } from '../../keys/tiers'
import { slotColor } from '../../appearance'
import { boxBorder } from '../roles'
import { fieldRef, type FieldApi } from './fieldRef'

/** The two colours a field draws in, said as slots rather than left to paint, so neither is a colour
 *  outside the sixteen a terminal has or one no theme chose
 *  (../../appearance.ts, docs/ui-design/appearance.md § Roles, and what each host makes of them). */
const fieldColors = () => ({
  textColor: slotColor('default'),
  placeholderColor: slotColor('muted'),
})

export function Input(props: InputProps) {
  let field: Renderable | undefined
  const autofocus = createMemo(() => props.autofocus)
  createEffect(
    on(autofocus, (active) => {
      if (active && field && !field.isDestroyed) onCleanup(requestRenderableFocus(field))
    }),
  )
  const install = fieldRef({
    value: () => (props.value === undefined ? '' : String(props.value)),
    newline: false,
    masked: props.type === 'password',
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
      ref={(element: Renderable) => {
        field = element
        install(element)
      }}
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
  /** Shared `commit` intent for fields that submit their own draft. */
  onCommit?: () => void
  onToggleExpand?: () => void
  /** The composer's existing `commit` callback receives the buffer's text. */
  onSubmit?: (value: string) => void
  onBlur?: () => void
  onFocus?: () => void
  ref?: unknown
}

/** Everything a `Textarea` does that is not the edit buffer: the caller's `ref`, and the one chord
 *  that reaches a field while somebody is typing. Its own function because it is the half of the
 *  component that has nothing to do with what is typed into it. */
function textareaRef(props: TextareaProps, element: Renderable & FieldApi): void {
  // The `ref` prop hands over the renderable: a `Composer` reads the buffer's text when its submit
  // button is pressed, and there is no other way to ask.
  if (typeof props.ref === 'function') (props.ref as (node: Renderable & FieldApi) => void)(element)
  // `commit` is a chord — Ctrl+Return on this host — so it reaches a focused field: it is one of
  // the typing-exempt intents by design (client-core kit/keys/intents.ts § TYPING_EXEMPT). Bound
  // in `focus` mode, so a composer inside a list does not answer for the list.
  onCleanup(
    registerIntentLayer(
      element,
      ['commit', ...(props.onToggleExpand ? (['maximize'] as const) : [])],
      (intent) => {
        if (intent === 'maximize') {
          if (props.disabled || !props.onToggleExpand) return false
          props.onToggleExpand()
          return true
        }
        if (props.disabled || props.readOnly || (!props.onCommit && !props.onSubmit)) return false
        if (props.onCommit) props.onCommit()
        else props.onSubmit?.(element.plainText)
        return true
      },
      { priority: STOP, mode: 'focus' },
    ),
  )
}

export function Textarea(props: TextareaProps) {
  const [box, setBox] = createSignal<Renderable>()
  // The two callbacks the shared props declare and the DOM half fires. A caller that gates something
  // on "the keys are in this field" needs the same answer on both hosts — the changes pane's commit
  // chords are gated on exactly that.
  //
  // Read off the region store rather than off an event, because that is where focus is on a host with
  // no pointer (../../keys/regions.ts). Deferred, so a field that mounts unfocused does not report a
  // blur nobody performed.
  createEffect(
    on(
      () => focusWithin(box()),
      (has) => (has ? props.onFocus?.() : props.onBlur?.()),
      { defer: true },
    ),
  )
  const install = fieldRef({
    value: () => props.value ?? '',
    newline: true,
    onInput: (value) => props.onInput?.(value),
  })
  // The box the node's own sentence promises, and it earns its two rows twice over. It is the only
  // thing separating a message box from whatever is stacked above it — on the agents pane that is a
  // transcript, a row of provider pickers and an expand toggle, and unboxed the field reads as one
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
        // `rows` is "visible lines" on the shared props. Without it every field is exactly as tall as what is
        // in it, and the composer's own "Expand the message box" toggle — a swap from 3 rows to 18 — does
        // nothing at all. A floor rather than a height, because a field taller than its `rows` should still
        // show what has been typed into it (../../layout/measure.ts § measureField).
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
