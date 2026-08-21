import { createEffect, createSignal, onMount, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover, type AnchoredPopover, type Placement } from './anchor'
import { cx } from './cx'
import { nextListIndex } from './focus'

// A dropdown menu: Popover plus menu semantics. See docs/ui-design.md § Menus and right-click for
// why this replaced four earlier implementations and how ContextMenu below reuses the same surface.

export type MenuContext = { close: () => void; register: (element: HTMLElement | undefined) => void }

// A `display: contents` wrapper has no box of its own, so getBoundingClientRect on it returns an
// empty rect. Measure the trigger the wrapper contains instead; that is the element the surface is
// meant to be anchored to anyway.
const triggerOf = (wrapper: HTMLElement | undefined): HTMLElement | undefined =>
  (wrapper?.firstElementChild as HTMLElement | null) ?? wrapper


/** The menu itself: portal, `role="menu"`, roving focus, and first-item focus on open. Mounted only
 *  while the popover is open, which also keeps the registered-item list honest. It used to live for
 *  the lifetime of the Menu and grew by one copy of every item on each re-open. */
function MenuSurface(props: {
  popover: AnchoredPopover
  ariaLabel: string
  class?: string
  children: (context: MenuContext) => JSX.Element
}) {
  const [active, setActive] = createSignal(0)
  // Items register themselves as they mount so roving does not need a parallel model of the list.
  const items: HTMLElement[] = []
  const register = (element: HTMLElement | undefined) => {
    if (element) items.push(element)
  }
  const enabled = () => items.filter((item) => !item.hasAttribute('disabled'))

  const focusAt = (index: number) => {
    const list = enabled()
    if (!list.length) return
    setActive(index)
    list[index]?.focus()
  }

  // See docs/ui-design.md § Menus and right-click for why this focuses the first item on mount.
  onMount(() => queueMicrotask(() => focusAt(0)))

  return (
    <Portal>
      <div
        ref={(el) => props.popover.setSurface(el)}
        class={cx('ui-popover ui-menu', props.class)}
        role="menu"
        aria-label={props.ariaLabel}
        style={props.popover.surfaceStyle()}
        onKeyDown={(event) => {
          const list = enabled()
          if (!list.length) return
          const next = nextListIndex(active(), list.length, event.key)
          if (next === active() && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          focusAt(next)
        }}
      >
        {props.children({ close: props.popover.close, register })}
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
  class?: string
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
        <MenuSurface popover={popover} ariaLabel={props.ariaLabel} class={props.class}>
          {props.children}
        </MenuSurface>
      </Show>
    </>
  )
}

/**
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
  class?: string
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
        <MenuSurface popover={popover} ariaLabel={props.ariaLabel} class={props.class}>
          {props.children}
        </MenuSurface>
      )}
    </Show>
  )
}

/** One action. `onSelect` fires and the menu closes; a menu item that leaves the menu open is
 *  almost always a checkbox in disguise. See docs/ui-design.md § Menus and right-click for the
 *  `closeOnSelect` exception. */
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
  class?: string
  children: JSX.Element
}) => (
  <button
    type="button"
    ref={(el) => props.context.register(el)}
    class={cx('ui-menu-item', props.class)}
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

/** A non-interactive heading row: TabRail's menu opened with two of these naming the task. */
Menu.Label = (props: { class?: string; children: JSX.Element }) => (
  <div class={cx('ui-menu-label-row', props.class)} role="presentation">{props.children}</div>
)

Menu.Separator = () => <div class="ui-menu-separator" role="separator" />
