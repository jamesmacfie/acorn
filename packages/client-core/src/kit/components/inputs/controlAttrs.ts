import { createContext, createSignal, createUniqueId, onCleanup, untrack, useContext } from 'solid-js'
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

/** What a `Field` or a `SettingRow` hands the control inside it: the id its caption's `<label for>`
 *  points at, and the ids of the hint, error, and help that describe it. */
export type FieldClaim = { id: string; describedBy: () => string | undefined }

const FieldSlot = createContext<(id?: string) => FieldClaim | undefined>()

/* The host half. The first control that claims gets the id, and the caption labels it only while it
   is the one control there. A second claim means a group of controls, which keep their own names.

   A context rather than wrapping the control in a <label>: a label names everything inside it, so a
   hint, an error, or a help button became part of the control's name. */
export function createFieldSlot(describedBy: () => string | undefined) {
  const hostId = createUniqueId()
  const [count, setCount] = createSignal(0)
  const [first, setFirst] = createSignal<string>()
  const claim = (id?: string): FieldClaim | undefined => {
    // Untracked: the claim runs while the host's children are being built, and a tracked read would
    // rebuild them every time the count moved.
    const taken = untrack(count) > 0
    setCount((n) => n + 1)
    onCleanup(() => setCount((n) => n - 1))
    if (taken) return undefined
    const own = id ?? hostId
    setFirst(own)
    onCleanup(() => setFirst(undefined))
    return { id: own, describedBy }
  }
  return { claim, target: () => (count() === 1 ? first() : undefined) }
}

export const FieldProvider = FieldSlot.Provider
/** For a host that must keep the controls inside it out of an outer field: a `Field group`, or a
 *  popover list whose filter box is not the control the caption names. */
export const NO_FIELD = (): FieldClaim | undefined => undefined

/** Called once, in the control's body, so a control claims one id however often it redraws. */
export const claimField = (id?: string) => useContext(FieldSlot)?.(id)

export const controlAttrs = (own: ControlOwn, base = 'ui-input', field?: FieldClaim) => ({
  class: base,
  'data-size': own.size ?? 'md',
  'data-width': own.width ?? 'full',
  'data-kind': own.kind,
  'data-invalid': own.invalid ? '' : undefined,
  'aria-invalid': own.invalid ? ('true' as const) : undefined,
  'aria-label': own.label,
  'aria-describedby': field?.describedBy(),
  id: field?.id ?? own.id,
  // The app's tip rather than the browser's, so there is one look and a keyboard reaches it.
  'data-tip': own.title,
  disabled: own.disabled,
})

/** The platform's typing help, as the two attributes that carry it. Off `controlAttrs` because a
 *  Select's trigger is a button, and a button has no text to correct. */
export const assistAttrs = (own: ControlOwn) => ({
  spellcheck: own.assist,
  autocapitalize: own.assist === false ? ('off' as const) : undefined,
})
