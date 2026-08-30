import { Show, type JSX } from 'solid-js'
import { restoreFocusOnCleanup } from '../../keys/trap'
import { createDismissable } from '../lib/dismissable'

// Modal chrome. Behaviour comes from createDismissable. See docs/ui-design.md § Chrome and
// overlays for why that split keeps this component purely cosmetic, and why the overlay palettes
// don't use it.
//
// A trap: it holds Tab inside while it is open and hands focus back to whatever opened it when it
// goes (../keys/trap.ts). Before that, dismissing left the body focused and the next Tab started
// again from the top of the page.

export function Modal(props: {
  /** `onDismiss` rather than `onClose` because dismissal is one of the kit's eleven events, and only
   *  a name in that list can carry a handler across the remote root
   *  (docs/plugins.md § The tree contract). */
  onDismiss: () => void
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
  children: JSX.Element
}) {
  let dialog!: HTMLDivElement
  const dismiss = createDismissable({
    onDismiss: () => props.onDismiss(),
    container: () => dialog,
    on: props.dismissOn,
  })

  // Read before anything inside is focused, so the opener is still the active element.
  restoreFocusOnCleanup()
  if (props.autoFocus) queueMicrotask(() => props.autoFocus?.()?.focus())

  return (
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div
        ref={dialog}
        class="overlay"
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

/* The two halves, as nodes of their own rather than only as `Modal.Body` and `Modal.Actions`. A
   remote tree names one type per node and has nowhere to put the dot, and the kit is meant to be the
   same set on both render paths. The compound spellings stay as aliases, because they read better at
   a call site that already has `Modal` in hand. */
export function ModalBody(props: { children: JSX.Element }) {
  return <div class="overlay-body">{props.children}</div>
}

export function ModalActions(props: { children: JSX.Element }) {
  return <div class="ui-modal-actions">{props.children}</div>
}

Modal.Body = ModalBody
Modal.Actions = ModalActions
