# Terminal UI review

Date: 2026-09-27. Status: implementation in progress. Standalone terminal acceptance remains open.

The target is an `acorn` terminal client that can be the user's primary app. It must start from a
clean installation, expose every applicable task and node operation without dead controls, teach its
keyboard model on screen, and remain readable at 80 by 24 as well as 120 by 40.

This is a review of the shipped host, not a second implementation of the product model. The Node
owns data and execution, `@acorn/client-core` supplies panes and queries, and `apps/tui` supplies
custody, cell rendering, chrome, and keyboard dispatch. Changes to a feature's data or command
contract belong with that feature. Terminal layout and text alternatives belong in `apps/tui`.

## Read this folder

1. [Evidence and strengths](./evidence.md) distinguishes live observations from code and test review.
2. [Feature inventory](./features.md) names every user-facing area and what remains to verify.
3. [Navigation and affordances](./navigation.md) gives the keyboard and comprehension findings.
4. [Host projections](./host-projections.md) decides what to hide, retain, or replace per host.
5. [Delivery and acceptance](./delivery.md) orders the work and defines release gates.
6. [Decisions not taken](./refused.md) records alternatives that would weaken the terminal app.

## Current assessment

The TUI has a coherent cell renderer and focus model. The live `tui-navigation` flow passed across
task opening, agent and Changes panes, workspace switching, help, and resizing. Several deep pane
tests cover agent turns, PR controls, plugin trees, scrolling, and PTY escape. That is a useful base,
but it does not establish that a user can complete the desktop's whole workflow from a terminal.

The initial review found controls that appeared actionable but had no terminal effect, including
agent attachments, exports, and source-item promotion. It also found no Settings route, no terminal
drawer, and a transient Agent pane error that survived reconnect. The implementation pass below
addresses those paths. Several desktop settings and feature journeys still need terminal acceptance.
The review also found text clipping in narrow rows and a commit action rendering `[object Object]`;
the latter was repaired in this review.

## Implemented during this review

- Declared the TUI's runtime dependency on `pg`. The isolated PTY driver initially exited before its
  first frame because the built TUI imported `pg` through the Node data module without a package
  link.
- Removed the Lucide-name-to-character icon table from the terminal kit. Terminal `IconButton`s use
  their labels, tabs use their labels, and `Icon` draws nothing. Task rows
  disclose the number of markers and keep the full marker labels in the keyboard-accessible modal.
- Made `ConfirmButton` use its label when its child is a component. This removes `[object Object]`
  from the Changes commit toolbar.
- Put terminal `SectionHeader` actions below the heading so full labels do not erase the title at
  narrow widths.

The clean isolated PTY navigation flow, the TUI suite, lint, and documentation path checks passed
after these changes. The broader terminal-only journeys and reused-session recovery gate in
[Delivery and acceptance](./delivery.md) remain open. The remaining proposals are not described as
shipped behavior in the owning docs.

## Implementation pass on 2026-09-27

The host now retries reads and pane boundaries after reconnect, with a visible Retry control for a
persistent error. A first-run route creates workspaces, projects, and tasks and exposes provider
connections; Settings and New task remain in the palette. Password fields mask their terminal cells.
The file seam opens an absolute local path prompt for attachments and downloads, with errors and
overwrite confirmation. Source rows can invoke their promotion contract through a terminal task
picker. A task and the palette can open a native terminal session list and PTY, including an existing
managed-agent handoff. The selected task's full title is repeated across the screen.

Focused tests and a live disposable shell PTY passed at 80 by 24 and 120 by 40. A clean-profile
journey created a workspace, project, and task, and a fresh fixture passed the navigation flow. The
provider connection journey, full feature inventory, desktop comparison, and packaged release
checks remain open. These are release gates, not claims of completion.

## Outcome required to close this review

Every row in the [feature inventory](./features.md) must have a passing terminal journey or an
intentional, visible host limitation. A command must never promise an operation that silently does
nothing. A person starting without the desktop must be able to set up a project, start and supervise
work, inspect results, recover from errors, and exit safely. Record real 80 by 24 and 120 by 40
screens for those journeys before marking this programme complete.

## Verify before building

- Re-read [the runtime map](../../architecture-overview.md), [the terminal client](../../tui.md),
  and [the closed kit](../../ui-design.md) before moving a host boundary.
- Check the current `apps/tui/src/kit`, `apps/tui/src/chrome`, `apps/tui/src/platform.ts`, and
  `packages/client-core/src/infra/platform` contracts. Paths here are implementation hints.
- Re-run the isolated fixture and inspect the target pane before changing a shared component.
