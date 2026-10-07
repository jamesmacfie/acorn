# Phase 03: copy link

## Completion note, October 8, 2026

Implemented one core **Copy link** command in the desktop and terminal palettes. The desktop uses
the Settings layer's page and Node while it is open. Otherwise it copies the visible task, a project
route owned by the visible source, or the rail source. Project routes retain their encoded plugin
path. The task row and rail source menus use their clicked targets, so an inactive task row never
copies the active task. The project action is in the topbar menu, and Settings has a header button.
Loaded plugin project pages receive the action from the host without plugin code.

Task links include the focused pane. A pane can report a linkable selected item through
`selectedItem(task)` on its contribution; no pane reports one in this phase, so current task links
stop at the pane. The copy helper uses `buildLink` with a concrete Node ID, waits for the clipboard
write, and shows success or failure in the transient toast stack. The terminal uses its OSC 52
clipboard path and shows the link in the palette when that path is unavailable. This phase adds no
terminal startup or link-dispatch behavior.

The loaded HTTP source does not declare `projectScoped`, though its page is routed below
`/p/:projectId/x/http/`. Copy link checks ownership of the routed surface, not that flag alone. It
also ignores a stale project path when another source is on screen. The settings header copies the
Node shown by a page's Node switcher, which can differ from the Node behind the overlay.

Focused tests cover encoded plugin path parsing, clipboard refusal, task pane and item selection,
source ownership, and a right click on a nonactive task row. The desktop agent session copied
`acorn://ae6734dc-ea23-4221-8e99-226825a28fff/p/71f1b100-6d87-450b-8346-fea47353ebee/x/http/requests/sample%20id`
from the loaded HTTP page; the driver reopened that link at the same route. The Settings button
copied `acorn://ae6734dc-ea23-4221-8e99-226825a28fff/settings/integrations` while Settings
covered Home. Screenshots are in the isolated `phase03-copy-link` agent session. An unpaired Node
link returned the refusal. Client-core, desktop, TUI, and protocol scoped lint and all 87
architecture tests passed.

The desktop package suite passed 174 tests and retained 11 baseline plugin-disable snapshot
failures when run with loopback access (`/private/tmp/acorn-phase03-desktop-escalated.log`). The
client-core suite passed 2,519 tests and retained its two baseline scope and CSS assertions; one
pane timing failure in an earlier loaded run passed on a focused rerun
(`/private/tmp/acorn-phase03-client-core-final.log`). The TUI
suite passed 676 tests with host access and has one `sourceSwitch.test.tsx` failure that
also fails when run alone (`/private/tmp/acorn-phase03-tui-escalated.log`). The coordinator owns the
final gate and the phase 02 installed-bundle check. Phase 05 can use the same address builder without
changing this copy action.

Date: October 8, 2026. Status: implemented. Dependencies: phase 01.
Read the [plan](./README.md), especially the decision that
[Copy link produces the exact path](./README.md#decisions).

## Deliverable

A **Copy link** action that puts an `acorn://` link to the current place on the clipboard. It is
available on a task, a project page, a plugin page under a project, a settings page, and a rail source.

## Steps

1. Add one core command, **Copy link**, that builds a link from the active Node's ID and the current
   place with `buildLink`. On a task, include the focused pane and its selected item when the pane
   reports one.
2. Show the command in the palette, in the task row's menu, in a project page's menu, in the settings
   page header, and in the rail source's menu. Use the existing menu contribution points, not a new
   one.
3. Plugin pages get the action with no plugin code. The command reads the router's current path, which
   already carries the plugin's page.
4. Confirm the copy with the same short toast other copy actions use.

## Acceptance

- Each place produces a link that phase 01's parser reads back to the same place.
- A plugin page's link opens that page through `pnpm dev:agent:ui -- --session <name> link <copied link>`.
- A link copied on one Node and opened on a device paired with a different Node shows the unpaired
  Node refusal, not the wrong data.
- `pnpm lint`, `pnpm test --filter=@acorn/client-core`, and the desktop suite pass.

## Verify before building

- Which menus accept core contributions on each of these places, and how the terminal client shows
  the same command.
- Whether a pane can report its selected item today, or whether the task link stops at the pane.
