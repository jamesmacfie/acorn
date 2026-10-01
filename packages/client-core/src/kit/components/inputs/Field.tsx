import { createUniqueId, Show, type JSX } from 'solid-js'
import { HelpMark } from '../content/HelpMark'
import { createFieldSlot, FieldProvider, NO_FIELD } from './controlAttrs'

/** Label + control + optional hint/error.
 *
 *  The caption alone is the `<label>`, pointed at the control by id, and the hint, the error, and the
 *  help describe the control by id. A label wrapped round all of them made the hint and any error
 *  part of the control's name ("Port The port the server listens on"). The control claims the id
 *  itself (./controlAttrs.ts), so a caller never writes one.
 *
 *  `group` covers what a `<label>` cannot: several controls under one caption, each with a label of
 *  its own. `role="group"` with the caption as its accessible name says the true thing, and the
 *  controls inside keep their own names. */
export function Field(props: {
  label?: string
  hint?: string
  error?: string
  /** How it works or why it is there, behind a "?" after the caption. `hint` is for what to type. */
  help?: string
  /** `stack` is label over control. See docs/ui-design.md for `row` and `split`. */
  layout?: 'stack' | 'row' | 'split'
  group?: boolean
  children: JSX.Element
}) {
  const labelId = createUniqueId()
  const hintId = createUniqueId()
  const errorId = createUniqueId()
  const helpId = createUniqueId()
  const described = () =>
    [props.hint && hintId, props.error && errorId, props.help && helpId].filter(Boolean).join(' ') || undefined
  const slot = createFieldSlot(described)
  const caption = (
    <Show when={props.label}>
      <Show
        when={props.help}
        fallback={<label class="ui-field-label" id={labelId} for={slot.target()}>{props.label}</label>}
      >
        {(help) => (
          <span class="ui-titled">
            <label class="ui-field-label" id={labelId} for={slot.target()}>{props.label}</label>
            <HelpMark text={help()} titleId={labelId} textId={helpId} />
          </span>
        )}
      </Show>
    </Show>
  )
  const tail = (
    <>
      <Show when={props.hint}><span class="ui-field-hint" id={hintId}>{props.hint}</span></Show>
      <Show when={props.error}><span class="ui-field-error" id={errorId} role="alert">{props.error}</span></Show>
    </>
  )
  return (
    <Show
      when={props.group}
      fallback={(
        <div class="ui-field" data-layout={props.layout ?? 'stack'}>
          {caption}
          <FieldProvider value={slot.claim}>{props.children}</FieldProvider>
          {tail}
        </div>
      )}
    >
      <div class="ui-field" data-layout={props.layout ?? 'stack'} role="group" aria-labelledby={props.label ? labelId : undefined}>
        {caption}
        <FieldProvider value={NO_FIELD}>{props.children}</FieldProvider>
        {tail}
      </div>
    </Show>
  )
}
