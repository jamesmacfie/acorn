# Notifications

A programme, 2026-09-02. Phases 1, 2 and 3 have shipped and nothing else has started. It starts from a
complaint: acorn notifies on too many agent steps. It ends with one attention model shared by
managed and PTY agents, a settings page, and four channels that hang off one gate, on both hosts.

## The verdict, in a paragraph

The node is right and the client is reading the wrong thing. Every agent session row already carries
an attention state the node projects from the driver's events, which is the fact herdr has to
screen-scrape twenty terminals to recover. The client ignores that row and raises a notice per raw
event instead: one per permission prompt, one per turn, on an app-lifetime subscription, with no idea
whether you were watching. A second detector does the same for PTY agents with its own vocabulary.
The fix is an edge layer: collapse each row to five states, notify on three transitions, hold a
second and re-check, and treat an edge you watched as history rather than news. Sound, system
notification, dock badge, and terminal notification then hang off that one gate, and a settings page
switches each. [analysis.md](./analysis.md) has the evidence, numbered; [model.md](./model.md) has the
target; [references.md](./references.md) has what herdr and six others do and which parts came
across.

## What is in the folder

| File | What it is |
| --- | --- |
| [analysis.md](./analysis.md) | The read: what is sound and stays, and seventeen numbered findings with the file each was read from. |
| [references.md](./references.md) | herdr in detail, then gouda, cmux, verne, emdash, orca, proliferate, and bb, each with what acorn took and what it left. |
| [model.md](./model.md) | The target: five states, two adapters, three edges, one gate, acknowledge on view, the channel matrix, the settings schema, a worked example, eight invariants. Every phase points here. |
| [refused.md](./refused.md) | What the programme decided not to do, with the reasoning. |
| [phase-1-edges.md](./phase-1-edges.md) | Shipped. A pointer to where the reducer, the gate, and their documentation ended up, and the four places the build departed from the plan. |
| [phase-2-settings.md](./phase-2-settings.md) | Shipped. A pointer to where the page, the parser and the key ended up, and the three places the build departed from the plan. |
| [phase-3-sound.md](./phase-3-sound.md) | Shipped. A pointer to where the chimes, the sink and the BEL write ended up, and the three places the build departed from the plan. |
| [phase-4-desktop.md](./phase-4-desktop.md) | The `notify` seam group: Tauri notifications with a web fallback, click to open, the dock badge as the pill. |
| [phase-5-tui.md](./phase-5-tui.md) | OSC 9, 99, and 777 to the host terminal, terminal focus, a topbar count, an inbox overlay. |
| [phase-6-tests-and-docs.md](./phase-6-tests-and-docs.md) | The invariants as properties, `docs/notifications.md` (new) as the owner, and deleting this folder. |

## The phases, in one line each

| Phase | What it is | Depends on | Status |
| --- | --- | --- | --- |
| 1 | Five states, three edges, one gate with a one-second hold and a seen rule. Two detectors become one. Completed rows acknowledge on view. | nothing | Shipped 2026-09-02. |
| 2 | A Notifications settings page over one JSON device preference, with a test button. | 1 | Shipped 2026-09-02. |
| 3 | Two WebAudio chimes; BEL on the terminal client. | 2 | Shipped 2026-09-02. |
| 4 | Seam group `notify`: `tauri-plugin-notification`, `set_badge_count`, web fallback, click to open. | 2 | Not started. |
| 5 | Terminal client: OSC backends with tmux passthrough, DEC 1004 focus, topbar count, inbox overlay, `ACORN_TUI_NOTIFY`. | 1, 3 | Not started. |
| 6 | Invariants as tests, `docs/notifications.md`, pointers, folder deleted. | all | Not started. |

Phases 4 and 5 are next, and they are independent of each other; 5 now has its BEL and needs
nothing else from 3. The gate now reads the `notifications` device preference through `readNotificationSettings`
in `features/notifications/settings.ts`, and each of those phases hangs its channel off
`registerNoticeSink` and its switch off the page phase 2 built.

## How to use this folder

Each phase file has the same sections: goal, why, numbered requirements, design notes, files,
tests, acceptance, and doc moves. The requirements are the contract. If the code turns out not to
match a requirement's premise, change the requirement in the file and say why in the same commit,
so the next person argues with a reason. Paths are hints and every phase says to verify them; the
docs path check (`tools/arch/docPaths.test.ts`) refuses a backticked path that does not exist, so a
file a phase proposes is marked `(new)` on its line.

The user-facing test of the whole programme is the worked example in [model.md](./model.md) § A
worked example. When those seven steps happen as written on the desktop, and the Warp acceptance in
[phase-5-tui.md](./phase-5-tui.md) happens in a terminal, the programme is done and the folder goes.

## What this touches elsewhere

- `docs/plugin-map.md` § Notifications is the closest thing to an owner today, a decision table of
  which call a plugin makes. It keeps that job and points at the model.
- `docs/frontend.md` § Shell state owns the notice-versus-attention distinction, which the model
  keeps and phase 6 moves.
- `docs/shell.md` § The renderer bridge owns the seam groups the desktop installs; phase 4 adds one.
- `docs/tui.md` §§ Chrome and Doors left open own the terminal client's screen and its gaps; phase 5
  changes the first and adds to the second.
- `docs/features.md` § Settings and fleet lists the settings sections, Notifications among them.
- `docs/state-ownership.md` § Scope rules puts notices and notification settings on the device.
- `docs/contribution-kinds.md` row "Attention sources" is the seam a plugin uses to add rows to
  "Needs you"; phase 1 adds one optional field to the item.
- `docs/future/events.md` is independent. `agent-session:changed` is the event a remote client would
  read instead of the row, and nothing here needs it.
- `docs/managed-agents.md` owns the node's attention projection and is not edited: the model is a
  client-side collapse of the states it already lists.

## Verify before building

- Phase 1 shipped, so the gate is real: `observeAttention` and `deliver` in
  `packages/client-core/src/features/notifications/deliver.ts` are what a later phase hangs a
  channel off, through `registerNoticeSink`.
- `apps/desktop/src-tauri/Cargo.toml` has no notification plugin and the capability file grants
  `core:default` only. Phase 4 adds both; if either has appeared, phase 4 shrinks.
- OpenTUI emits `CliRenderEvents.FOCUS` and `BLUR` from DEC 1004 reports
  (`references/opentui/packages/core/src/renderer.ts`). Phase 5 needs the installed version to do
  the same.
- The terminal client has no `localStorage` and `writeDevicePref` is a no-op there. If a
  file-backed store has landed, phase 5 reads the preference instead of `ACORN_TUI_NOTIFY`.
- `tauri` v2's `set_badge_count` and `tauri-plugin-notification`'s desktop click handling are named
  as things to check, not facts, in [phase-4-desktop.md](./phase-4-desktop.md).
