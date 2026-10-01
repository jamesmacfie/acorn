# Shared pull request comparisons and marker identity

Date: October 1, 2026. Status: pending implementation; unit 15.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–14, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 11](../../../plans/performance/11-git-filesystem.md).
- [Investigation 12](../../../plans/performance/12-editor.md).

The original [unit brief](../../../plans/performance/implementation-15-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read reports 11 and 12 and reviewed unit 14 freshness/path owners.
Start after preceding units pass coordinator review. Return the marker revision proposal before
changing its public editor contribution or wire contract; unit 16 must consume the same identity.

## Shared PR comparison waves

Each `pullRequestEditorLineMarkers.read` independently resolves the authorized root and user-scoped
mirror, verifies PR head and base refs, and finds a merge base. Eight overlapping file reads repeat
32 common Git commands before their 16 path-specific diffs. Share only matching common work within
an owned in-flight wave. Resolve authorization and mirror/user facts before joining by root and PR
identity. Fresh requests after a wave must resolve refs again; a mutable baseRef string is not an
immutable commit identity. Failed waves must not pin rejected promises or stale mirror facts.

Keep immutable PR-head provenance distinct from local HEAD, later commits, and uncommitted edits.
Per-file worktree translation remains fresh even when common facts join. Preserve branch validation,
remote/local fallback order, exact SHA checks, command deadlines, no external diff execution, and
missing-ref/optional-provider behavior. An empty contributor result is not a license to claim no
local edits. Bound idle common-cache state if any completed reuse is proposed, and prove invalidation
for mirror changes, branch movements, authorized root changes, and rejected waves first.

## Marker body identity

EditorPane initially requests body, grammar, and markers concurrently. It can later reuse a cached
CodeMirror state and refresh markers after two seconds. Matching task/path or active tab alone does
not establish that those markers describe the exact displayed body. The contribution contract says
one-based ranges in the current working-tree document. `editor.ts` applies confinement before
providers but returns no body/revision identity. A response after local typing, save, reload, or
external modification can therefore annotate a different revision.

Define source identity at the Node/file boundary and displayed revision identity at the editor/host
document boundary. A request's local generation fence prevents late publication but does not itself
prove a concurrently read disk body matches provider output. Explain the initial body/marker pairing,
before/after disk checks while Git runs, local unsaved text policy, and how stale markers are rejected
or retried without clearing correct current markers. Preserve provider independence: providers return
provenance; the editor owns displayed body custody. Keep standalone/loaded contribution compatibility
and old-Node/new-client behavior explicit. Do not silently widen providers' filesystem authority or
use a restored mtime as exact body identity.

Unit 16 will own full editor save, reload, and document recovery lifetimes. Scope this unit to the
shared comparison and marker identity seam, with meaningful exact-body tests rather than duplicating
the later save architecture. If an additive read/marker request format is required, trace server API,
route capability, protocol/plugin exports, captured-Node client, host document and both renderer
consumers before implementation.

## Evidence

Use fresh cumulative pre-unit-15 artifacts and actual provider Git commands on disposable repos.
Eight concurrent reads should share common comparison work while each path's translation remains
exact. Move base/PR/local refs, alter a same-size file with restored mtime, change user/mirror/root,
reject a held wave, and verify a subsequent wave is fresh. Preserve exact changed/translated ranges,
insert/delete/replacement semantics, no local-only insert receiving PR provenance, and optional
provider failure behavior. Hold marker replies across edits, save, reload, Node switch, disposal,
and cached-document return; only matching body/revision markers may publish. Distinguish removed
command counts from native UI latency or child Git CPU.

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
