import { createEffect, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createDomCollection } from '../keys/collection'
import { restoreFocusOnCleanup, trapTab } from '../keys/trap'
import { createAnchoredPopover, type AnchoredPopover, type Placement } from './anchor'

// A dropdown menu: Popover plus menu semantics. See docs/ui-design.md § Menus and right-click for
// why this replaced four earlier implementations and how ContextMenu below reuses the same surface.

export type MenuContext = { close: () => void; register: (element: HTMLElement | undefined) => void }

// A `display: contents` wrapper has no box of its own, so getBoundingClientRect on it returns an
// empty rect. Measure the trigger the wrapper contains instead; that is the element the surface is
// meant to be anchored to anyway.
const triggerOf = (wrapper: HTMLElement | undefined): HTMLElement | undefined =>
  (wrapper?.firstElementChild as HTMLElement | null) ?? wrapper


/** The menu itself: portal, `role="menu"`, roving focus, and first-item focus on open. Mounted only
 *  while the popover is open, which keeps the item list from growing a copy of every item on each
 *  re-open.
 *
 *  A DOM collection (../keys/collection.ts): the items are the caller's JSX, so the host cannot key
 *  them, but it can read them out of the DOM when a key arrives. The `register` callback stays on the
 *  context because `Menu.Item` is a public shape, and it now records nothing. */
function MenuSurface(props: {
  popover: AnchoredPopover
  ariaLabel: string
  children: (context: MenuContext) => JSX.Element
}) {
  // See docs/ui-design.md § Menus and right-click for why this focuses the first item on mount, and
  // ../keys/trap.ts for the restore that goes with a trap.
  const collection = createDomCollection({ selector: '.ui-menu-item', focusOnMount: true })
  restoreFocusOnCleanup()

  return (
    <Portal>
      <div
        ref={(el) => {
          props.popover.setSurface(el)
          collection.attach(el)
        }}
        class="ui-popover ui-menu"
        role="menu"
        aria-label={props.ariaLabel}
        style={props.popover.surfaceStyle()}
        onKeyDown={(event) => trapTab(event, event.currentTarget)}
      >
        {props.children({ close: props.popover.close, register: () => {} })}
      </div>
    </Portal>
  )
}

export function Menu(props: {
  trigger: (state: { open: () => boolean; toggle: () => void }) => JSX.Element
  placement?: Placement
  ariaLabel: string
  /** Controlled visibility. Supply both when the surrounding component already owns which menu is
   *  open; see createAnchoredPopover's note. */
  open?: () => boolean
  onOpenChange?: (open: boolean) => void
  children: (context: MenuContext) => JSX.Element
}) {
  let anchorRef: HTMLSpanElement | undefined

  const popover = createAnchoredPopover({
    anchor: () => triggerOf(anchorRef),
    placement: () => props.placement ?? 'bottom-start',
    ...(props.open ? { open: props.open } : {}),
    ...(props.onOpenChange ? { onOpenChange: props.onOpenChange } : {}),
    // Focus goes back where it came from. Without this, dismissing leaves the document body focused
    // and the next Tab starts from the top of the page.
    onDismiss: () => anchorRef?.querySelector<HTMLElement>('button, [tabindex]')?.focus(),
  })

  return (
    <>
      <span class="ui-popover-anchor" ref={anchorRef}>
        {props.trigger({ open: popover.open, toggle: popover.toggle })}
      </span>
      <Show when={popover.open()}>
        <MenuSurface popover={popover} ariaLabel={props.ariaLabel} >
          {props.children}
        </MenuSurface>
      </Show>
    </>
  )
}

/**
 * The same menu, opened at a point instead of under a trigger. See docs/ui-design.md
 * § Menus and right-click for why visibility is the caller's state and why this is keyed on `at`.
 */
export function ContextMenu(props: {
  at: () => { x: number; y: number } | null
  ariaLabel: string
  onClose: () => void
  /** The element focus returns to on dismiss: normally the row that was right-clicked. */
  returnFocus?: () => HTMLElement | undefined
  children: (context: MenuContext) => JSX.Element
}) {
  const popover = createAnchoredPopover({
    anchor: () => props.at() ?? undefined,
    clamp: true,
    onDismiss: () => {
      props.onClose()
      props.returnFocus?.()?.focus()
    },
  })
  // `show()` rather than a controlled `open`, because show is what measures: a controlled popover that
  // was never shown renders at 0,0 for a frame.
  createEffect(() => {
    if (props.at()) popover.show()
  })

  return (
    <Show keyed when={props.at()}>
      {(_at) => (
        <MenuSurface popover={popover} ariaLabel={props.ariaLabel} >
          {props.children}
        </MenuSurface>
      )}
    </Show>
  )
}

/** One action. `onSelect` fires and the menu closes; an item that leaves it open is usually a
 *  checkbox in disguise. See docs/ui-design.md § Menus and right-click for `closeOnSelect`. */
Menu.Item = (props: {
  context: MenuContext
  onSelect: () => void
  disabled?: boolean
  /** Default true. */
  closeOnSelect?: boolean
  tone?: 'neutral' | 'danger'
  leading?: JSX.Element
  trailing?: JSX.Element
  title?: string
  children: JSX.Element
}) => (
  <button
    type="button"
    ref={(el) => props.context.register(el)}
    class="ui-menu-item"
    role="menuitem"
    data-tone={props.tone ?? 'neutral'}
    disabled={props.disabled}
    title={props.title}
    onClick={() => {
      if (props.closeOnSelect !== false) props.context.close()
      props.onSelect()
    }}
  >
    <Show when={props.leading}><span class="ui-menu-leading">{props.leading}</span></Show>
    <span class="ui-menu-label">{props.children}</span>
    <Show when={props.trailing}><span class="ui-menu-trailing">{props.trailing}</span></Show>
  </button>
)

/** A non-interactive heading row. */
Menu.Label = (props: { children: JSX.Element }) => (
  <div class="ui-menu-label-row" role="presentation">{props.children}</div>
)

Menu.Separator = () => <div class="ui-menu-separator" role="separator" />
