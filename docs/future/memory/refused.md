# What simple memory refuses

Status: proposed, 2026-10-01. Each entry says what was considered, why it is out, and what would make
it worth revisiting.

## Review before a memory lands

The shipped design's core rule. A review gate is what stopped memory from accumulating: agents
proposed, bundles waited, and three memories reached the Acorn project in the time Claude Code's
direct-write folder reached 183. Review moves to beside the write, as a transcript card with **Undo**
and a change feed on the Memory page.

Revisit if phase 1's measurement shows agents saving so much noise that undoing it costs more than a
queue would, or when team memory in [phase 4](./04-teams.md) needs a gate for shared writes.

## Capturing memory from transcripts, terminals, or diffs

Findings read completed turns, terminal tails, archive diffs, and workflow handoff notes, then asked a
model to prepare candidates. It needed a configured backend and model, cost a model call per task, and
produced candidates a person then had to read. The agent in the session already knows what it learned,
and it can write that down at the moment it learns it for no extra call.

Revisit if sessions that end without saving anything turn out to have lost something a person had to
teach again. The cheap first answer would be a closing instruction in the contract, not a pipeline.

## A search index

The shipped design keeps a SQLite full-text index, reconciled from the private folder, every active
worktree, and every primary checkout before each read. It also keeps recall counters for a decay model
that was never built. A file scan over a few hundred small files is fast enough, and the index in the
prompt is the main recall path anyway.

Revisit if a single scope passes about 2,000 memories, or a scan measurably slows `memory_search`.

## Semantic or vector search

It needs an embedding provider, a store, and a re-index path. The index in the prompt lets the agent
pick by description, which is the same judgement a vector search approximates.

Revisit only after a keyword scan fails on real queries, with examples.

## Per-agent memory folders

Lemma gives each agent a shared folder and a private folder of its own. Acorn has custom agents, and a
per-agent folder would let a reviewer agent keep notes a coding agent never sees. Nothing asks for it,
and it doubles the scopes and the caps.

Revisit if custom agents in real use keep writing memories that only make sense for themselves.

## Reading repo-local `.acorn/memory` folders

The shipped design reads a `.acorn/memory` folder in each worktree and checkout, so a team can commit
shared memory. Repository guidance already has a home every harness loads, `AGENTS.md` or `CLAUDE.md`,
and reading every worktree on every call is part of the reconciliation cost. Phase 3 imports what is
there once.

Revisit if teams without Acorn accounts ask to share memory through the repository.

## An agent-maintained index

Lemma lets the agent edit `AGENTS.md` by hand, which needs cache invalidation and still drifts from
the files. A generated index cannot drift.

Revisit if agents need to group or annotate index lines in ways a generated list cannot express.

## Consolidation, deduplication, and contradiction detection

Each is a model call or a heuristic with its own failure modes, and each makes the store harder to
predict. The contract asks agents to update rather than add, and the owner can merge by hand.

Revisit if duplicate or contradicting memories become a recurring complaint with examples.

## Moving memory into the data root

Memory lives in `~/.acorn/memory`, outside the Node's data root, so it is shared by every Node on the
machine and missed by the data root backup. Moving it would be cleaner, but it breaks the path the owner
edits by hand, for no gain a single owner would notice.

Revisit in [phase 4](./04-teams.md), where project memory moves to the team Node anyway, or earlier if
development sessions turn out to write into the real store.
