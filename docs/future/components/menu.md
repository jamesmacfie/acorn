# Menu

A dropdown/context menu: a Popover whose content is a list of actions with menu semantics
(`role="menu"`, arrow-key traversal, Escape, close-on-select). shadcn has DropdownMenu and
ContextMenu; Bootstrap has Dropdowns. acorn has four hand-rolled menus, none of which has the full
behaviour set, and one of which (terminal) has almost none of it.

## Today

- `packages/client-core/src/AccountMenu.tsx:47-70` — `.account-menu-popover[role=menu]` +
  `button.account-menu-item` rows (`topbar.css:210-263`); own outside-click; no arrow keys.
- `packages/client-core/src/tabs/TabRail.tsx:356-377` — `.tabrail-menu` with title rows + three
  action buttons (`tabrail.css:107-145`); **no outside-click, no Escape, no roles**.
- `packages/client-core/src/notifications/NotificationBell.tsx:43-129` — `.notify-popover`; own
  outside-click; it's half menu, half inbox panel.
- `plugins/terminal/src/client/TerminalPanel.tsx:275-301` — `.terminal-menu` + backdrop div; no
  portal (overflow-clippable), no Escape, no `role="menu"`, disabled items with a trailing hint
  span (`.terminal-menu-missing`).
- Near-misses that should stay what they are: `Picker` (a listbox with a filter, not a menu) and
  the agents session-actions `Picker` usage (`AgentPane.tsx:313` — currently a Picker pressed into
  menu duty; a real Menu is the better fit).

## Proposed API

```tsx
export function Menu(props: {
  trigger: (open: () => boolean, toggle: () => void) => JSX.Element
  placement?: 'bottom-start' | 'bottom-end' | 'right-start'
  ariaLabel: string
  class?: string
  children: JSX.Element              // MenuItem / MenuSeparator / MenuLabel
})

Menu.Item = (props: {
  onSelect: () => void
  disabled?: boolean
  tone?: 'neutral' | 'danger'        // TabRail's "Archive" / terminal's destructive rows
  leading?: JSX.Element              // Icon slot
  trailing?: JSX.Element             // kbd hint or terminal's "missing" note
  children: JSX.Element
})
Menu.Separator = () => …
Menu.Label = (props: { children: JSX.Element }) => …   // TabRail's title rows
```

## How to build it

- Built on [Popover](./popover.md)'s `createAnchoredPopover` — Menu adds only semantics: roving
  focus via `createListNavigation` (`packages/client-core/src/ui/focus.ts`), `role="menu"`/
  `role="menuitem"`, Home/End, close-on-select, focus-return-to-trigger.
- `packages/client-core/src/ui/Menu.tsx`; `.ui-menu` / `.ui-menu-item` in `styles/primitives.css`
  with `data-tone`; reuse `Row`'s leading/trailing gap tokens so menus and rows read as one family.
- Export from `@acorn/plugin-api/ui` (frame-safe; terminal is a shell plugin but http/database
  frames will want menus eventually).
- Context-menu (right-click) positioning is the same hook anchored to a point instead of a rect —
  add a `anchorPoint` option only when a real consumer appears (TabRail's is a button-triggered
  menu today, not a true context menu).

## Refactors

- `TabRail.tsx` task menu — biggest behavioural win (gains Escape + outside-click it currently
  lacks); its title rows become `Menu.Label`.
- `AccountMenu.tsx` — near-mechanical port; delete `.account-menu-*` CSS.
- terminal's profile menu — gains portal/Escape/ARIA; `.terminal-menu-missing` becomes
  `Menu.Item trailing`.
- agents `AgentPane.tsx:313` session-actions Picker → Menu (a filter input over five actions is
  the wrong affordance anyway).
- `NotificationBell` — port the *chrome* (trigger + anchored surface) to Popover; the inbox content
  is not menu items, so it should NOT become a Menu. Judge after Popover lands.

## Notes

- Keep Menu.Item as buttons, not `Row` — `primitives.tsx:4-7` warns against forcing every
  clickable through one component; menus are their own semantics.
