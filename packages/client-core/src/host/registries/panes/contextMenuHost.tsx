import { createEffect, For, onCleanup, Show } from 'solid-js'
import Icon from '../../../kit/components/content/Icon'
import { ContextMenu, Menu, type MenuContext } from '../../../kit/components/overlays/Menu'
import {
  contextMenuItems,
  runContextMenuItem,
  type ContextMenuLocation,
  type ContextMenuTarget,
} from './contextMenus'

// The two hosts for the context-menu registry. The registry, the location vocabulary and the `when`
// evaluation live in ./contextMenus.ts, JSX-free (docs/frontend/registries.md § Registries and plugins). What is
// here is a `<For>` and an anchor, kept as little as the job allows, because it is the half
// only a person looking at the running app can check.

/** The registry's rows for one target, as menu items. Rendered inside whatever menu is open, the
 *  button-triggered one the tab rail already had, and the right-click one below (docs/plugins.md §
 *  Context menus, "two doors, one list"). */
export function ContextMenuItems(props: {
  context: MenuContext
  location: ContextMenuLocation
  target: ContextMenuTarget
}) {
  const items = () => contextMenuItems(props.location, props.target)
  // A destructive item sits below a rule, apart from the safe ones (docs/ui-design/interaction.md § Menus and
  // right-click). Registered rows have no groups, so the rule goes before the first danger row.
  const firstDanger = () => items().findIndex((item) => item.tone === 'danger')
  return (
    <For each={items()}>
      {(item, index) => (
        <>
        <Show when={index() > 0 && index() === firstDanger()}><Menu.Separator /></Show>
        <Menu.Item
          context={props.context}
          tone={item.tone ?? 'neutral'}
          leading={<Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>}
          onSelect={() => runContextMenuItem(item, props.target)}
        >
          {item.label}
        </Menu.Item>
        </>
      )}
    </For>
  )
}

/** What a right-click opened: where the pointer was, and what was under it. Held by the surface that
 *  owns the rows, one menu per list, not one per row. */
export type ContextMenuOpening = { at: { x: number; y: number }; target: ContextMenuTarget }

let activeClose: (() => void) | undefined

/**
 * The right-click door. One of these per list, driven by a signal the list owns.
 *
 * Keyboard reachability is not an extra here, it is the same code: `contextmenu` is what the platform
 * dispatches for Shift+F10 and the menu key as well as for the right button, so a handler that sets
 * `at` from the event's coordinates serves both. The surface itself focuses its first item on mount,
 * takes arrow keys, closes on Escape, and returns focus to `returnFocus`, all of it from
 * `MenuSurface`, shared with the button-triggered menu rather than reimplemented.
 */
export function ContextMenuHost(props: {
  location: ContextMenuLocation
  ariaLabel: string
  opening: () => ContextMenuOpening | null
  onClose: () => void
  returnFocus?: () => HTMLElement | undefined
}) {
  const close = () => props.onClose()
  createEffect(() => {
    if (props.opening()) {
      if (activeClose && activeClose !== close) activeClose()
      activeClose = close
    } else if (activeClose === close) activeClose = undefined
  })
  onCleanup(() => { if (activeClose === close) activeClose = undefined })
  return (
    <ContextMenu
      at={() => props.opening()?.at ?? null}
      ariaLabel={props.ariaLabel}
      onClose={props.onClose}
      {...(props.returnFocus ? { returnFocus: props.returnFocus } : {})}
    >
      {(menu) => (
        <Show when={props.opening()}>
          {(opening) => <ContextMenuItems context={menu} location={props.location} target={opening().target} />}
        </Show>
      )}
    </ContextMenu>
  )
}
