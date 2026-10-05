# Chrome, overlays, and dialogs

This page covers floating host UI, the bottom drawer, toasts, dialogs, and drag-to-resize. Read it
before you add a dialog, a popover, or a resizable split. It's part of [UI design](../ui-design.md).

## Chrome and overlays

Host floating UI uses body-level portals, so it can draw above native pages through
[native overlays](../native-overlays.md). The kit keeps its CSS stacking, anchoring, props, and
action ownership, and imports no native commands. Custom host floating markup uses a body portal and
an inventoried class or `data-host-overlay` attribute. UI inside a plugin iframe stays inside that
frame.

Dialog focus containment includes anchored menus and pickers opened from the dialog. Escape dismisses
the top anchored interaction once. While a dialog covers a native page, the host isolates background
DOM and the shell removes the page from native accessibility navigation. Passive tooltips let the
pointer through. A press on a native page notifies the host, and AppKit delivers the original event to
the page.

A loaded plugin's `overlay` frame gets an explicit height from the host, not a `max-height`, because
the iframe inside is 100% of its container, and a container sized by its content would size to
nothing. A `refPanel` frame takes the drawer column's remaining space, not `height: 100%`, which would
overflow past the header.

### Full-window layers

Settings (`features/settings/SettingsView.tsx`) and the panel studio
(`features/dashboards/studio/PanelStudio.tsx`) are full-window layers, not routes. Each renders in a
body portal at `--z-modal` with `position: fixed; inset: 0`, and is `role="dialog"` and
`aria-modal="true"`. A route would unmount the task's panes, plugin frames, and terminal drawer
behind it, so the layer covers them instead. While either is open, the shell stands the task's
keybindings down through `taskActive` in `apps/desktop/src/client/App.tsx`. Focus that lands behind
the layer returns into it, **Escape** closes it when nothing inside is open, and focus goes back to
the control that opened it. Menus, select lists, and dialogs opened inside it portal to the body and
paint above it. The studio's AI conversation docks in a column inside the layer, in place of the
inspector, rather than opening a dialog over it.

### The drawer

`Drawer` is the app's one bottom dock. It's a host component, not a kit node, because where the rails
are and how tall the top bar is belong to the shell, and its height is a pixel from the resize grip.
Plugins reach it through `@acorn/plugin-api/ui/host`, beside `PaletteSurface`. The terminal plugin is
its only caller. Nothing behind it goes inert, there's no backdrop, and Escape doesn't close it,
because a drawer is a second place to work.

### Toasts

The toast stack sits at the top right in every view, under the top bar and one pane header's height,
and clear of the right rail. Panes keep primary controls at the bottom right, such as the agent
composer's **Send**, so a toast at the top covers only content you can read past. The stack ignores
pointer events, and each toast takes its own back. A toast's dismiss is `IconButton icon="x"`.
A toast can carry one action, such as **Edit…** after a panel is duplicated. The action is a
shortcut, so ignoring it must be fine. Pressing it dismisses the toast.

### Floating surface tokens

Every floating surface reads `--popover-bg`, `--surface-border`, and `--radius-popover`. A dialog lifts
with `--elev-modal`, and a menu, picker, tip, toast, or mention list with `--elev-popover`, so a style
pack can raise one without the other. The dialog backdrop reads `--scrim-filter`, which is how the
Modern and Cute packs blur the page.

## Dialogs

A dialog's title looks like a detail pane's: `--fs-lg` at `--heading-weight` in `--text`, sentence
case, in a bar as tall as a pane header, with the chrome divider under it. `Modal` names the dialog by
its title. It draws a close button, `IconButton icon="x"`, at the end of the title bar, unless
`dismissOn` is empty, which is how a flow that must be finished, such as onboarding, says it can't be
left. `Modal.Actions` has the pane padding all around and the chrome divider above, and the wizard's
footer matches it.

Every dialog has the same shape, so the button you came to press is always in the same place:

1. It's a `Modal` at one of four widths: `sm` 420, `md` 560, `lg` 720, or `wide` 820. The command
   palette is the exception, because it's a search box with a list.
2. The title is the only title. Nothing in the body repeats it.
3. The footer is `Modal.Actions`, in this order: any extra or destructive secondary action, a
   `Toolbar.Spacer`, **Cancel** as `ghost`, then one `solid` primary named for what it does. Say
   **Close** when there's nothing to cancel. The primary takes `tone="danger"` when it destroys
   something.
4. Every footer button is the default size, `md`.
5. The footer holds no hint text. A line that helps you decide goes in the body.

A step-by-step flow and a settings form follow their own rules ([frontend](../frontend/settings-pages.md) § Forms
and flows).

A dialog moves focus inside when it opens and gives it back to its opener when it closes. With no
`autoFocus`, focus goes to the first control in `Modal.Body`. An `alertdialog` starts on its first
footer button that isn't `solid`, which is **Cancel**, so Enter doesn't confirm by accident. A dialog
with neither takes focus itself. A child that took focus first, such as the wizard's step body, keeps
it.

A `Popover` that holds content heads itself with `SectionHeader level="group"`. There's no `Popover
title` prop, because the notification bell has two headings.

The command palette and the file finder share one surface, `PaletteSurface`.

### Dismissal

`kit/lib/controls/dismissable.ts` handles Escape, backdrop clicks, and Tab containment. It's a hook
that returns handlers, and the markup stays at the call site. `Modal` uses it. The `Drawer` doesn't,
because it isn't modal.

Escape is handled twice: on the dialog element, and on the document. The element handler fires only
while focus is inside, and focus drops to the body when the focused child unmounts. The document
handler answers for the topmost dialog still in the page, so a stack closes one press at a time, and
it stands down when the element handler already took the key. The overlay palettes, the command
palette, file finder, and workspace switcher, use `createOverlayPalette`, which owns their dismissal,
focus restore, and one-overlay-at-a-time rule.

## Drag-to-resize

`createSplitDrag` in `kit/lib/layout/split.ts` is behind the pane row divider, the terminal drawer's
height handle, and the splits the host layouts draw. A plugin never calls it: between two regions the
layout owns the handle ([pane layouts](../panes/layout.md#layout-model)), and inside one region the
`ListDetail` and `SplitHandle` nodes call it.

It reports a pixel delta, not a value, because the pane row resizes two panes against each other, the
drawer owns one height, and the document surface owns a fraction. It owns pointer capture,
`requestAnimationFrame` batching, text-selection suppression during the drag, and `role="separator"`
with arrow, Home, and End keys. The caller persists the result, because only the caller knows what it
is.

A drag clamps against the element it resizes, never `window.innerWidth`, so a mobile shell can set its
own breakpoints.

Cleanup runs on unmount, so a drag can't outlive its component. Cleanup removes
`document.body.style.userSelect` instead of restoring a snapshot, because a snapshot taken during a
stuck drag would keep `none` forever. Both `pointerup` and `pointercancel` end a drag, because an
interrupted gesture fires only `pointercancel`, and missing it once left the document unselectable.
