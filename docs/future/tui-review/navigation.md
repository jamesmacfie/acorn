# Navigation and affordances

Date: 2026-09-27. Status: UX findings and proposed changes.

The terminal's focus model is a strength. One focused region owns the keys, a caret marks its row,
the panel border lights, and Escape climbs out through a defined topology. Keep that model. The work
is to make the user's destination, available action, and result clear at each level.

The findings below record the initial review. [The implementation pass](./README.md#implementation-pass-on-2026-09-27)
adds recovery, a setup route, terminal sessions, and a full selected-task title; the remaining
success criteria still need their terminal journeys.

## Keyboard findings

| Priority | Finding | Change and rationale | Success criteria |
| --- | --- | --- | --- |
| P0 | Some visible actions have no host capability. An Enter press can return no result. | Gate the control on the platform seam, or supply a terminal action with explicit text. A silent press teaches the user that Enter may not work. | Every visible press causes a state change, opens a next step, or gives a reason it cannot proceed. |
| P0 | A pane can retain an initial connection refusal after the topbar shows the Node online. | On reconnection, refetch errored queries even if the error boundary unmounted their observers, then reset that boundary. Offer a visible Retry action if automatic recovery fails. | The reused PTY fixture reaches its Agent session list after Node startup without changing panes or restarting the TUI. |
| P0 | Settings is absent from `Ctrl+K` search. The live palette answered `No matches` for `settings`. | Add a Settings group with terminal pages for required setup and recovery. If a setting needs an OS dialog, use a typed path, text import/export, or a specific unavailable message. | A terminal-only user can configure Node, project, provider, plugin, notifications, appearance, and shortcuts without installing desktop. |
| P1 | Tab moves regions, while a field's Tab moves controls. This rule works but is hard to infer from a truncated footer. | Keep the rule and show `Tab next control` on fields, `Tab next region` elsewhere. Include the current region and focused control name in the help sheet. | A new user can leave a filter or composer and reach the next action with keyboard only. |
| P1 | The `?` sheet lists active keys but not the meaning of the current screen. Its pane chord appeared as `ctrl+meta+right` in the live frame. | Render human key names, explain Menu, Browse, Tasks, pane strip, and an entered PTY, and add a short "Where am I?" line. Keep the active-key source of truth. | Help names the current region and produces keys that the driver can send in both kitty and legacy modes. |
| P1 | At 80 by 24, the footer cuts off after the first few global hints. | Prioritize Escape, Enter, movement, and one discovery key, then use `?` for the full list. Replace repeated global hints with the active local action where possible. | The footer never truncates a key or action word mid-token, and help is visible at every depth. |
| P1 | A row may clip its title, path, status, and trailing action into fragments. The Changes fixture showed files as `module-0000.tsrc/pkg-`. | Use a focused detail line or inspector with full path and available actions. Keep the list compact, but give selection a complete name. | Every selected file, PR, session, and container can be identified without guessing from clipped text. |
| P1 | `Ctrl+K` opens a useful command catalogue, but a failed query only says `No matches`. | Give a nearby path for major missing categories, especially setup. Keep command titles phrased as verbs and results scoped to the active Node and task. | Searching `settings`, `new task`, `terminal`, `plugin`, and `help` returns the intended route or an actionable explanation. |
| P2 | `j` and `k`, arrows, `h` and `l`, Tab, and pane chords overlap. | Teach one primary route first: Tab between regions, arrows within, Enter to act, Escape to back out. Show advanced aliases in help. | A user can finish the core flows using that four-key model and can discover faster keys later. |
| P2 | A source with no Browse list leaves a large panel saying `Nothing to list here`, even if the main pane is useful. | Suppress the empty Browse frame for component-only sources, or name why it is empty and where to go next. | The startup frame has no large unexplained blank panel. |

## Interaction rules to preserve

- Keep a single focus owner and the typed tier table in `apps/tui/src/keys/tiers.ts`. Avoid pane-local
  global listeners that can conflict with typing, overlays, or PTYs.
- Keep Escape as an unwind action. An entered PTY needs a visible exit hint before it takes all keys.
- Keep the palette and dialogs as scopes. Tab must never reach controls behind an overlay.
- Keep keyboard access to full marker labels through `Shift+F10` or the menu key. The task row count
  is a disclosure, not the content of the markers.
- Keep `Ctrl+B` reversible. Hiding the rail must not erase the user's selected task or source.

## First-run comprehension

The initial screen needs a short path to doing work: choose or create a workspace, add a project,
open or create a task, and choose a pane. The topbar names workspace, project, and task count.
An empty profile opens setup, and the command palette can reopen it after setup.
When no provider, source link, or agent CLI exists, state the missing dependency and offer the next
action. An empty list must not imply that the Node succeeded and found no records if the request
failed or a connection is missing.

## Keyboard validation matrix

For each focusable pane, test these transitions in the real PTY at 80 by 24 and 120 by 40: start in
rail, enter the pane, walk to the last control, move backward, type into a field, leave it, open and
close each overlay, scroll past one viewport, resize, then return to the rail. Repeat critical paths
with kitty and legacy keyboard modes. Record the focused control and visible footer after each step.
Add automated tests for a bug only when they assert the user-visible transition, not a copied keymap
table.

## Verify before building

- Trace a proposed key from `hostKeysFor` through tier matching, the focus store, the target
  component, and the footer claim.
- Check whether terminal emulators deliver the chord in both driver modes before documenting it as
  the primary path.
- Inspect a frame after every navigation transition; the return value of `press` alone proves only
  that bytes were sent.
