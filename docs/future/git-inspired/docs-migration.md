# Docs migration: owners after each phase

Status: proposal, 2026-09-26. No owning document has been changed for this programme.

Part of [docs/future/git-inspired/](./README.md). A phase is incomplete until the document that owns
its shipped behavior states the new contract. Future files explain intent; owning docs describe the
running system.

## By document

| Document | Phase | Section | Required change |
| --- | ---: | --- | --- |
| `docs/future/README.md` | now | Programmes table | Add this folder, its six phases, and “not started.” |
| `docs/architecture-overview.md` | 2 | Runtime/package map and client data flow | Add the runtime-neutral diff-document package; show provider-side topology/segment production and client-core consumption without provider leakage. |
| `docs/diff-rendering.md` | 2 | Source port | Replace whole-file `files`/`cachedFile`/`fetchPatches` with topology, segment, block-content, search, and overlay operations; name all three producers. |
| `docs/diff-rendering.md` | 2 | Parsing and highlighting | Structure on the provider/Node side, segment limits, plain-first publication, visible-range loading, enrichment generations, and no drain-to-end queue. |
| `docs/diff-rendering.md` | 2 | Data flow, modes, find, annotations, gaps | Exact descriptor geometry, segment canvas, split counts, server/document search, visible annotation requests, selected anchors, collapse, and overlay segments. |
| `docs/diff-rendering.md` | 3 | Row geometry and review threads | Fixed plus dynamic equation, index ownership, measurement scheduler, fingerprints, width buckets, direct-visible exception, and identity correction rules. |
| `docs/diff-rendering.md` | 4 | New § Resident segments | Cache keys, per-node ownership, row/byte budgets, pins, oversize behavior, and warm revisit. |
| `docs/github-integration.md` | 1 | PR detail and files mirror | Every paged connection, REST 3,000-file ceiling, stage-then-swap, stored completeness, explicit file order, patch state, and patch content digest. |
| `docs/github-integration.md` | 1 | Compare/create PR | GitHub compare's 300-file ceiling and the incomplete preview behavior. |
| `docs/github-integration.md` | 2 | Diff data flow | GitHub topology, content-addressed plain segments, revision matching with threads, segment/body/search routes, and compare document production. |
| `docs/github-integration.md` | 5 | Conversation | Complete compact entry topology, batched body reads, segment-backed snippets, stable turn identity, and window behavior if shipped. |
| `docs/api-reference.md` | 1 | GitHub pull routes | Detail/files/batch envelopes, completeness union, `PullFile` order/content fields, and force/stale semantics. |
| `docs/api-reference.md` | 2 | GitHub pull, GitHub compare, and Changes diff routes | Topology, segment batches, block bodies, search pages, revision conflicts, and request/response limits. |
| `docs/api-reference.md` | 5 | GitHub conversation routes | Body batch/topology endpoints if they are distinct from phase 2 routes. |
| `docs/data-layer.md` | 1 | GitHub plugin database | Mirror completeness metadata, ordered child rows, patch key/state, atomic replacement, and migration ownership. |
| `docs/data-layer.md` | 2 | GitHub/Changes generated diff data | Which descriptors are stored, which segment bodies are blobs or ephemeral, and which revision makes them valid. |
| `docs/caching.md` | 1 | Immutable blob cache | Patch bodies key by patch content rather than head-file SHA; new-side bodies remain SHA-keyed; integrity failures are not no-diff files. |
| `docs/caching.md` | 2 | Provider diff cache | GitHub segment blobs and Changes revision-bound ephemeral documents; topology versus body retention. |
| `docs/caching.md` | 4 | Renderer query cache and new resident cache | Per-node weighted LRU, plain/enrichment priority, pins, oversize rule, superseded Changes entries, and explicit non-persistence. |
| `docs/state-ownership.md` | 3 | Session/view state | Identity reading places, projection/revision validity, active-document height measurements, and what is discarded on revision change. |
| `docs/state-ownership.md` | 4 | Node-scoped renderer state | Segment-cache partition, node removal, task/project cleanup, and why it is not a preference or persisted query. |
| `docs/telemetry.md` | 0 | Renderer seams and diagnosing a view | Large-surface health schema, numeric/privacy rules, performance-timeline snapshot, and scaling/lifecycle signals. |
| `docs/telemetry.md` | 2 | Diff work | Topology, segment load, queue distance, plain paint, and enrichment signals replacing whole-document hydration interpretations. |
| `docs/telemetry.md` | 3 | Diff measurement | Candidate/read/commit counts, fixed-index rebuilds, corrections, anchor drift, observer lifecycle, and blank/uncovered outcomes. |
| `docs/telemetry.md` | 4 | Cache | Hit/miss/eviction/resident weight and privacy-safe outcomes. |
| `docs/telemetry.md` | 5 | Timeline | Logical/rendered/body counts, window changes, pins, and identity substitutions. |
| `docs/testing.md` | 0 | Test layers and manual/real-window checks | Generated profiles, declarative flow, invariant versus timing budgets, and artifact report. |
| `docs/testing.md` | 1–5 | Relevant feature coverage | Add the phase-specific contract, scale, lifecycle, accessibility, and real-engine checks; keep one canonical end-to-end journey. |
| `docs/local-development.md` | 0 | Agent desktop automation | `--fixture large-surfaces`, `flow large-surfaces`, profiles, reports, visibility requirement, and teardown. |
| `docs/plugins.md` | 2 | Plugin UI/diff toolkit | The segmented source contract and the fact that provider code produces source-neutral documents. |
| `docs/plugin-authoring.md` | 2 | Diff UI API, if public to loaded/compiled plugins | Migration from whole files to topology/segments and the new plugin API major where required. |
| `docs/managed-agents/client-surfaces.md` | 5 | Timeline and transcript store | Containment, logical versus rendered items, body mounts, fixed-window rules if used, reveal/selection/focus behavior, and updated performance evidence. |
| `docs/ui-design.md` or the owning kit reference | 5 | Timeline | Only if `Timeline.Turn` gains public logical-list props: stable keys, `aria-posinset`, and `aria-setsize`. |

## Documents that should not absorb this programme

`docs/data-sources.md` already supplies useful completeness words, but dashboard source execution and
GitHub pull mirrors are different contracts. Leave it unchanged unless implementation extracts one
small provider-result type with genuinely identical semantics. Do not import dashboard execution
budgets into PR routes merely to reuse a union.

`docs/tui.md` changes only if the terminal host adopts segmented documents or its behavior changes.
Running its long-diff tests after phase 2 does not by itself create a documentation change.

`docs/README.md` already indexes `docs/future/` as the home for proposals. The programme belongs in
`docs/future/README.md`; adding every phase to the root index would duplicate that owner.

## What moves out of this folder when shipped

Each completed phase's lasting behavior moves to the rows above. Keep this programme while any phase
or its final real-window acceptance remains open. Once all phases are complete, retain only a dated
decision/evidence record if it still explains measured tradeoffs that owning docs should not carry;
otherwise follow the repository's normal retirement process and leave the history in git.

The source survey is not an owning document. Its code-path observations become stale as phases land
and should not be edited to describe the new implementation.

## Verify before building

- Re-read `docs/README.md` and `docs/future/README.md`; add new owner rows if the documentation map has
  changed since 2026-09-26.
- Confirm section headings in every table row before linking to them from a phase change.
- Run `tools/arch/docPaths.test.ts` through the normal test command after moving or retiring any file.
- Update owning docs in the same commit as behavior. Do not mark a phase complete because this table
  predicts a future edit.
