# Terminal updates

A programme, 2026-09-02. Nothing here is scheduled and nothing in it has started. It follows the
terminal programme (`docs/future/terminal/`, deleted 2026-08-31) and the terminal-fixes analysis
(`docs/future/terminal-fixes/`, deleted 2026-09-01), both in git history, and it starts from what
they left: a terminal client whose architecture is right and whose keyboard is not finished.

## The verdict, in a paragraph

The seams are sound. One engine, intents in front of every component, a component table and a
layout table per host, a source-panel seam, a remote-tree seam, a region contract the terminal keeps
while replacing every DOM mechanism under it. Two things are hacked. The asking half of the kit draws
controls and wires none of them, so the pull-request pane's Merge, its composer, and its label chips
are pictures. And the focus store grew six deferred decisions and four flags in fourteen commits to
encode the shell's topology, and now knows the chrome by string. Everything janky a reader has felt
traces to one of those two. [analysis.md](./analysis.md) has the evidence, numbered.

## What is in the folder

| File | What it is |
| --- | --- |
| [analysis.md](./analysis.md) | The read: the boxes and seams as drawn, what is good and stays, and twelve numbered findings with the file each was read from. |
| [focus-model.md](./focus-model.md) | The target: five levels, five key groups, one settle pass, eight invariants, and the pull request walked press by press. Every phase points here. |
| [refused.md](./refused.md) | What the programme decided not to do, with the terminal-fixes refusals carried forward. |
| [phase-0-controls.md](./phase-0-controls.md) | Every control is a stop: `pressable`, the asking nodes wired, `commit` submits, `Select` opens. |
| [phase-1-focus-tree.md](./phase-1-focus-tree.md) | Shipped. A pointer at `docs/tui.md`, plus the five places the design changed on contact. |
| [phase-2-documents.md](./phase-2-documents.md) | Shipped. A pointer at `docs/tui.md`, plus the four places the design changed. |
| [phase-3-tabs.md](./phase-3-tabs.md) | Shipped. A pointer at `docs/tui.md`, plus the two places the design changed. |
| [phase-4-shell.md](./phase-4-shell.md) | Shipped. A pointer at `docs/tui.md`, plus the four places the design changed. |
| [phase-5-extensions.md](./phase-5-extensions.md) | Shipped. A pointer at `docs/tui.md`, plus the seven places the design changed. |
| [phase-6-tests-and-docs.md](./phase-6-tests-and-docs.md) | The invariants as properties over the roster, the footer's words, the doc moves, and deleting this folder. |

## The phases, in one line each

| Phase | What it is | Depends on | Status |
| --- | --- | --- | --- |
| 0 | Wire every asking node so it focuses, shows focus, and acts. The pull request comments from the keyboard. | nothing | Shipped 2026-09-02. Reaching a panel's *second* stop waits on phase 2. |
| 1 | Refactor `keys/regions.ts` into the five-level model with one settle pass and a shell-installed topology. Behaviour unchanged. | 0 for its tests | Shipped 2026-09-02. Five requirements changed on contact; the phase file lists them. |
| 2 | Arrows move between stops inside a panel, page keys scroll, Escape climbs to the parent strip. | 0, 1 | Shipped 2026-09-02. Four requirements changed on contact; the phase file lists them. |
| 3 | `Tabs` with `TabPanel`s is a parent strip without a prop. Linear and Rollbar catch up. `ctrl+N`. | 1 | Shipped 2026-09-02. Two requirements changed on contact; the phase file lists them. |
| 4 | The shell's topology file, the Rail without effects, workspace switch through the settle, `/` filters a descriptor list. | 1 | Shipped 2026-09-02. Four requirements changed on contact; the phase file lists them. |
| 5 | The `ExtendedPane` seam, `rows` as a collection, diff annotation marks, the loss table in `docs/tui.md`. | 0, 2 | Shipped 2026-09-02. Seven requirements changed on contact; the phase file lists them. |
| 6 | Reachability, bounded Escape, one caret, footer truth as tests over every pane; docs rewritten; folder deleted. | all | Not started. |

Phases 2, 3, and 4 are independent of each other once 1 has landed. Phase 0 was the one to do first:
it is the largest change a reader notices and the smallest change to the architecture.

## How to use this folder

Each phase file has the same sections: goal, why, numbered requirements, design notes, files,
tests, acceptance, and doc moves. The requirements are the contract. If the code turns out not to
match a requirement's premise, change the requirement in the file and say why in the same commit,
so the next person argues with a reason. Paths are hints and every phase says to verify them; the
docs path check (`tools/arch/docPaths.test.ts`) refuses a backticked path that does not exist, so a
file a phase proposes is marked `(new)` on its line.

The user-facing test of the whole programme is the worked example at the end of
[focus-model.md](./focus-model.md). When that sequence passes as written, at 100 by 32, with the
footer saying what each line says, the programme is done and the folder goes.

## What this touches elsewhere

- `docs/tui.md` owns the terminal client and is the destination for every behaviour here. Its
  §§ Keys and focus and What a plugin loses here are the sections that change most.
- `docs/command-palette-and-shortcuts.md` § Focus and typing owns the shared rules and keeps them;
  its terminal paragraphs shrink to a pointer.
- `packages/client-core/src/kit/tokens/focusRoles.ts` and `support.ts` are not edited. The programme
  makes the code agree with them.
- `docs/future/client-plugins/04-replaceable-surfaces.md` owns the host UI slots this programme
  leaves undrawn.
- `docs/future/dashboards/README.md` owns the `pane.aside` region this programme leaves undrawn.

## Verify before building

- Read [phase-1-focus-tree.md](./phase-1-focus-tree.md) § Where the design changed first. Five of its
  requirements did not survive contact, and phases 2 to 6 were written against the versions that lost.
- Read [phase-2-documents.md](./phase-2-documents.md) § Where the design changed. Phase 5 was written
  against a `stopsIn` that walked into a strip's panels and a `Card` that was walked into; neither is
  true. `moveStop` walls at an edge and `moveFocusFrom` does not, and a strip's Down binding still
  uses the second.
- A strip's panels are no longer a prop. `apps/tui/src/kit/grouping.tsx` § Which panels a strip owns
  keys them by `idPrefix`, so a phase that wants a new kind of panel registers it there rather than
  threading a getter through a caller.
- `packages/client-core/src/host/chrome/extendedPane.ts` is the `ExtendedPane` seam and
  `apps/tui/src/plugins/ExtendedPane.tsx` is this host's. Phase 6 asserts over the roster; a pane that
  reserves a region reaches the terminal through that seam and through no other.
- Region ids in the chrome now come from `apps/tui/src/chrome/topology.ts`, which exports one `RegionRef`
  per region as well as the topology itself. Phase 6 asserts over the roster, and a test that spells
  `{ paneId: 'chrome', regionId: 'browse' }` by hand is spelling one of those a second time.
