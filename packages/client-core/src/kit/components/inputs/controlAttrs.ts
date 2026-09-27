import type { Size } from '../../tokens/tokens'

/** Props shared by text controls on both hosts. The terminal kit compiles its roster against this
 *  type, so it cannot silently drop a control prop. */
export type ControlOwn = {
  size?: Extract<Size, 'sm' | 'md'>
  invalid?: boolean
  width?: 'full' | 'auto' | 'narrow'
  /* `filter` is the boxed list-narrowing input. `bare` is the borderless underline that heads a
     palette or popover. */
  kind?: 'filter' | 'bare'
  /** The accessible name, where no <Field> gives it one. */
  label?: string
  title?: string
  id?: string
  name?: string
  disabled?: boolean
  required?: boolean
  autofocus?: boolean
  /** Whether the platform helps with what is typed: spelling, autocorrect, capitalisation. One prop
   *  rather than three attributes, because the answer is always the same for all three. Off for
   *  anything that is not prose: an identifier, a URL, a query. Defaults to on. */
  assist?: boolean
}

export const controlAttrs = (own: ControlOwn, base = 'ui-input') => ({
  class: base,
  'data-size': own.size ?? 'md',
  'data-width': own.width ?? 'full',
  'data-kind': own.kind,
  'data-invalid': own.invalid ? '' : undefined,
  'aria-invalid': own.invalid ? ('true' as const) : undefined,
  'aria-label': own.label,
  id: own.id,
  title: own.title,
  disabled: own.disabled,
})

/** The platform's typing help, as the two attributes that carry it. Off `controlAttrs` because a
 *  Select's trigger is a button, and a button has no text to correct. */
export const assistAttrs = (own: ControlOwn) => ({
  spellcheck: own.assist,
  autocapitalize: own.assist === false ? ('off' as const) : undefined,
})
