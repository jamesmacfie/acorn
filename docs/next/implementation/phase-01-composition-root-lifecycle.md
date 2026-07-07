# Phase 1 — Composition root and lifecycle

**Status:** planned · **Depends on:** none · **Gated by:** performance baseline
for boot paths · **Primary docs:** [review](../review.md) §2,
[performance](../performance.md) §3.1 and §3.6.

## Goal

Create one explicit main-process composition root. Today `registerTerminalIpc`
is effectively `main()`: it registers terminal behavior plus knowledge, runtime,
harness bridges, workflow IPC, local git, database IPC, and reconciliation. The
HTTP listener also starts before all bridge wiring exists.

After this phase, boot order, bridge installation, reconciliation, and shutdown
are visible in one place and reversible in one disposal chain.

## Architectural Context

The root owns construction order. Domain modules own behavior.

Target flow:

```text
electron.ts
  -> bootstrap()
     -> migrate database
     -> construct domain services
     -> install bridges/routes/registrars
     -> start loopback listener
     -> create window
     -> reconcile durable state off the paint-critical path
     -> on will-quit, dispose in reverse order
```

`terminal.ts` becomes the PTY engine. It should not know that knowledge,
workflow, database, local-git, or harness domains exist.

## Required Context

Read these sections before implementation:

- [review.md](../review.md) §2 describes the accidental composition root and
  the risks created by wiring through global mutation.
- [review.md](../review.md) §7 names vestigial abstractions; do not preserve
  old Workers-era layering if moving wiring exposes a simpler direct boundary.
- [extensibility.md](../extensibility.md) §2.3 defines main-process core; §3.2
  defines activation and lifecycle expectations the composition root must later
  host.
- [performance.md](../performance.md) §3.1 requires baseline boot marks before
  boot paths move; §3.6 defines the target boot policy.
- [security.md](../security.md) §2 lists loopback/session invariants that must
  survive boot-order changes.
- [testing.md](../testing.md) §1 defines the smoke tests that should eventually
  prove boot and quit behavior.
- [docs-overhaul.md](../docs-overhaul.md) §2 names the architecture and Electron
  docs that become stale when boot ownership changes.

The root owns construction order and lifecycle only. Domain modules keep domain
behavior. If the root begins to know product rules rather than service
dependencies, this phase has crossed the wrong boundary.

## Implementation Plan

1. Add `apps/desktop/src/main/bootstrap.ts`.

   It exposes `bootstrap()` and owns:

   - database migration and connection construction;
   - domain service construction;
   - bridge installation;
   - loopback listener startup;
   - window creation;
   - ordered `reconcile()`;
   - reverse-order disposal.

2. Route `electron.ts` through `bootstrap()` once.

   The first PR should be a thin wrapper around the existing sequence with no
   domain behavior moved yet. This creates a safe diff boundary.

3. Move wiring out of `terminal.ts` one domain at a time.

   Move registration of knowledge, runtime, local-git, database, harness,
   worktree, and workflow wiring into the root. Replace module-global setter
   mutation with constructor/setter injection performed by the root.

4. Add coordinated `reconcile()`.

   Include tmux resurrect, worktree prune, workflow resume, and any existing
   run-from-root recovery. Policy: window as soon as the listener is up;
   reconciliation runs after window creation and off the critical path.

5. Add shutdown.

   On `will-quit`, end pg pools, clear terminal idle-watch intervals, and
   dispose root-constructed services in reverse construction order. Phase 5's
   will-phase confirmation runs before this teardown once it exists.

6. Add timing logs.

   Log migration, listener-up, reconcile substeps, and teardown into the
   observability log described by [performance](../performance.md) §3.1.

## Design Guardrails

- **Extensibility:** every later registry/projection needs one host to install
  and dispose contributions. Shape `bootstrap()` around contribution activation,
  even before plugins exist.
- **Simplicity:** start with a thin wrapper and move wiring one domain at a
  time. Avoid redesigning terminal, workflow, or database behavior while moving
  ownership.
- **Robustness:** listener startup must happen after bridge/route installation
  and before non-critical reconciliation. Quit must tolerate partially
  constructed services.
- **Maintainability:** disposal order should mirror construction order in one
  visible chain, not rely on module-level cleanup side effects.

## Slice Order

1. Thin `bootstrap()` wrapper and boot timing logs.
2. Move one wiring domain at a time from `terminal.ts` to the root.
3. Add coordinated `reconcile()`.
4. Add reverse-order disposal and quit logging.

## Acceptance Criteria

- `electron.ts` calls `bootstrap()` once.
- The bootstrap file shows the ordered phases: migrate, construct, install,
  start listener, create window, reconcile, dispose.
- `terminal.ts` no longer imports unrelated domains.
- No `set*Bridge` call occurs after the listener starts.
- The listener starts only after bridge wiring is installed.
- Quit runs a logged teardown.
- Teardown is idempotent enough that a failed partial boot can still dispose the
  services that were constructed.
- The 503 fallback in bridge routes remains until Phase 4 deletes it.
- Boot policy matches [performance](../performance.md) §3.6: migration before
  listener, window before accumulated reconciliation work.
- Boot/reconcile timing marks are captured before and after the phase, and
  regressions are either fixed or documented with a concrete reason.
- Updated Electron/architecture docs describe the composition root as the
  shipped boot path, not as a proposal.

## Verification

- Capture boot marks before the phase and compare after.
- Launch the app, use a task end-to-end, then quit cleanly.
- `pnpm lint`
- `pnpm test`
- Smoke S1 and S5 once the smoke suite exists.
- Grep checks:
  - `electron.ts` has one bootstrap call;
  - bridge setters are installed before listener startup;
  - `terminal.ts` does not import other product domains.

## References

- [review.md](../review.md) §2 and recommendation #4.
- [extensibility.md](../extensibility.md) §2.3 and §3.2.
- [performance.md](../performance.md) §3.1 and §3.6.
- [security.md](../security.md) §2.
- [docs-overhaul.md](../docs-overhaul.md) §2 for `docs/architecture-overview.md`
  and `docs/electron.md`.
