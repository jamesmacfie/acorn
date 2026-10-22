# Narrow mode and narrow layouts on a phone

This page covers how the [mobile web app](../mobile.md) turns client-core's narrow mode on, how it handles
the on-screen keyboard, and how each host layout draws on a phone. Read it before you change a layout's
phone projection or the phone's bars.

## Narrow mode

`index.html` sets `data-form-factor="narrow"` on `<html>`, so the attribute holds before the first
paint. Client-core does the rest, and no plugin changes
([the narrow sheet](../ui-design/tokens.md#the-narrow-sheet)):

- Controls and rows take touch sizes, and text inputs draw at 16px so iOS Safari doesn't zoom into them.
- Controls that appear on hover are always shown.
- `startClientRuntime` installs `installLongPressMenu`, which sends the `contextmenu` event a
  right-click sends after a finger rests for half a second. iOS sends none of its own, and Android's
  is dropped when ours arrived first, so a menu opens once.
- A pane that lists only `desktop` in its `formFactor`, such as Preview, isn't offered
  ([form factor](../panes/contributions.md#form-factor)).
- The rail data a plugin's tree reads carries `formFactor: 'narrow'`.

The phone's own bars are sized in `mobile.css`.

### The keyboard

A phone's browser keeps the page the same size when the on-screen keyboard opens and shrinks only the
visual viewport. `trackKeyboardInset` measures the difference and keeps `--keyboard-inset` and
`data-keyboard` on `<html>`. The shell's height subtracts the inset, a dialog sheet ends above it, and
the bar of panes is hidden while it's up, so the pane gets every line. A pane reads no window and is
only given less room. To check it in Playwright, replace `window.visualViewport` with an event target in
an init script, set its `height`, and dispatch `resize`.

## Narrow layouts

Each host layout draws a phone projection from the same component it draws the desktop with, choosing
by `formFactor()` once per mount ([pane layouts](../panes/layout.md#named-layouts)):

- `list-detail` and the kit's `ListDetail` show one column at a time. A pane's `selection` shows the
  detail, the top bar's **Back** returns to the list, and **Show detail** goes forward again
  ([narrow `list-detail`](../panes/layout.md#narrow-list-detail)).
- `document-over-frame`, `frame-beside-document`, and `stack-split` fill the pane with their first
  region. **Show panel** opens the second in a full-screen `Drawer`.
- On a phone every `Drawer` is a sheet over the whole screen, because there are no rails or task footer
  to sit between.
- `single`, `header-body-footer`, `wizard`, and `tabs` don't change. The tab strip already scrolls
  sideways.
