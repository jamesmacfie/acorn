import { createUniqueId, onMount, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { focusableIn, restoreFocusOnCleanup } from '../../keys/trap'
import { createDismissable } from '../../lib/controls/dismissable'
import { IconButton } from '../inputs/IconButton'

// Modal chrome. Behaviour comes from createDismissable. See docs/ui-design/overlays.md § Chrome and
// overlays for why that split keeps this component purely cosmetic, and why the overlay palettes
// don't use it.
//
// A trap: it holds Tab inside while it is open and hands focus back to whatever opened it when it
// goes (../keys/trap.ts). Before that, dismissing left the body focused and the next Tab started
// again from the top of the page.
//
// It portals, like every other overlay in the kit. `.pane` sets `contain: layout paint`
// (infra/styles/shell.css), which makes the pane a containing block for `position: fixed`, so a
// modal rendered inline inside a pane got a backdrop the size of that pane and clipped by its
// `overflow: auto` rather than one over the window. The ref-based focus trap and dismissal are
// unaffected by the move, and a loaded plugin's overlay is inside an iframe, so it stays boxed
// either way (host/frames/PluginRefPanel.tsx).
//
// Focus moves inside on open, so the next Tab stays in the dialog and a screen reader hears it. With
// no `autoFocus`, it goes to the first control in the body. An `alertdialog` starts on its first
// footer button that is not `solid`, which is the Cancel, so Enter never confirms by accident.
// Without either, the dialog itself takes focus. Anything a child focused first, such as the wizard's
// step body, is left alone.

// Tab order within a part of the dialog, less anything a pointer or Tab cannot reach anyway.
const reachable = (dialog: HTMLElement, part: string): HTMLElement[] => {
  const root = dialog.querySelector<HTMLElement>(part)
  return root ? focusableIn(root).filter((element) => element.tabIndex >= 0) : []
}

function firstFocus(dialog: HTMLElement, role: 'dialog' | 'alertdialog'): HTMLElement {
  if (role === 'alertdialog') {
    const safe = reachable(dialog, '.ui-modal-actions').find((button) => button.dataset.variant !== 'solid')
    if (safe) return safe
  }
  return reachable(dialog, '.overlay-body')[0] ?? dialog
}

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
  const titleId = createUniqueId()
  const dismiss = createDismissable({
    onDismiss: () => props.onDismiss(),
    container: () => dialog,
    on: props.dismissOn,
  })

  // Read before anything inside is focused, so the opener is still the active element.
  restoreFocusOnCleanup()
  // After mount rather than straight away: a dialog under a Suspense boundary is built before it is
  // in the document, and a focus call on a detached element does nothing.
  onMount(() => queueMicrotask(() => {
    const own = props.autoFocus?.()
    if (own) return own.focus()
    if (!dialog?.isConnected || dialog.contains(document.activeElement)) return
    firstFocus(dialog, props.role ?? 'dialog').focus({ preventScroll: true })
  }))
  // An empty `dismissOn` means the dialog must be finished, not left, so it draws no close button.
  const closable = () => (props.dismissOn ?? ['escape']).length > 0

  return (
    <Portal>
      <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
        <div
          ref={dialog}
          class="overlay"
          data-size={props.size ?? 'md'}
          data-align={props.align ?? 'top'}
          data-layout={props.layout ?? 'stack'}
          role={props.role ?? 'dialog'}
          aria-modal="true"
          aria-labelledby={props.labelledBy ?? (props.title ? titleId : undefined)}
          tabindex="-1"
          onClick={dismiss.onContainerClick}
          onKeyDown={(event) => {
            if (props.onKeyDown?.(event)) return
            dismiss.onKeyDown(event)
          }}
        >
          <Show when={props.title}>
            <div class="overlay-title">
              <span class="overlay-title-text" id={titleId}>{props.title}</span>
              <Show when={closable()}>
                <IconButton icon="x" label="Close" onPress={() => props.onDismiss()} />
              </Show>
            </div>
          </Show>
          {props.children}
        </div>
      </div>
    </Portal>
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
