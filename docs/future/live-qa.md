# Live QA: what the test suite cannot prove

From the user-extensions landing review (2026-08-15). Plugin suites run in a node environment with
no Solid transform, and no new desktop e2e specs are being added while that suite is extracted —
so everything visual in the shipped extension work has **never been seen rendering**. This file is
the checklist for one deliberate pass in a running app. Doing the pass and fixing what it finds
closes this file.

## The checklist

Each item names the behavior to see, not the code to read:

1. **Context menus** — right-click on a surface with a plugin-declared menu row: the menu appears
   at the pointer, and clamps to the viewport instead of overflowing at screen edges.
2. **The topbar chip** — a plugin's declared `topbar` slot item renders in the topbar's right end,
   beside the node chip and the bell, at a size that doesn't distort the bar.
3. **The extension-point strip** — a contribution from plugin B rendering inside plugin A's
   declared point lays out correctly under a pane (spacing, overflow, empty state).
4. **The exclusive-slot error boundary** — force a render throw in a plugin's `coreSlot`
   replacement and watch the surface flip back to core's implementation instead of a blank.
5. **Plugin themes** — select a plugin-contributed theme; check the terminal and Monaco pick up
   the right light/dark self-description, then disable the plugin and confirm the fallback to
   Light/Dark without the stored preference being rewritten.
6. **The reload loop, end to end** — edit a dev-mode plugin's entry file, watch the swap land
   without a restart or a trust prompt; then edit a non-entry module and confirm the documented
   one-module-deep limit surfaces as the restart hint, not silence.

## One known bug, decision needed before fixing

`:root:not([data-theme="light"])` under `prefers-color-scheme: dark` has the same specificity as a
named theme block, and it sets `--is-dark: 1` — so with the OS in dark mode, the light-palette
themes `solarized-light` and `catppuccin-latte` tell xterm and Monaco they are dark while rendering
light. Pre-existing, found during the extension work, deliberately not fixed there: the fix is two
lines but **changes shipped visual behaviour for existing users** of those two themes. Decide,
then do — the fix belongs in its own change with its own note, not slipped into an unrelated diff.

## How to run it

A worktree cannot run the app (no `.env`, and 4317 is the live instance) — do this pass from the
main checkout. Manual is fine; the point is eyes on pixels, once, with the list above as the
script.
