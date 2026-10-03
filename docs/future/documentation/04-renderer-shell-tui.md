> **Completed 2026-10-04** by the "Phase 4 Renderer, shell, and terminal client" task.
>
> **What landed:** All 14 docs were checked against the code, restyled, and cut to 200 lines or fewer.
> `frontend`, `ui-design`, `panes`, `command-palette-and-shortcuts`, `diff-rendering`, `editor`,
> `notifications`, `shell`, and `tui` are landing pages over 65 topic pages in folders of the same
> names, with old-heading `<a id>` anchors on each landing page. `native-overlays` stayed one page.
> `editor.md` is a reference, not a decision record. About 690 source citations now name the topic
> pages, and the allowlist shrank from 354 to 177 lines, with no entries left for this phase's docs.
>
> **Deviations:** (1) More pages than the plan named: 65 topic pages. `tui/interaction.md` split into
> eight pages, not four (keys, typing, focus, navigation, scrolling, traps, footer, reporting), to stay
> under 200 lines. (2) `tui/interaction.md` and `tui/chrome-and-plugins.md` are short redirect pages
> with anchors, because this doc's own table links to them and I couldn't edit its body.
> (3) `tools/arch/kitTable.test.ts` reads the 80 by 24 appendix from `docs/ui-design/every-node.md`
> now. (4) Test titles in `apps/desktop/test/client/parity.test.ts` cited a "Parity" section that never
> existed. They now cite `panes.md`, `ui-design/appearance.md`, `frontend/rail-and-routing.md`, and
> `command-palette-and-shortcuts.md`. (5) Sections that source cited but no doc had were written:
> `frontend.md` § Reactivity, `frontend/settings-groups.md` § Node management, and
> `ui-design/states.md` § Connection and staleness vocabulary. (6) "Doors left open" moved to
> `docs/future/tui-review/open-doors.md`, indexed in that programme's README. (7) Code won over the
> docs: the terminal split key is Ctrl+Shift+arrow, not the primary modifier; there are 11 terminal key
> tiers, not 10; there are 22 palette tokens, not 21; the eager icon set is 123 names, not 77;
> `acorn` ships in the standalone tarball (`pnpm pack:node`), so "Shipping it: not shipped" was wrong;
> `PLUGIN_API_MAJOR` is `3`, so the palette and editor history citing majors 9 and 10 was dropped; and
> the Rust shell has 19 modules, not the seven `shell.md` listed. (8) `docs/README.md` is 260 lines,
> because it lists every topic page in a new "Renderer, shell, and terminal topic pages" section.
> (9) Source comment edits are comment-only, except the allowlist, the kitTable path, and the parity
> test titles. A preview pane comment that said `WebContentsView` now says child webview.
>
> **For later phases:** The throwaway scripts I used (not committed) did three jobs, and they're worth
> rewriting if you split a big doc: rewrite `docs/<landing>.md § Heading` citations to whichever topic
> page in the same folder owns that heading, rewrite relative doc links the same way, and prune
> allowlist lines that pass. Run the rewrite only after the topic pages exist, and keep heading text
> verbatim when you move a section, or the rewrite can't match it. The rewrite matches by heading, so
> check citations whose heading moved but whose meaning didn't: `panes.md § Layout model` covered both
> layouts and pane models, and I hand-moved the model ones to `panes/models.md § Pane models`. A CSS
> block comment has no `*` prefix, so a citation that wraps there fails the check: keep the heading on
> one line. Phase 5 owns `terminal.md`, `workflows.md`, and `database.md`, which still link to
> sections here by prose (`§ Heading`) that resolve through anchors. `docs/plugins/frames.md` repeats
> the editor's `document-over-frame` and language-smarts material, which phase 6 should point at
> `docs/editor/`. `testFocus.test.ts` in the arch suite failed once with a Vitest worker-start timeout
> under load and passed on rerun. I ran `pnpm lint`, the arch suite, and the desktop parity test. I
> didn't run `pnpm dev:agent` or `pnpm dev:tui:agent`, so UI claims that need the running app, such as
> tooltip placement, the terminal footer words, and the Settings route, weren't checked live.

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
