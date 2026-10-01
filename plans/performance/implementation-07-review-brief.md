# Unit 07 coordinator review brief

Source review on October 1, 2026. This supplements report 04. Start only after unit 06 is reviewed.
The Node Terminal engine owns byte retention, session roster publication and PTY attachments.
`RuntimeService` owns declared task/target admission. Keep those lifetimes separate from client
visibility and the custody viewer lease added in unit 03.

## Raw output

Use lazily allocated bounded byte blocks with constant-time head movement. A cursor over the old
callback array fixes shifts but leaves the measured allocation problem. Preserve `push(string)`,
the exact final 256 KiB raw byte tail and `tail(bytes)` decoding once after joining. Test UTF-8
characters crossing block boundaries, budget-head cuts, oversized input, empty input, clear wrap,
tiny callbacks and repeated overflow. Avoid retaining an oversized backing allocation through a
small slice. Do not replace canonical screen reset/snapshot ordering or shrink supported output.

Use the actual `OutputRing`, display and installed xterm in before/after probes. Preserve ordinary
4 KiB costs alongside the reachable 8-byte case and 1-byte stress. Report heap and ArrayBuffers
separately. The earlier callback-size PTY fixture proves reachability, not provider distribution.

## Declared targets

Install per-task/target operation ownership before any config, trust or hook await. Coalesce Start
and order Stop and Restart against it. Keep unrelated keys concurrent and preserve per-caller
authorization at HTTP/capability boundaries. Release every settled operation identity, including
veto/failure paths; do not leave a promise cache. Avoid nested locking in fallback Restart.

The current fallback Restart ignores every Stop failure. Preserve the intended cold-start allowance
for an absent instance, but do not spawn after a failed explicit stop script. Check natural exit
before spawn resolves, disposal during each held dependency, and generation-safe late results.
Disposal must not publish an instance or execute a previously queued action against a stopped
engine. Work that already creates a session needs explicit attachment ownership cleanup, preserving
the durable tmux contract. Exit notifications must not duplicate explicit-stop notifications.

## Roster and engine retirement

Publish successful create/remove/task-drop structure at the engine owner. Remove duplicate wrapper
publications from setup, run-target and teardown. Successful unknown removal emits nothing. A failed
durable row deletion cannot hide an already changed authoritative memory roster; batched archive
drop must still notify once when any mutation occurred. Keep machine-rate activity and human-rate
worktree invalidations on their existing narrow channels.

Store and dispose PTY data/exit callback handles and pending flush timers, with engine/session
identity guards. `killSession` also kills the tmux server session, so it is not the correct helper for
ordinary engine shutdown. Close only the Node-owned tmux attachment child on shutdown, preserving
the detached session and its metadata for reconcile. Define ephemeral PTY teardown separately.
Read `runTeardown`'s extra exit callback and deadline too: removing engine listeners must not strand
its promise or timer. Late old output/exit must not reach replacement engine state.

For a real tmux attachment gate, use a fixture-owned server socket and synthetic session. A narrow
fixture launcher can select that socket while exercising the engine's actual PTY path. Verify ordinary
engine retirement removes its attachment child while the detached session remains, then explicitly
remove the fixture session/server. Do not list or kill the user's default tmux server. If tmux is
unavailable, preserve the exact fixture gap and prove attachment versus durable-session calls at the
injected process seam.

Use the actual session engine and a two-reader lifecycle test: removal event, successful roster
read, held xterm and subscription retirement. Unit 05's failed-roster retention and same-Node warm
attachments remain intact. Reconcile can publish once after its batch. Preserve session history,
the four-WebGL-context policy, optional attach geometry and ready fallback. Parser credits,
snapshot queue caps and blanket hidden-terminal detachment remain unselected.

Return a teardown/operation proposal before editing. Capture fresh cumulative pre07 sources and
owner probes, then focused lifecycle/UTF-8/display/route tests, docs, lint/types and measured after
artifacts. The coordinator owns final native and cumulative gates.
