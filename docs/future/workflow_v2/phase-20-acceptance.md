# Slice 20: Release acceptance and documentation handoff

Date: 2026-09-20. Status: implementation complete; release acceptance incomplete. Controlled-host
checks pass, but connected-provider and model, native desktop keyboard, and full-suite evidence
remain.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./verification.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 19. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

The implementation has an independent architecture review, focused automation, and controlled-host
evidence. The unavailable release evidence remains explicit below.

## Work

1. Execute the complete verification matrix, including manual and AI versions of the three example workflows and dashboard reuse.
2. Run installed-plugin conformance without host special cases and verify both compiled and loaded registration paths.
3. Exercise the configured 500-descendant load, nested cancellation/restart, occurrence recovery, and publication conflicts.
4. Complete real Tauri-window and terminal UX checks, including keyboard navigation, narrow layouts, stale previews, and recovery.
5. Record commands/outcomes/artifacts, move implemented behavior to owning docs, update programme status, and leave any unmet criterion explicitly incomplete.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Run `pnpm lint`, `pnpm test`, `pnpm db:check`, and
`pnpm --filter @acorn/arch-tests test`. Use the isolated real-window workflow from verification. No
component-only substitute for visual acceptance and no suite subset labeled as the full suite.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

### Acceptance fixes

- Returning from in-context child publication now remounts the node inspector against the refreshed
  workflow catalog. The parent no longer retains an unavailable child reference or an unknown record
  input after the child publishes.
- Schedule preparation now projects the workflow resolution scope onto the public data-source scope.
  Repository and user directory fields no longer cross the strict query boundary and cause a Zod
  error during activation review.
- The terminal loads its installed-plugin worker factory after the first frame and before the plugin
  watcher starts. The eager startup closure fell from 1,130,789 bytes to 1,091,506 bytes, below the
  1,130,000-byte budget.
- A completed baseline run emits a refresh after schedule settlement, and the client refreshes both
  the recent-run and schedule read models. The rail no longer waits for its polling interval to
  replace **Activating** with the settled state.
- The extensibility guide now names the repository path of the plugin function-mode boundary, which
  restores the documentation path architecture check.

### Controlled real-host acceptance

`pnpm dev:agent -- --session workflow-v2-acceptance` started an isolated desktop, Node, database, and
project. The cold renderer displayed content, and the Node reached its ready state in 1,202 ms. The
session loaded the eight bundled plugins and an installed `typed-source` fixture from the isolated
data root.

The unfamiliar plugin exposed nested records, dynamic **Project** choices, optional fields, and no
static record sample. The real editor changed the project from **Open** to **Closed**, marked the old
preview stale, refreshed it, published a child workflow in context, and returned to a typed `record`
binding in the parent. Parent and child revision 2 then ran through the actual Node. The parent run
finished `done`. Both child runs finished `done`. The record-history table showed `2 of 2
settled`, source and completeness provenance, task and run links, output, reprocess actions, and
attempt history.

The schedule review displayed its next three Pacific/Auckland checks, repeat policy, query window,
first-check choice, and effective limit of 100 descendants, four concurrent items, and 24 hours.
**Start tracking from now** created one baseline occurrence. It completed without child dispatch,
the schedule became **Active**, the next check appeared, and pause then resume kept the dialog and
rail consistent.

At 760 by 700 logical pixels, the record table and inspector remained usable without overlapping
controls. The WebDriver accessibility snapshot exposed named buttons, tabs, list boxes, options,
tree items, groups, and dialogs. Screenshots are in the isolated session directory:

- `.acorn/agent-dev/workflow-v2-acceptance/screenshots/nested-preview.png`
- `.acorn/agent-dev/workflow-v2-acceptance/screenshots/stale-preview.png`
- `.acorn/agent-dev/workflow-v2-acceptance/screenshots/nested-published.png`
- `.acorn/agent-dev/workflow-v2-acceptance/screenshots/nested-record-history.png`
- `.acorn/agent-dev/workflow-v2-acceptance/screenshots/narrow-record-history.png`
- `.acorn/agent-dev/workflow-v2-acceptance/screenshots/schedule-active.png`

