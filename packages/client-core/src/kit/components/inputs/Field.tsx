import { Show, type JSX } from 'solid-js'

/** Label + control + optional hint/error.
 *
 *  `group` covers what a `<label>` cannot: several controls under one caption, each with a label of
 *  its own. Nested labels are invalid, and the browser's repair points the outer one at the first
 *  control, so clicking the caption toggles a checkbox nobody meant to touch. `role="group"` with
 *  the caption as its accessible name says the true thing instead. */
export function Field(props: {
  label?: string
  hint?: string
  error?: string
  /** `stack` is label over control. See docs/ui-design.md for `row` and `split`. */
  layout?: 'stack' | 'row' | 'split'
  group?: boolean
  children: JSX.Element
}) {
  const inner = (
    <>
      <Show when={props.label}><span class="ui-field-label">{props.label}</span></Show>
      {props.children}
      <Show when={props.hint}><span class="ui-field-hint">{props.hint}</span></Show>
      <Show when={props.error}><span class="ui-field-error" role="alert">{props.error}</span></Show>
    </>
  )
  return (
    <Show
      when={props.group}
      fallback={(
        <label class="ui-field" data-layout={props.layout ?? 'stack'}>{inner}</label>
      )}
    >
      <div class="ui-field" data-layout={props.layout ?? 'stack'} role="group" aria-label={props.label}>
        {inner}
      </div>
    </Show>
  )
}
