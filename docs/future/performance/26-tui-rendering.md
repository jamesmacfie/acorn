# Terminal client viewport, wrapping, painting, and logs

Date: October 1, 2026. Status: pending implementation; unit 26.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–25, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 15](../../../plans/performance/15-tui.md).

The original [unit brief](../../../plans/performance/implementation-26-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read area15, docs/tui.md, kit Rows/Log and painter/layout/width
contracts, plus reviewed unit08 shared collection improvements. Capture fresh actual TUI baselines.
Do not replace the painter, layout engine or keyboard model; preserve the shipped viewport seams.

## Row admission

TUI Rows returns every item when measured height is zero, both before layout and behind an overlay.
Use bounded initial admission and distinguish hidden/zero geometry from an unlimited viewport.
Preserve last valid capacity where appropriate, authoritative selection independent of drawn rows,
row identity/data freshness, scroll offset, wheel browsing away from selection, focus fallback and
Home/End/page intent. Test before the first corrective frame; a low settled count does not prove
bounded initial work. Empty/delayed data, shrink/grow and overlay reveal must heal without admitting
all10,000 items or silently discarding logical rows.

## Complete linear wrapping

The quadratic owner is layout/measure.ts wrapLines: it rescans the shrinking oversized word with
stringWidth/sliceToWidth. Identify widths/breaks once and advance offsets, with a linear ASCII path
and one segmentation where Unicode needs it. Keep complete line arrays and exact existing wrapping
meaning. wrap.ts field offset rows are a different contract that retains every document character;
do not merge them merely because both wrap text. Measurement, paint and field cursor mapping must
remain consistent. Width zero/infinite, controls, explicit/trailing/empty paragraphs, spaces,
combining/astral/CJK clusters and a glyph wider than its box need equivalence coverage.

## Clipped painting

writeRun eagerly creates/traverses every grapheme even beyond the right clip, but returns the full
occupied width to position later styled segments. Avoid unnecessary allocations/writes while
preserving that full-width return. ASCII can use known length; Unicode still needs honest width
or an owner-scoped prepared measurement. No unbounded global text cache. Negative origins, left
and right clip, wide continuation/half glyphs, zero-width clusters, styles and raw control filtering
remain exact. Vertical drawText currently searches every measured line's offsets and walks pieces;
admit visible rows without losing span alignment at wrapped/newline/duplicate-line boundaries.
If prepared offsets/styles are cached, invalidate on text/style/width and retire with their node.

## Log window

Log retains a For for all lines inside ScrollViewport. Use the existing TUI DiffPane spacer/window
pattern with authoritative viewport offset/height, a bounded assumed initial view and overscan.
Line index/occurrence identity must distinguish duplicate strings. All bounded source text remains
available to find/copy; find bar stays outside scrolling. Preserve scroll extent, page/wheel, clear,
append/tail shift, resize, hide/reveal and focused reveal. Follow is accepted but presently unwired;
characterize that behavior and propose any change separately instead of silently inventing it for
the benchmark. Generic Markdown/Timeline virtualization and hidden spinner work remain conditional.

## Evidence

Actual harness200/2,000/10,000 Rows at80×24: initial/hide/reveal bounded owners, final24 and teardown0;
row identity/data updates/input intact. Complete10k/100k/1M wrap equivalence with near-linear CPU.
Twenty1M-character paints to80cells: exact full returned width/buffers with measured CPU/allocation,
plus actual screen.frame styled/wrapped paragraphs. Log10k duplicate/unique lines: bounded Tree/Yoga
nodes at first layout and hidden/settled states, paired mount and30unchanged-frame CPU. Run relevant
TUI width/layout/paint/kit/keys/startup gates and docs. Coordinate a disposable PTY/fake-TTY input and
frame/cell screenshot transcript check with the coordinator. No normal terminal profile or provider
is needed; logical count reductions and synthetic frame CPU are distinct from a multi-day soak.

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
