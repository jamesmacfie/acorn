# Phase 4: Renderer, shell, and terminal client

Date: October 3, 2026. Status: proposed, not started. Part of the
[documentation overhaul](./README.md). Do [phase 1](./01-guardrails.md) first.

These pages describe the clients: the Solid renderer, the UI kit, panes, the palette, the editor,
the Tauri shell, and the terminal client. This is the largest phase by lines. Split it into one pull
request per doc.

## Docs in this phase

| Doc | Lines | Source citations |
| --- | --- | --- |
| [frontend.md](../../frontend.md) | 942 | 67 |
| [ui-design.md](../../ui-design.md) | 1,026 | 254 |
| [ui-design/appearance.md](../../ui-design/appearance.md) | 280 | 0 |
| [ui-design/closed-kit.md](../../ui-design/closed-kit.md) | 323 | 0 |
| [panes.md](../../panes.md) | 526 | 98 |
| [native-overlays.md](../../native-overlays.md) | 111 | 0 |
| [command-palette-and-shortcuts.md](../../command-palette-and-shortcuts.md) | 565 | 83 |
| [diff-rendering.md](../../diff-rendering.md) | 744 | 51 |
| [editor.md](../../editor.md) | 974 | 36 |
| [notifications.md](../../notifications.md) | 400 | 23 |
| [shell.md](../../shell.md) | 1,049 | 88 |
| [tui.md](../../tui.md) | 755 | 215 |
| [tui/interaction.md](../../tui/interaction.md) | 790 | 0 |
| [tui/chrome-and-plugins.md](../../tui/chrome-and-plugins.md) | 411 | 1 |

## Known problems

### editor.md

This page reads as a design proposal. It has sections titled "The question", "What is already true",
"Sequence", and "What this does not fix". Rewrite it as a reference: what the host editor does, what
it lends to plugins, and its limits. Keep a short "Why CodeMirror" section. Drop the decision story.
Split composed panes, find in files, line markers, save recovery, and host document export into
`docs/editor/` topic pages.

### ui-design.md

The most-cited doc in the repository after `plugins.md`. "Shell hierarchy" runs 158 lines, "Icons"
runs 139, and "Interaction rules" runs 125. "Appearance" and "The closed kit" are pointers to the
subfolder pages. Move each long section into `docs/ui-design/`. Keep the landing page short, with
anchors for every moved heading, because 254 source comments cite it.

### frontend.md

"Registries and plugins" runs 283 lines and "Settings" runs 311. Both deserve their own pages in
`docs/frontend/`. Check "Startup budget" numbers against the boot test in `docs/testing.md`, and
date any measurement you keep.

### shell.md

"Renderer origin and protocol handler" runs 248 lines and "Host-owned webviews" runs 159. Split into
`docs/shell/` pages for the process and Node child, origins and schemes, the connection broker,
webviews, and packaging. Check every command name and capability against `apps/desktop/src-tauri`.

### tui.md and tui/interaction.md

`tui/interaction.md` came out of an earlier split as one 694-line "Keys and focus" section. Split it
again by topic: key routing, focus, scrolling, and telemetry. `tui.md` has "Doors left open", which
is proposal material, and "Client worker lifetime" at the end, after "Related". Put sections in a
reading order and move proposals to `docs/future/tui-review/`.

Check every key binding against the `@opentui/keymap` registrations in `apps/tui`. Drive the client
with `pnpm dev:tui:agent` to confirm what the keys do.

### diff-rendering.md and command-palette-and-shortcuts.md

Each has one or two "What it refuses" sections, 60 to 80 lines long. Keep refusals that stop a
reader from reopening a decided question, cut to a sentence each. Put the rest in Git history.

### panes.md

"Layout model" runs 264 lines. Move it to `docs/panes/layout.md` (new). "Not a pane: the reference
panel" can be a short note that links to its owner.

## Done means

- Each doc in the table follows the [house style](./style.md) and is 200 lines or shorter.
- `editor.md` describes shipped behavior, not a decision.
- Every key binding and command name these pages give exists in source.
- UI claims that only show in the app were checked in `pnpm dev:agent` or `pnpm dev:tui:agent`, or
  the pull request lists them as unchecked.

## Verify before you start

- Re-count citations of `docs/ui-design.md` and `docs/tui.md` sections. They have the most.
- Read the `docs/future/tui-review/` programme. Some of its proposals shipped and belong in these
  pages now.
