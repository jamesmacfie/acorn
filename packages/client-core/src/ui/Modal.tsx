import { Show, type JSX } from 'solid-js'
import { cx } from './cx'
import { createDismissable } from './dismissable'

// Modal chrome. Behaviour comes from createDismissable. See docs/ui-design.md § Chrome and
// overlays for why that split keeps this component purely cosmetic, and why the overlay palettes
// don't use it.

export function Modal(props: {
  onClose: () => void
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'wide'
  align?: 'top' | 'center'
  layout?: 'stack' | 'split'
  role?: 'dialog' | 'alertdialog'
  /** Which gestures dismiss. Defaults to Escape + backdrop. */
  dismissOn?: readonly ('escape' | 'backdrop')[]
  /** Extra keys handled before dismissal (e.g. ⌘↵ to submit). Return true if handled. */
  onKeyDown?: (event: KeyboardEvent) => boolean | void
  labelledBy?: string
  /** Focused once, after mount. A bare `autofocus` attribute is unreliable in a Solid modal, since
   *  the element is created before it is in the document, so this is a `queueMicrotask` focus, which
   *  two call sites were duplicating with identical comments. */
  autoFocus?: () => HTMLElement | undefined
  class?: string
  children: JSX.Element
}) {
  let dialog!: HTMLDivElement
  const dismiss = createDismissable({
    onDismiss: () => props.onClose(),
    container: () => dialog,
    on: props.dismissOn,
  })

  if (props.autoFocus) queueMicrotask(() => props.autoFocus?.()?.focus())

  return (
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div
        ref={dialog}
        class={cx('overlay', props.class)}
        data-size={props.size ?? 'md'}
        data-align={props.align ?? 'top'}
        data-layout={props.layout ?? 'stack'}
        role={props.role ?? 'dialog'}
        aria-modal="true"
        aria-labelledby={props.labelledBy}
        onClick={dismiss.onContainerClick}
        onKeyDown={(event) => {
          if (props.onKeyDown?.(event)) return
          dismiss.onKeyDown(event)
        }}
      >
        <Show when={props.title}><div class="overlay-title">{props.title}</div></Show>
        {props.children}
      </div>
    </div>
  )
}

Modal.Body = (props: { class?: string; children: JSX.Element }) => (
  <div class={cx('overlay-body', props.class)}>{props.children}</div>
)

Modal.Actions = (props: { class?: string; children: JSX.Element }) => (
  <div class={cx('ui-modal-actions', props.class)}>{props.children}</div>
)
