# Large rendered surfaces: bounded work for diffs and timelines

Status: phase 0 partly shipped 2026-09-26 (its visible real-window run is owed). Phases 1 to 5 have
not started.

This programme applies the useful parts of GitHub's 2026 account of rendering a pull request with
2,200 files, more than one million changed lines, and more than 400 inline review comments. The
source is [Rendering huge pull requests in the GitHub Copilot app](https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/).

Acorn already has the right first layer: fixed-height code rows, a virtualized DOM, worker-based
highlighting, stable row keys, and scroll-gated publication. It does not yet have a bounded document
model behind that layer. The GitHub mirror can silently publish the first page of several
connections as if it were complete, and the renderer eventually parses, tokenizes, flattens, keys,
and scans every file. A million-row diff therefore still creates work proportional to a million
rows even though only a small number of DOM nodes are mounted.

The programme fixes the data contract before the renderer. It then moves the shared diff viewer
from one materialized `Row[]` to a compact document topology plus bounded, demand-loaded segments.
Variable-height content gets identity-based measurement and anchoring. Parsed segments remain
resident under an explicit memory budget. Long timelines use stable identity, browser containment,
and a fixed logical window if measurement shows that constructing every card is still too costly.

Where this folder and an owning document under `docs/` disagree after a phase ships, the owning
document wins. Paths and dependency versions in this folder are evidence from 2026-09-26, not a
promise that the tree will keep the same shape.

## Outcomes

1. **Completeness is explicit.** A provider result is complete, or it names why it is incomplete.
   A fixed `first`, `per_page`, or upstream maximum never becomes an apparently complete mirror.
2. **Structure arrives before expensive content.** File order, fixed row counts, line anchors, and
   the complete inline-thread topology are enough to draw the document and navigate it. Patch
   segments, highlighted tokens, word diffs, Markdown bodies, and snippets load near the viewport.
3. **Interactive work is bounded by the viewport.** Scrolling, measurement, rendering, annotation
   requests, and highlighting do not grow with the total row count.
4. **Fixed and dynamic geometry have separate contracts.** Code and structural rows retain exact
   geometry. Threads, notes, composers, disclosures, and images use measured dynamic blocks without
   rebuilding code offsets.
5. **Corrections preserve a reading place by identity.** A file, code row, thread, or timeline turn
   is the anchor. Pixel offsets are only the distance within that identity.
6. **Returning to recent work is fast and memory remains bounded.** Parsed segments use a weighted
   in-memory LRU. No parsed diff, token tree, DOM subtree, or measured height is persisted to disk.
7. **The surface explains its own health.** Permanent, privacy-safe counters and a synthetic real
   desktop fixture make regressions reproducible without hand-added logging.

## Health contract

The implementation is healthy when all of these statements can be asserted:

- Source-owned file and inline-thread topology does not change after the document reports ready.
  User-created composers and optional extension annotations are recorded separately because they
  are allowed to appear later.
- Increasing a fixture from 100,000 to 1,000,000 fixed rows does not materially increase mounted
  rows, mounted dynamic blocks, active observers, per-frame measurement reads, or per-frame commits.
- Plain rows can paint before syntax and word enrichment. Enrichment has a bounded near-viewport
  queue and never drains the entire document merely because the pane remains open.
- A dynamic resize causes at most one geometry commit in a frame. Normal commits pause during a
  user scroll. A direct visible interaction may commit before paint, still capped at one per frame.
- A correction keeps the same identity and intra-item offset within the recorded tolerance. The
  diagnostic distinguishes wheel, pointer, touch, and keyboard input from the surface's own scroll.
- Segment, token, and height caches report their weight, hits, misses, and evictions and remain under
  configured row and byte ceilings.
- Leaving the surface returns observer, pending-work, and mounted-item counts to their baseline.
- The canonical sweep finds no blank mounted block, unfilled gap, duplicate row, or missing content.

Phase 0 records timing and memory baselines on a real graphical host. Later phases set absolute
budgets from that evidence. Scaling invariants and lifecycle counts are asserted immediately; they
do not depend on the speed of a CI runner.

## Decisions taken

| Decision | Reason | Consequence |
| --- | --- | --- |
| Correct the GitHub mirror before optimizing its consumer. | A fast view of a silently truncated pull request is incorrect. | Phase 1 precedes the new document contract. |
| Keep one source-neutral viewer. | GitHub pull requests, GitHub comparisons, and local Changes already meet through `DiffSource`; provider types must remain outside client-core. | All three producers implement the segmented contract in phase 2. |
| Add a runtime-neutral diff-document package. | Topology is built on the Node side and consumed in the renderer. It cannot live in client presentation code or in a provider plugin. | Pure parsing, segment schemas, identities, and projection counts have one owner and no Solid, DOM, database, or transport dependency. |
| Segment by both row count and encoded size. | A row count alone does not bound generated files or minified lines. | Every segment is bounded except one explicitly marked oversize row. |
| Publish plain rows before enrichment. | Highlighting is useful presentation work, not a prerequisite for correct text or scrolling. | Tokens and word spans are replaceable enrichment keyed to a segment revision. |
| Use stable content digests for patch identity. | A GitHub head blob SHA does not identify a diff against a particular base. | Blob keys, segment keys, and client cache keys derive from patch content or an equivalent full diff revision. |
| Keep Solid row components. | The current components contain interaction, accessibility, annotations, and plugin seams that an imperative rewrite would have to recreate. | The document and geometry change; a blanket recycled-DOM renderer does not. |
| Treat timeline windowing as a measured fallback. | Acorn's previous variable-height transcript virtualizer broke measurement caches and text selection. | Stable keys and `content-visibility` land first; a fixed logical window lands only if card construction remains over budget. |
| Keep diagnostics numeric and bounded. | Diffs and transcripts contain sensitive source and conversation content. | No path, source line, comment body, search term, or transcript text enters telemetry or the health snapshot. |

