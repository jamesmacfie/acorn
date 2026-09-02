# Terminal keyboard

**Shipped 2026-09-02. All seven phases are in the tree and this folder is kept only so that the
design record can be committed before it is deleted**, which is the convention every retired folder
here relies on: `docs/future/README.md` § Retired folders already carries the paragraph saying where
each of the five rules went, and [tui.md](../../tui.md) § Keys and focus owns the behaviour. Delete
this folder in the commit after the one that adds it. Nothing below has been rewritten, so the
statuses in the phase table and every line number are as they were on the day the plan was written.

A programme, 2026-09-02. Nothing here is scheduled and nothing in it has started. It was written
against commit `bf53e5ab`, which is the baseline every line number in the folder refers to.

The terminal client's keyboard was reported as inconsistent: the plugin trust dialog opens at start
and cannot be answered, the rail looks selected after entering the terminal pane but does not
respond, Left and Right mean different things in different places, Tab sometimes does nothing, and
keyboard scrolling loses the caret. The focus model under it had been rewritten at least ten times
in three days, each time correctly, for a bug somebody saw. This folder is the review that asked
what the rewrites had in common, and the plan that changes the structure rather than adding an
eleventh fix.

The finding in one sentence: five reports, four structural faults, and one scrolling fault.

- The renderer and the app keep two separate records of what has focus. One routes keys, the other
  draws highlights, and they drift.
- A dialog contains the keys by swallowing a list of them, and the list is the wrong list, so Tab
  leaks out of every dialog.
- Where focus lands after a change is decided by a seven-step pass over four global flags, ordered
  by accident.
- Which handler answers a key is decided by a dozen priority numbers, and two handlers claim keys
  they do nothing with.
- Five places use a clipping instruction as if it scrolled.

## The files

- [symptoms.md](./symptoms.md) traces each of the five reports to the line that produces it, with
  confidence, a reproduction, and the test that would have caught it.
- [architecture.md](./architecture.md) is the as-is read: what OpenTUI 0.5.9 provides and does not,
  the path of a key, the tier table, the two sources of truth, the three overlay registries, the
  settle pass as a state machine, and the size of the surface.
- [design.md](./design.md) is the target: five rules, one per fault, the data model, the tier table
  after, the key-by-key contract, eleven invariants, and the trace flag.
- [phases.md](./phases.md) is the order of work: seven phases, each with steps, files, what must not
  change, and the checks a reviewer runs.
- [testing.md](./testing.md) is how to test it: the two harnesses, how a key is pressed, the Node
  floor that makes a green run lie, `it.fails` scenarios, and the checks that are not tests.
- [refused.md](./refused.md) is what the programme decided not to do, and the one earlier refusal it
  reverses.

## The phases, in one line each

| Phase | What it is | Rule | Status |
| --- | --- | --- | --- |
| 0 | The trace flag, the renderer-agrees-with-store assertion, and six failing scenarios pinned as `it.fails`. | invariants 9 to 11 | Not started. |
| 1 | The renderer is the only truth: one listener writes the store, one function moves focus, no bridges. | 1 | Not started. |
| 2 | A trap is a scope: every walk answers inside the top scope, the swallow layer is deleted. | 2 | Not started. |
| 3 | One landing rule replaces the seven-step settle pass; one walk replaces three. | 3 | Not started. |
| 4 | Named tiers, honest claims, integer columns, and the key contract as a test. | 4 | Not started. |
| 5 | Anything that can exceed its box is a viewport; page moves clamp; reveal after layout. | 5 | Not started. |
| 6 | The rectangle leaves when it loses focus; `docs/tui.md` rewritten; folder retired. | rectangle | Not started. |

Phases 0 to 3 are ordered. Phases 4, 5, and 6 are independent of each other once 3 has landed.

## For the developer picking up a phase

Read `design.md` first and `symptoms.md` second. Then the phase. Every step names a file and a
line at the baseline commit; open the file before trusting the line. When a step is done, run the
checks under "Done when" and nothing else counts. If a fix seems to need a new settle step, a new
flag, or a new priority number, stop: `refused.md` says why, and `design.md` names the rule the fix
is bending.

## How this relates

`docs/tui.md § Keys and focus` owns the terminal keyboard and wins wherever this folder disagrees
with it. `docs/command-palette-and-shortcuts.md § Focus and typing` owns the intents and the layer
tiers shared with the desktop. The retired `terminal-updates/` programme (2026-09-02) built the five
levels, the settle pass, and the reachability property this folder inherits; its refusals are
carried in `refused.md`. `docs/testing.md § Test layers` owns the test tiers `testing.md` sits in.
Shared code this programme touches is `packages/client-core/src/kit/keys/collectionIntents.ts`, in
phases 4 and 5, and the desktop gets those changes too.

When a phase ships, its behaviour moves to the owning doc and its row here shrinks to a pointer. When
phase 6 ships, the folder is deleted and `docs/future/README.md § Retired folders` says where each
rule went.
