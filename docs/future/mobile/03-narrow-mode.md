# Phase 3: turn on a narrow mode from the root element

Date: October 17, 2026. Status: shipped October 21, 2026. Check it in the [phase 2](./02-shell.md)
shell. Can run beside [phase 4](./04-narrow-layouts.md).

## Completion note

Completed October 21, 2026. [Mobile web app](../../mobile/narrow-mode.md#narrow-mode) and
[the narrow sheet](../../ui-design/tokens.md#the-narrow-sheet) own the shipped behavior, and
[form factor](../../panes/contributions.md#form-factor) owns the pane field. This page keeps what the
later phases need.

### What landed

- `formFactor()` in `infra/platform`, answering `'desktop'`, `'narrow'`, or `'tui'`. `TabRail` sends
  it as the rail data's `formFactor`. `FormFactor` is a type in `@acorn/protocol/chrome.ts`.
- `PaneCommon.formFactor`. `paneAvailable` leaves out a pane that doesn't list the host's form
  factor, and Preview declares `['desktop']`. `register.ts` checks the host's form factor, and reads
  the manifest's `mobile` as `narrow`.
- `infra/styles/narrow.css`, loaded after the style packs, with a test that pins the order and that
  it sets style tokens only. `apps/mobile/index.html` sets the attribute on `<html>`.
- A new style token, `--fs-input`, which `.ui-input` and its filter and mono forms read. The narrow
  block sets it to 16px.
- `@media (hover: none)` rules for the hover-only controls, beside each hover rule.
- `installLongPressMenu` in `kit/lib/controls/longPressMenu.ts`, started by `startClientRuntime`
  when the form factor is narrow.
- `settings.css` and `dashboards.css` use container queries.
- Tests for `formFactor()`, the pane filter, the manifest alias, the token order, and the long press.

The acceptance checks passed in Chromium at 390 by 844 against a throwaway standalone Node. Preview is
absent from the pane bar. In Agent, Git, Notes, Context, and Editor, every button, input, and tab
measures 44px or more, apart from the exceptions listed below. A touch context (`hasTouch`, which
reports `hover: none`) shows the row actions and draws inputs at 16px. A long press made with
Chrome DevTools Protocol touch events opened the row's menu exactly once. Client-core, protocol,
plugin-api, mobile, Preview, and the architecture suites pass. The phone's startup budget went from
482,910 B to 484,239 B of scripts, and from 121,692 B to 122,302 B of styles.

The screenshots are in
`/Users/jamesmacfie/Source/acorn/apps/node/.acorn/worktrees/jamesmacfie-acorn-phase-3-narrow-mode/references/mobile-phase-3/`,
a folder git ignores. They aren't committed.

### Decisions and deviations

- **All three control heights are 44px.** This page proposed 44, 36, and 32px, but a 36px button
  fails its own acceptance check of 44px for every control. The small rungs now match. Rows are 48px,
  and `--row-h-sm` and `--tab-h` are 44px.
- **`--fs-input` is a new token.** The stylesheet ratchet forbids a literal font size, so the 16px
  needed a token. It defaults to `--fs-sm`, which is what inputs drew at before.
- **The long press is one listener, not six components.** `installLongPressMenu` sends the
  `contextmenu` event on the element under the finger, so every menu already wired to it opens,
  including `PaneSwitcher`, `DashboardTabs`, and the link preview. `PickerRow` has no handler of its
  own and draws a `Row`. Android's own `contextmenu` is dropped when ours came first, and ours is
  dropped when Android's came first. Letting go after a long press doesn't press the row.
- **`formFactor()` reads the attribute on every call.** It doesn't cache. The attribute never
  changes, the read is one property lookup, and a test sets it directly. A missing `document` means
  the terminal.
- **The manifest keeps `desktop` and `mobile`.** The alias is one comparison in `register.ts`, not a
  schema transform, so the JSON schema is unchanged. A terminal checks `desktop`, as it did.
- **More hover-only controls than listed.** The copy button and the buttons in a dashboard panel's
  header also hid until hover, so they show on touch too.
- **No plugin API export.** A name nothing imports fails the unused-export check, and no plugin
  needs the form factor yet. Export `formFactor` from `@acorn/plugin-api/client` when one does, with
  `formFactor` added to `infra/platform/public.ts` and the surface snapshot.
- **Container queries on the full-window layers.** `.settings-view` and `.dash-studio` are fixed to
  the window, so their containers measure what the media queries did, and the 900 and 1,100px
  thresholds stay. The desktop draws as before.

### What later phases need

- **Phase 4.** Controls are 44px, so the split `list-detail` panes at 390px have less room still.
  Three things measure under 44px by design: the native check boxes (12px), a row's twist (3 by 6px),
  and the two buttons of a segmented control (42px inside a 44px box). Each sits inside a row or a
  control that is itself 44px. A row's twist and a check box need a bigger target if phase 4 finds
  they can't be hit.
- **Phase 5.** Menus open by long press anywhere a right-click opens one. A new menu needs only an
  `onContextMenu` handler. A control that reveals on hover needs a `@media (hover: none)` rule.
- **Phase 6.** Check on a real iOS Safari that the long press opens a menu once, that releasing the
  finger doesn't press the row, and that the text callout doesn't show over the menu.
  `-webkit-touch-callout` and `user-select` on rows are unset. CodeMirror's editable area isn't an
  `input`, so it may still make iOS zoom. The desktop renderer budget check fails on the
  denylisted workflows chunks and the roster size before and after this change. This change adds 23 B
  to the roster, 1,299 B to the startup scripts, and 499 B to the styles.

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