The actual terminal client reached the pairing prompt against the same isolated Node. A one-time code
created through the desktop owner's authenticated pairing route paired the client. The terminal then
rendered the Default workspace, the acorn project, six tasks, the Workflows source, and plugin trust
prompts. Pressing `j` moved the selected trust action, which verifies terminal-region keyboard input.
Its startup marks were Node open at 3,410 ms, cache restored at 3,444 ms, application import at
3,476 ms, first draw at 3,502 ms, and roster registration at 3,538 ms. The terminal exited on
Control-C, and the desktop session drained its service and stopped.

### Automated checks

- `pnpm --filter @acorn/plugin-workflows test`: 59 files and 477 tests passed after the acceptance
  fixes. These suites cover source and binding failures, publication conflicts and recovery, nested
  dispatch, the 500-descendant bound, cancellation and restart, retry and reprocess, scheduling,
  occurrence recovery, checkpoints, processing history, and stale or offline client states.
- `pnpm --filter @acorn/tui exec vitest run src/startupGraph.test.ts
  src/plugins/plugins.test.tsx src/keys/keys.test.tsx src/keys/regions.test.ts
  src/workspaceFocus.test.tsx src/layouts/layouts.test.tsx src/smoke.test.tsx`: seven files and 86
  tests passed for startup closure, loaded plugins, keyboard regions, focus, layouts, and rendering.
- `pnpm --filter @acorn/plugin-workflows exec vitest run
  src/client/editor/WorkflowEditor.test.tsx`: one file and 14 tests passed.
- `pnpm --filter @acorn/tui build`: 831 modules built. The eager closure contains 109 chunks and
  1,091,506 of 3,063,799 bytes.
- `pnpm --filter @acorn/plugin-workflows lint` and `pnpm --filter @acorn/tui lint` passed.
- `pnpm --filter @acorn/arch-tests test`: four files and 63 tests passed after correcting the shipped
  documentation path.
- The final review aligned the generated plugin schema, installed fixtures, plugin scaffold, and
  authoring examples on plugin API 13. It also regenerated the Node route and desktop composition
  goldens, recorded the dashboard library's device-principal gate, and changed the task-disclosure
  button from a row-divider border to the control-border token.
- Focused checks after those corrections passed: 11 `create-acorn-plugin` tests, four Node mount
  coverage tests, 14 client CSS hygiene tests, four plugin-type contract/schema tests, and six TUI
  telemetry tests.
- `pnpm lint`, `pnpm db:check`, and `git diff --check` passed after the final review.

The merged slice-19 baseline records passing GitHub, Linear, and Rollbar controlled provider suites,
dashboard reuse, compiled and loaded plugin paths, workflow publication and file recovery, database
migrations, repository lint, and the same 477-test Workflow suite. This pass does not relabel those
focused checks as connected-account evidence.

The final review ran `pnpm test` with loopback access. The run completed the Node suite with 273
tests, the desktop suite with 103 TypeScript and 36 Rust tests, the Workflow suite with 477 tests,
and the architecture suite with 63 tests. Under repository-wide load, one TUI telemetry assertion
hit its five-second limit; the file passed all six tests alone in 2.89 seconds. The TUI reachability
file then stopped producing output in the repository run. Its isolated run also produced no result
for 90 seconds and was stopped. The root command therefore ended with code 130 instead of supplying
full-suite evidence.

### Evidence still required

- This isolated Node had no configured GitHub repository, connected Linear or Rollbar test account,
  or configured model provider. Manual and AI-authored journeys against those external accounts and
  a connected model remain unverified. The controlled provider fixtures remain green, but they are
  not a substitute for connected-provider or model evidence.
- Native macOS key injection could focus the debug process and resize its window, but neither Apple
  events nor CoreGraphics events reached the debug WKWebView. The native app inventory resolved the
  installed release bundle instead of the bundle-ID-less debug process. Terminal keyboard input and
  component-level desktop keyboard and focus checks pass, but native keyboard-only desktop evidence
  remains unavailable on this host.
- The repository-wide `pnpm test` remains incomplete because the TUI reachability owner stalls both
  in the root run and alone. Focused Workflow, TUI, Node, desktop, schema, and architecture evidence
  is green, but it is not a substitute for a completed root command.

Do not mark this slice or the programme complete until the three items above have recorded evidence.

## Verify before building

Re-read the agreed exclusions and all preceding evidence. A passed build is not proof of publication, checkpoint, or plugin-contract correctness.
