# Performance

A programme, 2026-08-31. Nothing here is scheduled, and nothing in it has started. The desktop
renderer build is red on its own startup budget, which makes phase 0 the only urgent line in the
folder.

Two reads feed one plan:

- [analysis.md](./analysis.md) reads the surfaces: the startup payload measured from the built
  renderer, and the per-event costs of the agent transcript, the diff viewer, the node's request
  paths, and the persister, read from source. Its numbered items carry the detail the phases point
  at.
- [architecture.md](./architecture.md) reads the shapes, from tracing four paths end to end: a cold
  start that gates the window on a complete node boot three processes deep, backpressure that
  amplifies load instead of shedding it, a terminal pipeline that pays continuously for sessions
  nobody watches and pays again on every tab switch, an event firehose whose `term:status` ping
  refetches most of what a client knows, and remount-first switching whose softeners are dead code.
- [phases.md](./phases.md) is the order of work, six phases, each ending in a measurement.
- [refused.md](./refused.md) is what the programme decided not to do, so it stays decided.

## The phases, in one line each

| Phase | What it is | Status |
| --- | --- | --- |
| 0 | Split the icon set out of startup (unblocks the red build) and instrument boot, node requests, and first paint. | Not started. |
| 1 | Open the window before the node boots: helper ready first, paint from the persisted cache, shed the node boot's serial dead weight, stop denying WebKit's caches. | Not started. |
| 2 | Stop the event amplifiers: split `term:status`, filter non-active nodes in the helper, PTY pause with honest `seq` accounting, the task-list N+1. | Not started. |
| 3 | Terminals do work only when watched: gate the headless emulator on attach, chunked ring, hidden-not-unmounted tabs, binary `term:out`. | Not started. |
| 4 | The live surfaces: transcript append and lookup costs, diff hydration granularity, and a real decision on `keepAlive` versus a fast data path. | Not started. |
| 5 | Re-measure, then the deferred arguments (base64 bodies, incremental projection, per-key persistence, an interest model). | Parked behind numbers. |

## How this relates

The budget check this programme unblocks lives in `apps/desktop/scripts/check-renderer-budget.mjs`
and runs inside the desktop build. The event ceiling phase 2 works around is recorded in
[events.md](../events.md); the terminal display contract phase 3 changes is
[docs/terminal.md](../../terminal.md)'s; the transcript decisions phase 4 touches are
[docs/managed-agents.md](../../managed-agents.md)'s. Where a phase ships, its behaviour moves to the
owning doc and the phase row here shrinks to a pointer, the same way every retired programme ended.
