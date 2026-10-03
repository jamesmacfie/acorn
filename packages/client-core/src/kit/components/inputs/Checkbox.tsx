import { createEffect, Show, type JSX } from 'solid-js'
import type { Size } from '../../tokens/tokens'
import { claimField } from './controlAttrs'

/* Checkbox. See docs/ui-design/kit-internals.md § How the kit is built for why it styles the native
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
  // A labelled box is md unless asked otherwise. An unlabelled one keeps the small box a table or a
  // list row draws, unless a caller asks for md.
  const size = () => props.size ?? (props.label ? 'md' : 'sm')
  // A box with words of its own is named by them. A bare one takes the caption of the row or field it
  // sits in, which is what makes clicking "Play a sound" flip the switch beside it.
  const field = props.label ? undefined : claimField(props.id)
  // Tri-state is a DOM property, not an attribute, so it takes an effect.
  createEffect(() => {
    if (ref) ref.indeterminate = !!props.indeterminate
  })
  const input = (
    <input
      ref={(el) => { ref = el }}
      type="checkbox"
      class="ui-check-box"
      data-size={size()}
      id={field?.id ?? props.id}
      name={props.name}
      checked={props.checked}
      disabled={props.disabled}
      data-tip={props.label ? undefined : props.title}
      // The tip used to be the browser's `title`, which doubled as the name of a bare box.
      aria-label={props.ariaLabel ?? (props.label || field ? undefined : props.title)}
      aria-describedby={field?.describedBy()}
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
        data-size={size()}
        data-switch={props.switch ? '' : undefined}
        data-nested={props.nested ? '' : undefined}
        data-tip={props.title}
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
