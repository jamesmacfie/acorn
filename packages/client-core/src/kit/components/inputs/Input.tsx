import { For, Show, splitProps } from 'solid-js'
import { assistAttrs, claimField, controlAttrs, type ControlOwn } from './controlAttrs'

/** The text-entry kinds a control may be. No `file`, no `range`, no `color`: each of those is a
 *  different control wearing an input's clothes. */
export type InputType = 'text' | 'search' | 'password' | 'email' | 'url' | 'number' | 'date' | 'time'

export type InputProps = ControlOwn & {
  value?: string | number
  type?: InputType
  placeholder?: string
  readOnly?: boolean
  maxLength?: number
  min?: string | number
  max?: string | number
  step?: string | number
  /** The value as it is typed. An input is host-owned: what comes back is the text, never an event.
   *  Not one of the kit's eleven events, and deliberately: a remote tree cannot bind a per-keystroke
   *  callback, because every keystroke would be a message hop. */
  onInput?: (value: string) => void
  /** The committed value: blur, or Enter. `onChange` rather than `onCommit` because commit IS what
   *  the kit means by a change (docs/ui-design.md § The closed kit), and only a name in that list can carry
   *  a handler across the remote root. */
  onChange?: (value: string) => void
  /** Enter, with the value. The kit's own name for "the reader is done and wants this to happen",
   *  which is what a URL bar's Enter means. A caller that also wants keys as they arrive uses
   *  `onKeyDown`, and a remote tree cannot: a DOM event does not cross. */
  onSubmit?: (value: string) => void
  /** An input owns its keys while focused, which is why this is here and nowhere else in the kit.
   *  See docs/ui-design.md § The closed kit. */
  onKeyDown?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
  onFocus?: () => void
  onBlur?: () => void
  /** Solid's ref, in both spellings: a variable binding or a callback. */
  /** Values to offer while typing. The kit draws the list; a plugin never writes a `<datalist>`.
   *  A list you must pick from is a Select, and one that filters as you type is a Picker. */
  suggestions?: readonly string[]
  ref?: HTMLInputElement | ((element: HTMLInputElement) => void)
}

let suggestionSeq = 0

export function Input(props: InputProps) {
  const [own, rest] = splitProps(
    props,
    ['size', 'invalid', 'width', 'kind', 'label', 'title', 'id', 'name', 'disabled', 'required', 'autofocus', 'assist'],
    ['onInput', 'onChange', 'onSubmit', 'onKeyDown', 'onPaste', 'onFocus', 'onBlur', 'ref'],
  )
  const listId = `ui-suggest-${++suggestionSeq}`
  const field = claimField(own.id)
  return (
    <>
    <input
      {...controlAttrs(own, 'ui-input', field)}
      {...assistAttrs(own)}
      ref={rest.ref}
      name={own.name}
      required={own.required}
      autofocus={own.autofocus}
      list={props.suggestions ? listId : undefined}
      type={props.type ?? 'text'}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      readOnly={props.readOnly}
      maxLength={props.maxLength}
      min={props.min}
      max={props.max}
      step={props.step}
      onInput={(event) => rest.onInput?.(event.currentTarget.value)}
      onChange={(event) => rest.onChange?.(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && rest.onSubmit) rest.onSubmit(event.currentTarget.value)
        rest.onKeyDown?.(event)
      }}
      onPaste={(event) => rest.onPaste?.(event)}
      onFocus={() => rest.onFocus?.()}
      onBlur={() => rest.onBlur?.()}
    />
    <Show when={props.suggestions}>
      {(values) => <datalist id={listId}><For each={values()}>{(value) => <option value={value} />}</For></datalist>}
    </Show>
    </>
  )
}
