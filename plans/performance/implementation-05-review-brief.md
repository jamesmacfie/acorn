# Unit 05 coordinator review brief

Source review on October 1, 2026, while unit 04 implements persistence. This is an assignment aid,
not an implementation record or proof that the changes are complete. Read report 07 and the shared
implementation contract first.

## Boundaries and dependencies

Unit 03 owns physical sockets, logical viewer leases, active renderer interests, reconnect intent,
and targeted cleanup transport. Do not rebuild these. `wsSendToNode` carries a captured target;
its `cleanup` option must not reacquire a retired viewer. Unit 04 owns QueryClient origin identity,
preference serialization and restoration. Use its final public ownership seam where needed. Unit 27
owns complete TUI Node selection composition; shared changes must remain usable there.

Keep one current task model per pane, shared across its independently mounted regions. Do not turn
the model map into a cache of every visited Node/task. Capture model and drawn ownership before
asynchronous rendering or callbacks, and dispose outgoing observers before incoming construction.
Node-qualified reading positions remain a separate owner.

Distinguish region/pane removal from destruction of the Node's shell/provider. Detached models must
survive the former and retire with the latter. Any composition cleanup must capture the outgoing
scope, so its late execution cannot clear B. Keep the owner implementation in the pane registry;
an explicit host lease/retirement seam is preferable to exporting a test reset as lifecycle policy.

## Source observations to resolve

- `paneModels.ts` compares task ID only, inherits its constructing QueryClient context, and ignores
  Node eviction. Its drawn keys also omit Node identity. A throwing builder may leave a partially
  constructed detached root: include a transactional disposal guard when changing this owner.
- `setActiveNode` publishes the signal before emitting eviction outside a Solid batch. The comment
  saying provider remount waits for the next tick is false in the audited composition. Preserve
  unit 03's interest call and the event contract: listeners see B while outgoing A is still drawn;
  incoming B builds after teardown. Selection and remembered-device write belong in that batch.
- `notesApi()` returns a singleton whose HTTP methods read the ambient Node at delivery. Model
  cleanup flushes only body debounce; title debounce survives, and neither request nor publication
  is qualified by origin/generation. Bind every model operation to its originating Node. Bare null
  must retain unit 04's captured no-target semantics. Late reads, scratch creation, list refreshes,
  save acknowledgements and title callbacks must not overwrite a newer selection/model.
- Notes selection memory is currently keyed only by task. Qualify it by origin and capture that
  origin for async remember calls. Preserve same-Node return behavior and task archive cleanup.
- Notes body/title writes can overlap and a successful old save can clear the current error/saving
  state. Characterize exact revision acknowledgement and serialize/coalesce per document as needed.
  Pending or failed supported text/title must survive model retirement and be recoverable on return;
  avoid arbitrary dirty-draft caps or a broad editor rewrite. Unit 16 owns the general host editor.
- `terminalApi()` remains ambient. `liveXterm` accepts Node identity but does not use it to bind HTTP,
  input, attach or resize. Bind its API and cleanup to the captured Node; old rAF/resize callbacks must
  not write into B. `TerminalPanel` async profile/create/close callbacks also need disposal/origin guards
  where this lifetime change exposes them. A successful old creation may remain on A's durable roster,
  but must not focus or mutate B's drawer.
- Hidden tabs and parked task terminals on the same Node retain live attachments and xterms, which
  is shipped warm-navigation behavior explicitly preserved by report 07. Retire outgoing Node
  consumers through their captured target and unit 03's viewer lease. A late unmount must not detach
  a newly mounted surface borrowing the same terminal. Blanket same-Node hidden detachment remains
  conditional: the canonical screen rebuild uses a bounded raw ring, can lose older scrollback or
  alternate-screen setup, and adds parser/restore work on return. Reducing that work needs evidence
  and an exact continuity contract before it can replace the current inexpensive repaint.
- `sessionStore` primes immediately from active Node and clears on the eviction event. Verify actual
  ordering under the batch: incoming sessions, focus and registrations must survive. Failed roster
  reads must not be interpreted as authoritative session deletion.
- TabRail parses `railOrder` in row targets and marker getters. Parse once per changed preference,
  share pin membership, and preserve reactive contributed markers and row DOM. Full flat hierarchy
  and project scans are inexpensive in the audit; avoid an unmeasured hierarchy rewrite.

## Proof

Replay changed actual owners, including the actual TabRail, with preserved before artifacts. The
old terminal sink probe waits for 128 forwarded inactive frames and cannot be used unchanged after
unit 03 or this repair. Adapt it explicitly, or use a joined channel/broker/hub fixture. Count initial
and return canonical snapshots, live sinks, forwarded hidden output, final cleanup, model roots and
QueryClient observers. Keep retained xterm identity assertions.

Capture a cumulative pre-unit-05 fixture before editing so gains from units 03 and 04 remain
attributed to their owners. Existing original report artifacts are retained separately. In particular,
modern renderer interest retirement already removes inactive Node forwarding in unit 03; unit 05
must verify captured channel cleanup and composition rather than claim that same gain a second time.
The display already prefixes canonical snapshots with `DISPLAY_RESET`; preserve its ordered
ready/reset/snapshot/live-output contract and test with real xterm parsing where relevant.

Use meaningful held-read/write and A/B colliding-ID tests, title cleanup, exact acknowledgement,
failed-draft return, duplicate acquire/release and late surface cleanup. Final native gates need real
Tauri snapshots and inspected screenshots. The baseline focus bundle succeeded in native/document
focus queries, but clicking Terminal and the following snapshot timed out; that is an open driver or
renderer issue, not a measured latency. Coordinate staging and a bounded isolated reproduction with
the coordinator. Do not inspect the normal app or use stalled Computer Use.
