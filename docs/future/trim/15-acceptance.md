# Phase 15: verify the combined programme and publish its evidence

Date: 2026-10-06. Status: ACCEPTANCE OPEN. Risk: medium; independent passes do not prove combined behavior.
Prerequisite: accepted [phase 14](./14-provider-boundary.md), with all earlier handoffs recorded.
Planning revision: `2ae55abb5`; compare against phase 01 using the same measurement definitions.
Phase 14 disposition: retain the GitHub-shaped shared core read model and provenance. Record it as
remaining debt; no schema, protocol, or plugin-tier migration is an acceptance prerequisite.

## Verification disposition (October 6, 2026)

The combined branch passed a clean frozen install, 37 lint tasks, all 36 root test tasks including
desktop and Rust, six build tasks, and standalone Node packing on Darwin arm64 with Node 24.21.0.
The independent packed npm install, CLI help, TUI startup, and staged pinned-Node PTY read, resize,
and exit also passed. The [combined evidence](./evidence.md#phase-15-combined-acceptance-2026-10-06)
records comparable inventory, owner walkthroughs, host screens, logs, and retained decisions.

The isolated desktop sent a live managed Codex turn and retained a draft after navigation. The
isolated TUI sent a live managed Codex turn at 120×40, closing phase 13's host focus/send gap.
Held requests, queue and process races, workflow adapters, and loaded-plugin rollback have
deterministic public fixture proof in the full test run. The host drivers could not exercise every
native menu, drag, picker, approval, queue, workflow, and loaded-plugin interaction live. Those
limits are listed with the exact proof available in the combined evidence.

Release acceptance remains open. The local macOS `dist --prebuilt` build failed because Rust 1.96.0
generated a proc-macro dylib that macOS rejected with a misaligned `LINKEDIT` string pool. Cleaning
only this checkout's release outputs and rebuilding reproduced it. No `.app`/DMG existed, so
`verify:bundle` could not inspect an installed artifact. Windows ConPTY and Linux built-addon
runtime smokes also need their target runners. Do not describe staged files or Darwin PTY behavior
as those target results. This audit records those gaps without changing release policy or budgets.

## Task and context

Verify the combined dependency and maintainability changes. Resolve concrete regressions found in
acceptance within their existing scope; do not add optional refactors. The outcome must distinguish
real reductions, behavior-preserving extractions, retained dependencies, and deferred schema work.
No implementation is complete merely because individual focused tests passed.

## Starting points

- Programme `README.md`, `evidence.md`, `refused.md`, and every numbered task's delivery record.
- Phase 01 inventory script/outputs; current manifests, lockfile, package graph, staged helper.
- Refactored rail/composer, workflow activation, plugin host, admission/process owners, runtime facade.
- Root scripts, [testing](../../testing.md), [local development](../../local-development.md),
  [packaging](../../shell/packaging.md), [architecture](../../architecture-overview.md), and
  [agent operations](../../managed-agents/operations.md).

## Implementation steps

1. Audit every handoff. Each required code phase must have accepted gates and evidence. For phases
   04/05/14, list adopted vs retained/proposed outcomes explicitly. A blocked code phase cannot be
   hidden as a retention decision. Resolve missing proof before claiming programme completion.
2. Re-run the retained inventory under the same supported Node, pnpm, target, exclusions, and graph
   method. Compare unique direct names, declarations, production/dev-only lock closures, installed
   copies, staged helper bytes, and compressed artifacts separately. Explain changed versions/targets
   or unrelated repository work. Report only savings attributable to accepted changes.
3. Re-run the value-import graph and responsibility inventory. Confirm the targeted SCCs are absent,
   state has singular owners, activation files show composition, and runtime inheritance is gone.
   File sizes are supporting evidence, not a pass/fail threshold.
4. Review readability through four realistic changes: a task branch rule, an attachment/send rule,
   a workflow runner capability adapter, and an agent admission/retirement rule. Record where a
   developer starts, the owning contract, state/await boundaries, tests, and consumers. Remove any
   extraction-created forwarding maze, broad dependency bag, duplicate state, or new cycle.
5. Run the complete gates below from a clean supported-runtime environment. Record failures honestly.
   Fix regressions within scope; if a pre-existing/environment failure prevents a gate, record it
   as unresolved acceptance, not an assumed pass. Preserve security overrides and budget checks.
6. Build/package and test delivery paths outside the checkout. Desktop staging/native payload
   changes require installed/staged helper PTY and Claude-path evidence from relevant target runners.
   Build the existing release artifact where target infrastructure is available and run its existing
   inventory verifier. Do not publish or require release credentials merely to run a local smoke.
   Install the packed npm artifact in a temporary directory; prove CLI help and TUI startup.
7. Exercise real desktop and TUI flows below using isolated data/projects. Inspect screenshots and
   terminal output, and retain concise reports. Stop sessions and prove child/timer cleanup.
8. Update shipped owner documentation, indexes, all phase statuses, and the combined evidence summary.
   List remaining trade-offs and exact follow-ups; do not present proposed provider migration as done.

## Complete verification

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm pack:node
```

Use the root test wrapper, not a direct unrestricted Turbo test. The complete test includes the
architecture and desktop/Rust gates. Recheck existing artifact-verifier platform support before
running `pnpm --filter @acorn/desktop verify:bundle`; staging is not a signed installed artifact.
Do not raise budgets, suppress errors, update public snapshots indiscriminately, or delete tests.

## Real-host acceptance

Use `pnpm dev:agent -- --session trim-15` and
`pnpm dev:agent:ui -- --session trim-15 snapshot`, then click/fill/screenshot using fresh references.
Use `pnpm dev:tui:agent -- --session trim-15-tui --fixture tui-navigation` and its UI driver for
snapshot/press/resize. Check default size and 120×40; use `stop` for both drivers when finished.

- Task create/rename, setup choice, derived/edited branch, conflict/pending validation, origin switch,
  existing worktree/folder modes, descendants, drag, and keyboard navigation.
- Source/row menus, focus return, typing protection, modal Escape, palette and pane shortcuts.
- Shared composer drafts, held send/upload/capture across navigation, attachment replacement/limits,
  concurrent edits, fork context, streaming focus, and Chats only on return to a session.
- Interactive, workflow, and delegated managed turns: queue edit/reorder/cancel, options/defaults,
  approvals, resume, idle stop, terminal handoff, and shutdown followed by another Node boot.
- Loaded plugin contribution invocation, pre-commit failed reload keeping the old instance, successful reload,
  disabled cleanup, and storage closing after disposal. Use controlled fixtures, not production data.

## Acceptance and final handoff

- All 15 tasks have dated dispositions; every required implementation/host/artifact gate has evidence.
- Paired metrics show actual direct/graph/payload changes with limitations and no double counting.
- Target cycles, mixed task/composer operation ownership, activation domain behavior, and runtime
  inheritance have been addressed without changed public/persisted behavior or weaker security.
- Developer walkthroughs can locate each representative change and its tests without reconstructing
  implicit state ownership. Remaining complexity and retained dependencies have explicit reasons.
- Shipped docs describe current owners; future records distinguish plans from completed delivery.
- Give the user a concise summary of achieved reductions, refactors, verification, and remaining work.
  Do not deploy, publish packages, or merge branches as part of this acceptance assignment.

## Verify before building

Check every preceding disposition, current root scripts/runtime floor, artifact-verifier targets, and
measurement provenance. If required evidence is missing, keep acceptance open with a specific reason.
