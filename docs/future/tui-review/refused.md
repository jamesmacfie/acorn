# Decisions not taken

Date: 2026-09-27. Status: review decisions; reconsider if new evidence changes the trade-off.

## Replace Lucide icons with an arbitrary symbol set

The removed terminal glyph table mapped Lucide names to single characters. Several names had
no mapping and drew nothing, while similar marks represented unrelated actions. It also made action
meaning dependent on terminal fonts and Unicode width tables. Use a control's text label, and put
status words beside data whose state matters. Borders, carets, checkboxes, and scrollbars remain
structural terminal marks.

## Hide an unsupported action only after the user presses it

A button that returns no file, opens no dialog, or runs a no-op callback looks broken. Capability
gates must decide whether to render it. If the operation matters in a terminal, provide an explicit
path or text flow. If the host cannot perform it, say why at the point where the user looks for it.

## Copy the desktop's side rail, drawer, and modal geography

Those layouts assume pixels, hover, OS windows, and child webviews. The terminal's named regions,
full-screen overlays, and native PTY are better foundations. Share data and command outcomes while
placing controls according to terminal reading order.

## Add another global keymap for each pane

`apps/tui/src/keys/tiers.ts` and the region store already arbitrate typing, collections, overlays,
and entered PTYs. Parallel global listeners would make keys depend on mounting order and leave the
footer unable to describe the live binding. Add a key at its existing tier and test the focused
transition.

## Declare parity from rendered fixtures alone

A populated component frame proves that cells can be drawn. It does not prove setup, authentication,
write results, external CLIs, or error recovery. Keep fixture tests as regression checks and require
isolated live journeys for release acceptance.

## Verify before building

- Revisit a decision only with a screen or user journey that demonstrates a concrete failure.
- Preserve the shared Node and client-core contracts unless a working terminal action needs a new
  capability.
