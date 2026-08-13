import { Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover, type Placement } from './anchor'
import { cx } from './cx'

// The common case over createAnchoredPopover: a trigger and a floating surface.
//
// The trigger is a render prop rather than a `label` string because every current call site puts
// something different there — a Button, an avatar, a tab-rail row, a bell with a count badge. The
// hook is right there for anything this shape does not fit.
// A `display: contents` wrapper has no box of its own, so getBoundingClientRect on it returns an
// empty rect. Measure the trigger the wrapper contains instead — that is the element the surface is
// meant to be anchored to anyway.
const triggerOf = (wrapper: HTMLElement | undefined): HTMLElement | undefined =>
  (wrapper?.firstElementChild as HTMLElement | null) ?? wrapper

export default function Popover(props: {
  trigger: (state: { open: () => boolean; toggle: () => void }) => JSX.Element
  placement?: Placement
  minWidth?: number | 'anchor'
  disabled?: boolean
  /** Surface role. `menu`/`listbox` callers own their own item semantics. */
  role?: 'menu' | 'listbox' | 'dialog'
  ariaLabel?: string
  onDismiss?: () => void
  class?: string
  /** A function when the content needs to dismiss itself — a menu item's click lands INSIDE the
   *  surface, so outside-click will never fire for it. */
  children: JSX.Element | ((state: { close: () => void }) => JSX.Element)
}) {
  let anchorRef: HTMLSpanElement | undefined
  const popover = createAnchoredPopover({
    anchor: () => triggerOf(anchorRef),
    placement: () => props.placement ?? 'bottom-start',
    minWidth: props.minWidth,
    disabled: () => !!props.disabled,
    onDismiss: () => props.onDismiss?.(),
  })

  return (
    <>
      <span class="ui-popover-anchor" ref={anchorRef}>
        {props.trigger({ open: popover.open, toggle: popover.toggle })}
      </span>
      <Show when={popover.open()}>
        <Portal>
          <div
            ref={(el) => popover.setSurface(el)}
            class={cx('ui-popover', props.class)}
            role={props.role}
            aria-label={props.ariaLabel}
            style={popover.surfaceStyle()}
          >
            {typeof props.children === 'function' ? props.children({ close: popover.close }) : props.children}
          </div>
        </Portal>
      </Show>
    </>
  )
}
