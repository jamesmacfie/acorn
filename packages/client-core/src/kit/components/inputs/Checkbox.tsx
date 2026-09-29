import { createEffect, Show, type JSX } from 'solid-js'
import type { Size } from '../../tokens/tokens'

/* Checkbox. See docs/ui-design.md § How the kit is built for why it styles the native
   input rather than rebuilding it, and how `switch` reuses the same element. */
export function Checkbox(props: {
  label?: JSX.Element
  hint?: string
  checked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  switch?: boolean
  size?: Extract<Size, 'sm' | 'md'>
  nested?: boolean
  /** The accessible name, where there is no visible label. */
  ariaLabel?: string
  title?: string
  id?: string
  name?: string
  /** A handler may return the write it started. When that resolves `false`, the write failed and the box
   *  shows `checked` again, because a native checkbox flips itself on click and nothing else would put it
   *  back when the stored value never moved. `createSettingSave().run` returns exactly that. */
  onChange?: (checked: boolean) => unknown
}) {
  let ref: HTMLInputElement | undefined
  // Tri-state is a DOM property, not an attribute, so it takes an effect.
  createEffect(() => {
    if (ref) ref.indeterminate = !!props.indeterminate
  })
  const input = (
    <input
      ref={(el) => { ref = el }}
      type="checkbox"
      class="ui-check-box"
      id={props.id}
      name={props.name}
      checked={props.checked}
      disabled={props.disabled}
      title={props.label ? undefined : props.title}
      aria-label={props.ariaLabel}
      role={props.switch ? 'switch' : undefined}
      data-switch={props.switch ? '' : undefined}
      onChange={(event) => {
        const box = event.currentTarget
        const write = props.onChange?.(box.checked)
        if (write instanceof Promise) {
            void write.then((saved) => {
              if (saved !== false) return
              box.checked = !!props.checked
              box.indeterminate = !!props.indeterminate
            })
          }
      }}
    />
  )
  return (
    <Show when={props.label} fallback={input}>
      <label
        class="ui-check"
        data-size={props.size ?? 'md'}
        data-switch={props.switch ? '' : undefined}
        data-nested={props.nested ? '' : undefined}
        title={props.title}
      >
        {input}
        <span class="ui-check-label">
          {props.label}
          <Show when={props.hint}><small class="ui-check-hint">{props.hint}</small></Show>
        </span>
      </label>
    </Show>
  )
}
