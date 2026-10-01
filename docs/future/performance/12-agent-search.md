# Streamed search projection and recovery

Date: October 1, 2026. Status: pending implementation; unit 12.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–11, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 09](../../../plans/performance/09-agent-node.md).

The original [unit brief](../../../plans/performance/implementation-12-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. This supplements report 09 and the implementation plan. Start
only after preceding units pass coordinator review, and return the projection proposal before editing.

## Canonical ledger and search documents

`recordEvent` commits eventJson, the session sequence, turn/request projections, and derived search
text transactionally. A continuing append currently concatenates the entire head's search_text;
migration 0005 deletes and reinserts the entire head in FTS on each update. The canonical append
events themselves remain complete. Preserve that ledger and all committed sequences; derived work
can move to an owned projector without making event durability depend on a mounted client.

The continuity rule is consecutive sequence, compatible event type, turn ID, and message identity.
The migration and DurableAgentEventBuffer agree on it. A tool event or incompatible event separates
documents even when a later append has a repeated message ID. Preserve words split across append
boundaries and whole-document phrase, tokenizer, stemming, prefix, and ranking semantics. Splitting
long messages into arbitrary bounded FTS documents changes those semantics and is not selected.

Return a concrete design for durable dirty progress, head identity, append materialization, query
barriers, stream-close/shutdown flush, and recovery. Name the bounded transient owners and explain
how repeated full-head SQL concatenation and FTS replacement are reduced. Scheduling FTS later while
still rewriting search_text on every append only removes part of the measured work. Measure both.
One provider's callback not awaiting persistence must not bypass the durable buffer's sequence order.

## Read and ranking barriers

Both `searchSessions` and `searchTaskSessions` read the same FTS table. The latter also constructs
snippets from selected FTS rowids. Catch up all documents whose changes can affect ranking before
querying, including documents outside a later task filter that affect the FTS corpus statistics.
Synchronize ranked results and snippet lookup against relevant projection mutations so they cannot
silently describe a different head generation. Keep task/workspace authority in CoreServices and
plugin-owned joins. Preserve tool weighting `bm25(0, 0, 1.0, 0.3)`, tokenization `porter unicode61`,
filter semantics, title/artifact matching, preview content, and documented tie behavior.

Client stripping of searchText is insufficient evidence for changing raw readers. `store.snapshot`,
event pages, `exportSnapshot`, runtime wait, workflow/export consumers, and repository tests still
observe raw event records. `managedBridge` intentionally strips the field only at client boundaries.
Inventory every raw consumer and propose when the full derived head is brought current for those
contracts. Returning partial searchText from a formerly complete raw export is a contract regression.
Avoid forcing every streamed client event through a full-history reconstruction to preserve a field
that the client boundary discards. Place completeness at the actual owner of the raw read.

## Migration and recovery

Append a migration. Do not rewrite migration 0005 or any applied SQL. Coordinate FTS schema, content,
triggers, and schema-drift guards together. The existing index uses event rowids plus event IDs because
VACUUM can renumber rowids; preserve equivalent repair and identity behavior or introduce an explicit
stable derived key with a verified migration. Deletion must remove pending work and indexed content
without resurrecting a deleted session through a held projection task.

A missed dirty commit, interruption during catch-up, missing/corrupt derived index, stale progress,
and migrated old databases need explicit detection/rebuild behavior. Canonical eventJson is the
authority for recovery. A timer or in-memory set alone cannot preserve current search after restart.
Do not remove the direct insert/update/delete projection guarantee without locating all writers and
documenting the replacement ownership contract. Test actual migrated SQLite objects, not mock ranks.

## Evidence

Use fresh cumulative pre-unit-12 artifacts and the actual production writer, projector, and search
entrypoints. Compare 16/64/256 committed 16 KiB chunks with final search, intermittent search, and
search after every commit. The last workload may retain full-document indexing cost; report that
tradeoff. Record CPU, elapsed time, statement/write counts, exact final text, and logical rewrite
bytes separately from measured filesystem bytes. Include multiple dirty sessions, interleaving,
boundary-split words, tool and conversation weighting, tied ranks, current-head previews, deletions,
restart, migration, index repair, and canonical page/export completeness. Preserve existing client
event stripping and sequence-page bounds. No real provider work is needed.

## Completion and handoff

Implement only the reproduced issues within this assignment. Return any explicitly requested
compatibility, migration, or custody proposal to the coordinator before changing that contract.
Use current production owners for paired evidence; preserve historical fixtures and label superseded
baselines. Write an implementation record with changed files, exact commands and outcomes, before
and after comparisons, costs, and concrete remaining limitations. Update the owning shipped docs
when behavior changes. Retire all disposable resources before review. Do not start the next unit.

## Verify before building

- Re-read the merged source and applicable engineering instructions; the audit predates the main merge.
- Confirm prior units' contracts and actual callers still match this proposal.
- Resolve the listed owner, capability, data model, migration, and compatibility decisions before editing.
- Verify a single Solid runtime and normal QueryClient provider for browser measurements.
- Capture fresh source/probe hashes and the same supported workload on both sides of the change.
- Preserve canonical content, offline rows, unsent drafts, and independent Node authority.
- Run relevant tests and types, then coordinate cumulative lint, bounded tests, and real UI checks.
