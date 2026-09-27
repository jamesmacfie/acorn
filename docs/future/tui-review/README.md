# Terminal UI review

Date: 2026-09-27. Status: review and partial repair. Standalone terminal acceptance remains open.

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

The most serious gaps are controls that appear actionable but have no terminal effect, especially
agent attachments and exports and source-item promotion. Settings has no TUI surface, so setup and
recovery depend on editing configuration or using another host. The terminal drawer and several
desktop slots have no reachable alternative. A rebuilt live run also left an Agent pane showing a
transient connection error after the Node returned online. Live review found text clipping in narrow
rows and a commit action rendering `[object Object]`; the latter was repaired in this review.

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
