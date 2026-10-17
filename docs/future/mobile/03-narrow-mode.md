# Phase 3: turn on a narrow mode from the root element

Date: October 17, 2026. Status: proposed. Check it in the [phase 2](./02-shell.md) shell. Can run
beside [phase 4](./04-narrow-layouts.md).

## Goal

The mobile shell puts `data-form-factor="narrow"` on `<html>` before the first paint. That one
attribute gives every control a touch-sized target. Controls that only appear on hover show on a
touch screen. Every part of client-core and every plugin can read which form factor it's drawing in.
A pane that only works wide can say so, and the phone hides it.

## Starting point

- Style packs set size and spacing values under `:root[data-style='…']`, as
  `packages/client-core/src/infra/styles/style-cozy.css` does. The defaults are in
  `packages/client-core/src/infra/styles/tokens-style.css`, with `--control-h` at 32px and
  `--row-h-sm` small enough for a mouse.
- Five controls appear only on hover: the chip's remove button, a row's trailing actions, a table
  row's actions, a document tab's close button, and a dashboard tile's resize handle. Their rules are
  in `packages/client-core/src/infra/styles/primitives.css` and
  `packages/client-core/src/features/dashboards/dashboards.css`.
- Right-click opens menus in `Row`, `Table`, `DocumentTabs`, `PickerRow`, `TabRail`, and
  `SelectionActions`. Android fires `contextmenu` on a long press. iOS Safari doesn't.
- Two stylesheets read the viewport width, against the layout rule: `settings.css` at 900px and
  `dashboards.css` at 1,100px.
- The form factor has two spellings. The manifest accepts `'desktop' | 'mobile'`
  (`packages/protocol/src/plugin/manifest/surfaces.ts`). The rail data a plugin's tree reads says
  `'desktop' | 'narrow' | 'tui'` (`packages/protocol/src/chrome/surfaces.ts`), and
  `packages/client-core/src/features/tabs/TabRail.tsx` always sends `'desktop'`.
- Only loaded frame surfaces declare a form factor. A built-in pane has no field for it, and
  `packages/client-core/src/host/frames/register.ts` skips any surface that leaves out `'desktop'`.

## The design

### Read the form factor

Client-core reads the attribute once at boot into `formFactor()`, which answers `'desktop'`,
`'narrow'`, or `'tui'`. The terminal client has no root element, so it supplies `'tui'` through its
host switch. Nothing measures the window. The desktop never sets the attribute, so it reads
`'desktop'`.

Pick `narrow` as the one word, because the layout docs and the rail data use it. The manifest keeps
`'mobile'` as an accepted spelling and reads it as `'narrow'`, so a published manifest stays valid
([versioning](../../api-reference/versioning.md)). The plugin API surface snapshot changes, so update it
in the same change.

`TabRail` and every other place that builds chrome data sends `formFactor()`.

### Let a pane say where it works

`PaneCommon` in `packages/client-core/src/host/registries/panes/panes.ts` gains `formFactor`, the
same field the manifest has. A built-in pane defaults to both form factors, because it draws with the
kit. Preview declares `['desktop']`, because it needs a native web view. The registry leaves out a
pane that doesn't list the host's form factor, the same way it leaves out a pane whose availability
route says no. `register.ts` checks the host's form factor instead of `'desktop'`.

### Set touch sizes

A stylesheet in `packages/client-core/src/infra/styles` holds one block for
`:root[data-form-factor='narrow']`:

- `--control-h` 44px, `--control-h-sm` 36px, and `--control-h-xs` 32px, so a tap target meets the
  44-point guideline on iOS.
- Row heights to match, and less pane padding.
- A 16px font size for text inputs, because iOS Safari zooms the page into any smaller input.

The block loads after the style packs, so it wins for sizes in every pack. A case in
`packages/client-core/src/infra/styles/tokenAxes.test.ts` pins that order.

### Show hover-only controls on touch

A `@media (hover: none)` rule shows the five controls listed above at all times. It doesn't depend on
the attribute, so it also helps a touch-screen laptop.

### Open menus with a long press

A small helper in the kit calls a component's menu handler after a 500 ms press that doesn't move.
The six components that handle `contextmenu` use it. A long press on Android doesn't open the menu
twice.

### Remove the two viewport reads

`settings.css` and `dashboards.css` use container queries on their own element instead of
`@media (max-width)`.

## Acceptance

- Unit tests cover `formFactor()`, the manifest's alias, the pane filter, and the token order.
- In the phase 2 shell, Preview is gone from the pane bar, and every control in every built-in pane
  measures at least 44px tall in a screenshot.
- The desktop draws as before: its layout and kit tests pass unchanged, and a `pnpm dev:agent`
  screenshot of a task matches one taken before the change.
