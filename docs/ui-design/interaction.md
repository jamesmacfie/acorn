# Interaction rules and menus

This page covers the keyboard rules every view follows, the menu surface, right-click menus, row
actions, and confirmation. Read it before you add a menu or a row action. It's part of
[UI design](../ui-design.md).

## Interaction rules

Each rule is a layer over the keymap, not a handler somewhere.
[Focus and typing](../command-palette-and-shortcuts/focus-and-typing.md) owns the engine, the intents,
and the layer priorities.

- `⌘K` opens the command palette.
- `⌘1` to `⌘9` activates the matching visible task, unless a `tabs` pane has focus, where the same
  chords pick that pane's tabs.
- `⌘⇧T` toggles the terminal drawer, `⌘⇧N` creates a task, `⌘P` opens the file finder, and `⌘/` shows
  what the keyboard does here.
- F6 and Shift+F6 move between a pane's regions. Ctrl+Option+Left and Ctrl+Option+Right move between
  panes.
- Pane chords belong to their contributions, and Settings → Keyboard shortcuts can override them.
- Text fields, editors, terminals, and `contenteditable` elements stop global shortcuts unless the
  action is text-safe. That's a property of the intent: `dismiss`, `commit`, and the four region and
  pane moves reach a focused composer, and nothing else does.
- A node handles intents and never reads a key code. `Input`, `Textarea`, `Composer`, and the inside
  of a rectangle are the only places a plugin sees a key event.
- Destructive actions and approvals use shell-owned confirmation chrome.

## Menus and right-click

There's one menu. `kit/components/overlays/Menu.tsx` owns the surface: `role="menu"` and `menuitem`,
closing on select, Escape, outside clicks, and returning focus. Both ways of opening it mount the same
`MenuSurface` over the same hook, `kit/lib/controls/anchor.ts`. Its roving focus comes from the
collection intents, so the arrows, Home, End, the page keys, and `j` and `k` work as in any list. A
button anchors it to a rectangle, and a right-click anchors it to a point. That's the only difference.

Right-click is never the only way in. The rows come from the context-menu registry
(`packages/client-core/src/host/registries/panes/contextMenus.ts`), and the button menu on the same
row draws the same list. `contextmenu` also fires for Shift+F10 and the menu key, and the surface
focuses its first item on mount, so the menu works from the keyboard at once.

Every anchored surface stays in the viewport. An element-anchored surface flips above, below, or to
the other side when its side has less room, then clamps what's left over. A point-anchored menu only
clamps, because there's no trigger to flip around.

The desktop's source and pane rail icons use the point-anchored surface. From the keyboard, a focused
icon uses its bounding rectangle when the platform reports (0, 0), so Shift+F10 opens the menu beside
the icon. The native overlay inventory recognizes `.ui-popover`, so these menus stay clickable over a
child webview. One host context menu is open at a time.

Surfaces nest. A `Select` inside a `Popover` puts its list in its own portal, so a press on that list
would look like a press outside the popover. `anchor.ts` keeps open surfaces in the order they opened,
and a surface closes only on a press outside itself and everything opened after it. It keeps the
collision logic in one pure helper and measures again on reflow, so menus, selects, pickers, and
popovers share one viewport rule.

The portal is why a pane that clips overflow doesn't cut a menu off. The menu renders through a portal
and is fixed to the trigger's rectangle. Inside a sandboxed plugin frame, the viewport is the frame.

A context-menu contribution is a label, an optional icon, an order, a check over the host-defined
target, and one action. Core's own rows, such as the tab rail's Pin, Unpin, Rename, and Archive, are
registrations too. Plugins declare the same shape in a manifest ([plugins](../plugins.md) § Context
menus), and the host binds the owner into the ID and evaluates the check itself.

An `AnchorTarget` can be a point, which is a zero-size rectangle, so `ContextMenu` reuses
`MenuSurface`. The caller holds visibility, and the surface remounts keyed on the `at` point, so
right-clicking a second row doesn't leave the first row's items on it.

### Menu items

Items are buttons, not `Row`s, because menus have their own semantics. `Menu.Item`'s `onSelect`
closes the menu, except with `closeOnSelect={false}`, for an item that toggles something and has to
show the new state.

Arm-to-confirm is `Menu.Item`'s own `confirm` prop. The item keeps its place, reads `Discard?` after
the first press, and calls `onSelect` on the second (`createArmedConfirm`,
`kit/lib/controls/confirm.ts`). A `ConfirmButton` among menu items would be the wrong height and
carry no `.ui-menu-item`, so the roving focus would skip it. Changes' **Discard** and **Force push**
are items.

A destructive item is `tone="danger"`, sits last, and has a `Menu.Separator` above it. It either arms
with `confirm="{Verb} {thing}?"` or opens a dialog, and then its label ends in "…", as **Archive
session…** does. `ContextMenuItems` draws the separator before the first danger row a registry
returns. A menu of actions on one thing gives every item a leading icon or none.

A menu that holds a choice says which is chosen. `Menu.Item` takes `kind="radio"` or
`kind="checkbox"`, with `checked`. The item reports as `menuitemradio` or `menuitemcheckbox` with
`aria-checked`, and draws a check mark before its label, or a blank as wide, so labels line up. A
checkbox item leaves the menu open. A menu is at least 10rem wide.

Every armed label, on a `ConfirmButton` or a `Menu.Item`, is "{Verb} {thing}?": **Delete note?**,
**Remove container?**, **Cancel run?**. The default, for a caller that names no prompt, is
**Confirm?**. An armed `ConfirmButton` keeps at least its resting width, so the bar doesn't move under
the pointer, and an icon button grows to hold its words.

### Row actions

`RowActions` is the button half of that shape: an ellipsis `Button` wrapping a `Menu`, placed
`bottom-end`, that stops the click so the row doesn't activate. Every list row that offers actions
uses it, so the control sits in the same corner in a plugin's list as in the shell's. It holds
**Create task** in the GitHub pull list and in the rail list every descriptor source draws. The agent
session sidebar keeps its stop, rename, and archive rows.

It carries its own reveal instead of using `Row`'s `reveal`. `Row` hides the whole trailing slot, but
a rail row also puts a badge there, and a badge that shows only on hover goes unread. So the CSS hangs
off `.ui-row-actions` and keys on the row's `:hover`, `:focus-within`, and `[data-selected]`, plus the
button's own `aria-expanded`. The last one matters, because the menu is in a portal, so the row loses
`:focus-within` while the menu is open.
