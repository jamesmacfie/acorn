import { createSignal, Show, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createAnchoredPopover, type Placement } from './anchor'
import { cx } from './cx'
import { nextListIndex } from './focus'

// A dropdown menu: Popover plus menu semantics. Four hand-rolled menus existed and none had the
// full behaviour set — TabRail's task menu had neither outside-click nor Escape nor roles, and
// terminal's had no portal at all, so any overflow ancestor clipped it.
//
// What Menu adds over Popover: role="menu"/"menuitem", arrow-key roving with Home/End,
// close-on-select, and focus returning to the trigger on dismiss (a menu that drops focus on the
// body leaves a keyboard user at the top of the document).
//
// Items are buttons, not Rows. primitives.tsx warns against forcing every clickable through one
// component, and menus are their own semantics.
//
// Right-click positioning is the same hook anchored to a point rather than a rect. No consumer wants
// that yet — every current menu is button-triggered — so the option is not here.

type MenuContext = { close: () => void; register: (element: HTMLElement | undefined) => void }

// A `display: contents` wrapper has no box of its own, so getBoundingClientRect on it returns an
// empty rect. Measure the trigger the wrapper contains instead — that is the element the surface is
// meant to be anchored to anyway.
const triggerOf = (wrapper: HTMLElement | undefined): HTMLElement | undefined =>
  (wrapper?.firstElementChild as HTMLElement | null) ?? wrapper


export function Menu(props: {
  trigger: (state: { open: () => boolean; toggle: () => void }) => JSX.Element
  placement?: Placement
  ariaLabel: string
  /** Controlled visibility. Supply both when the surrounding component already owns which menu is
   *  open — see createAnchoredPopover's note. */
  open?: () => boolean
  onOpenChange?: (open: boolean) => void
  class?: string
  children: (context: MenuContext) => JSX.Element
}) {
  let anchorRef: HTMLSpanElement | undefined
  const [active, setActive] = createSignal(0)

  const popover = createAnchoredPopover({
    anchor: () => triggerOf(anchorRef),
    placement: () => props.placement ?? 'bottom-start',
    ...(props.open ? { open: props.open } : {}),
    ...(props.onOpenChange ? { onOpenChange: props.onOpenChange } : {}),
    onDismiss: () => {
      setActive(0)
      // Focus goes back where it came from. Without this, dismissing leaves the document body
      // focused and the next Tab starts from the top of the page.
      anchorRef?.querySelector<HTMLElement>('button, [tabindex]')?.focus()
    },
  })

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

  return (
    <>
      <span class="ui-popover-anchor" ref={anchorRef}>
        {props.trigger({
          open: popover.open,
          toggle: () => {
            const opening = !popover.open()
            popover.toggle()
            if (opening) queueMicrotask(() => focusAt(0))
          },
        })}
      </span>
      <Show when={popover.open()}>
        <Portal>
          <div
            ref={(el) => popover.setSurface(el)}
            class={cx('ui-popover ui-menu', props.class)}
            role="menu"
            aria-label={props.ariaLabel}
            style={popover.surfaceStyle()}
            onKeyDown={(event) => {
              const list = enabled()
              if (!list.length) return
              const next = nextListIndex(active(), list.length, event.key)
              if (next === active() && event.key !== 'Home' && event.key !== 'End') return
              event.preventDefault()
              focusAt(next)
            }}
          >
            {props.children({ close: popover.close, register })}
          </div>
        </Portal>
      </Show>
    </>
  )
}

/** One action. `onSelect` fires and the menu closes — a menu item that leaves the menu open is
 *  almost always a checkbox in disguise, and none exist here yet. */
Menu.Item = (props: {
  context: MenuContext
  onSelect: () => void
  disabled?: boolean
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
      props.context.close()
      props.onSelect()
    }}
  >
    <Show when={props.leading}><span class="ui-menu-leading">{props.leading}</span></Show>
    <span class="ui-menu-label">{props.children}</span>
    <Show when={props.trailing}><span class="ui-menu-trailing">{props.trailing}</span></Show>
  </button>
)

/** A non-interactive heading row — TabRail's menu opened with two of these naming the task. */
Menu.Label = (props: { class?: string; children: JSX.Element }) => (
  <div class={cx('ui-menu-label-row', props.class)} role="presentation">{props.children}</div>
)

Menu.Separator = () => <div class="ui-menu-separator" role="separator" />
