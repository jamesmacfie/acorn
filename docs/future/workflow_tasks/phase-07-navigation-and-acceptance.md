# Phase 7: Navigation and acceptance

Date: 2026-09-13. Status: shipped.

The workflow-task programme is complete. See the owning documentation for the current contracts:

- [Workflows](../../workflows.md) describes child runs, map progress, gates, failures, usage,
  cancellation, retries, events, and navigation.
- [Workspaces and tasks](../../workspaces-and-tasks.md) describes child task ownership, worktrees,
  and retention.
- [Security model](../../security.md) describes trust, confinement, and inherited authority.
- [API reference](../../api-reference.md) and [data layer](../../data-layer.md) describe the internal
  idempotent start capability, projections, and durable records.
- [Testing](../../testing.md) owns the manual release checklist.

Runtime child-workflow dispatch remains enabled because every automated release gate passed. The
scheduled-workflows programme can use `workflows.runner` with a reserved task ID, intended run ID,
caller key, payload fingerprint, and trigger. Retrying the same invocation returns the existing run.

## Acceptance evidence

- The structured ticket fixture ran a generated workflow and a hand-authored TOML workflow through
  the same resolver, dispatcher, and runner. Both produced the same child prompts and inputs. A
  restart during the human gate preserved the intended task and run IDs and created no duplicate
  child work.
- The workflow plugin suite passed 345 tests in 34 files.
- `pnpm lint` passed in all 33 linted packages.
- `pnpm db:check` applied every migration in all 11 chains, including all five workflow migrations.
- The architecture suite passed 63 tests in four files.
- `pnpm test` passed all 34 package tasks. The TUI suite included 584 passing tests and two documented
  skips; the desktop suite included 101 client tests and 31 Rust tests.
- `git diff --check` passed.

The five realistic UI checks in [Testing](../../testing.md) were not run from this worktree. The app
needs the main checkout's environment, and its development port was already owned by the live
instance. Component, host-parity, event, reconnect, integration, and terminal-rendering tests cover
the corresponding automated contracts. Run checklist items 65–69 from the main checkout before the
next release.