## Files in this programme

| File | Purpose |
| --- | --- |
| [01-source-and-findings.md](./01-source-and-findings.md) | The GitHub article, the Acorn data flow, and the concrete gaps found in the current tree. |
| [phase-0-health-contract.md](./phase-0-health-contract.md) | Permanent probes, the synthetic large-surface fixture, and an unattended real-window sweep. |
| [phase-1-complete-github-topology.md](./phase-1-complete-github-topology.md) | Cursor/page traversal, atomic mirrors, explicit completeness, ordered files, and unambiguous patch state. |
| [phase-2-segmented-diff-document.md](./phase-2-segmented-diff-document.md) | The shared structure-first document contract, bounded segments, plain-first rows, and near-viewport work. |
| [phase-3-dynamic-block-geometry.md](./phase-3-dynamic-block-geometry.md) | Separate dynamic-block geometry, measurement scheduling, height fingerprints, and identity anchoring. |
| [phase-4-resident-segment-cache.md](./phase-4-resident-segment-cache.md) | The renderer-scoped weighted LRU for recent parsed and enriched segments. |
| [phase-5-bounded-timelines.md](./phase-5-bounded-timelines.md) | Stable PR turn identity, browser containment, lazy body/snippet work, and measured fixed windows. |
| [docs-migration.md](./docs-migration.md) | Which owning documents each phase changes. |
| [refused.md](./refused.md) | Tempting alternatives that this programme does not take. |

## Phases

| Phase | Delivers | Waits on |
| --- | --- | --- |
| 0 | A reproducible 2,200-file, 1,000,000-row, 400-dynamic-block fixture; permanent health probes; cold, warm, resize, interaction, and deep-scroll automation | Nothing |
| 1 | Complete and ordered GitHub topology, atomic publication, explicit incomplete states, and patch content identity | Phase 0 for evidence and regression signals |
| 2 | A source-neutral segmented diff document used by GitHub pull requests, comparisons, and Changes; plain-first paint; bounded loading, enrichment, find, annotations, and gap expansion | Phases 0 and 1 |
| 3 | Dynamic blocks measured and corrected independently from fixed code geometry, with identity anchors and scroll-gated commits | Phase 2 |
| 4 | A per-node weighted LRU of recent plain and enriched segments, with explicit eviction and lifecycle behavior | Phase 2; phase 3 defines the height-cache boundary |
| 5 | Bounded Agent and PR timelines, with stable turns and lazy PR snippets/bodies | Phase 0; phase 2 for segment-backed PR snippets |

Phase 5 may proceed alongside phases 1 to 4 after phase 0, but its PR snippet work waits for phase 2.
Phases 2 and 3 should land separately: segmentation removes total-document allocation, then the
geometry phase can measure the remaining variable-height cost without those allocations obscuring
it. Phase 4 follows segmentation so the cache does not preserve the monolithic model this programme
is removing.

## How to implement a phase

Each phase ends with a verification list. Re-run it before coding. Then:

1. Capture the phase's before measurements with the phase 0 fixture.
2. Change the smallest owning contracts together. Do not leave a production compatibility path that
   builds both the monolithic and segmented models.
3. Add contract and lifecycle tests before asserting host-specific timing.
4. Run `pnpm lint`, the focused suites named by the phase, and `pnpm test` when a shared contract or
   package changes.
5. Exercise the canonical flow in the real Tauri window with `pnpm dev:agent` and record the health
   snapshot for cold and warm runs.
6. Update the owning docs listed in [docs-migration.md](./docs-migration.md) in the same change.

If phase 2 changes or removes a published `@acorn/plugin-api/ui/diff` contract, apply the repository's
plugin API major-version rule rather than keeping an indefinite adapter. First-party GitHub and
Changes sources migrate in the same change.

## What this programme does not schedule

- A general rendering framework or a replacement for every virtual list.
- An imperative DOM renderer for the diff.
- Persistent parsed diffs or transcript DOM.
- A new remote transport. The routes may return compact topology and bounded segments through the
  existing plugin API unless measurement proves streaming is required.
- GitHub data beyond the upstream 3,000-file REST ceiling. The app reports that ceiling honestly.
- Seamless variable-height virtualization for timelines. A fixed logical window is the planned
  fallback; [refused.md](./refused.md) records what would justify reopening that decision.

## Verify before building

- `docs/diff-rendering.md` still names `DiffSource` as the shared GitHub/Changes port and describes a
  combined `Row[]` built by `buildRenderableRows`.
- `plugins/github/src/server/routes/mirror/prMirror.ts` still owns both PR detail and file mirrors.
- `packages/client-core/src/features/diff/DiffPane.tsx` still owns hydration, combined rows, unified
  and split virtualizers, annotations, find, and scroll restoration.
- `packages/client-core/src/kit/components/content/Timeline.tsx` still deliberately refuses the old
  variable-height virtualizer and recommends a fixed window.
- `apps/desktop/scripts/agent/` still owns the isolated real-window driver used by the programme.
- Read [docs/future/README.md](../README.md) before adding or renaming a phase; every multi-file
  programme must retain a `refused.md` and stay indexed there.
