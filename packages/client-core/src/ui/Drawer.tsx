import { Show, type JSX } from 'solid-js'
import { cx } from './cx'
import { createDismissable } from './dismissable'
import { Button } from './primitives'

// Modal's sibling, not its child: the same behaviour core, different geometry. Edge-anchored,
// full-extent along that edge, slides in.
//
// Behaviour is createDismissable verbatim — that hook exists precisely so surfaces like this stay
// "purely cosmetic and therefore safely reviewable" (see Modal.tsx's note).
export function Drawer(props: {
  onClose: () => void
  side?: 'right' | 'left' | 'bottom'
  size?: 'sm' | 'md' | 'lg'
  title?: string
  /** Which gestures dismiss. Defaults to Escape + backdrop. */
  dismissOn?: readonly ('escape' | 'backdrop')[]
  labelledBy?: string
  class?: string
  children: JSX.Element
}) {
  let dialog!: HTMLDivElement
  const dismiss = createDismissable({
    onDismiss: () => props.onClose(),
    container: () => dialog,
    on: props.dismissOn,
  })

  return (
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div
        ref={dialog}
        class={cx('ui-drawer', props.class)}
        data-side={props.side ?? 'right'}
        data-size={props.size ?? 'md'}
        role="dialog"
        aria-modal="true"
        aria-label={props.labelledBy ? undefined : props.title}
        aria-labelledby={props.labelledBy}
        onClick={dismiss.onContainerClick}
        onKeyDown={dismiss.onKeyDown}
      >
        <Show when={props.title}>
          <div class="ui-drawer-head">
            <span class="ui-drawer-title">{props.title}</span>
            <Button variant="bare" iconOnly aria-label="Close" onClick={() => props.onClose()}>✕</Button>
          </div>
        </Show>
        {props.children}
      </div>
    </div>
  )
}
