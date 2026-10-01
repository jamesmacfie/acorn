import { splitProps } from 'solid-js'
import { bindIntents } from '../../keys/keymapHost'
import { assistAttrs, controlAttrs, type ControlOwn } from './controlAttrs'

export type TextareaProps = ControlOwn & {
  value?: string
  placeholder?: string
  /** Visible lines. A number, because a textarea's height is measured in its own text. */
  rows?: number
  /** Fill the region it is in rather than sizing to `rows`. The note editor and any other "this pane
   *  IS a text field" surface. A role rather than a height: the region's own box decides how tall
   *  that is, and the reader loses the drag handle, which would fight it. */
  grow?: boolean
  mono?: boolean
  readOnly?: boolean
  maxLength?: number
  onInput?: (value: string) => void
  /** The host's commit chord: Command-Enter on macOS, Control-Enter elsewhere. */
  onCommit?: () => void
  /** The committed value: blur, or Enter. See `InputProps.onChange`. */
  onChange?: (value: string) => void
  /** A textarea owns its keys and its own surface while focused: the composer completes mentions,
   *  the editor takes a dropped file. One of the three nodes the kit lets keys through. See
   *  docs/ui-design.md § The closed kit. */
  onKeyDown?: (event: KeyboardEvent) => void
  onKeyUp?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
  onDrop?: (event: DragEvent) => void
  onDragOver?: (event: DragEvent) => void
  onScroll?: () => void
  onFocus?: () => void
  onBlur?: () => void
  onPress?: () => void
  ref?: HTMLTextAreaElement | ((element: HTMLTextAreaElement) => void)
}

export function Textarea(props: TextareaProps) {
  const [own] = splitProps(
    props,
    ['size', 'invalid', 'width', 'kind', 'label', 'title', 'id', 'name', 'disabled', 'required', 'autofocus', 'assist'],
  )
  return (
    <textarea
      {...controlAttrs(own)}
      {...assistAttrs(own)}
      ref={props.onCommit ? (element) => {
        if (typeof props.ref === 'function') props.ref(element)
        bindIntents(element, ['commit'], () => {
          if (props.disabled || props.readOnly || !props.onCommit) return false
          props.onCommit()
          return true
        }, { mode: 'focus' })
      } : props.ref}
      name={own.name}
      required={own.required}
      autofocus={own.autofocus}
      data-mono={props.mono ? '' : undefined}
      data-grow={props.grow ? '' : undefined}
      rows={props.rows}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      readOnly={props.readOnly}
      maxLength={props.maxLength}
      onInput={(event) => props.onInput?.(event.currentTarget.value)}
      onChange={(event) => props.onChange?.(event.currentTarget.value)}
      onKeyDown={(event) => props.onKeyDown?.(event)}
      onKeyUp={(event) => props.onKeyUp?.(event)}
      onPaste={(event) => props.onPaste?.(event)}
      onDrop={(event) => props.onDrop?.(event)}
      onDragOver={(event) => props.onDragOver?.(event)}
      onScroll={() => props.onScroll?.()}
      onFocus={() => props.onFocus?.()}
      onBlur={() => props.onBlur?.()}
      onClick={() => props.onPress?.()}
    />
  )
}
