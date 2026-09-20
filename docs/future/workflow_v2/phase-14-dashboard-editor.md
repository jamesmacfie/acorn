# Slice 14: Dashboard publication and persistent preview editor

Date: 2026-09-20. Status: complete.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 05, 12. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A panel is composed and published using the same source/query controls as a workflow.

## Work

1. Add core-owned dashboard draft/publication services while retaining panel/placement/layout separation.
2. Replace wizard/modal-only composition with Data/Display sections and a persistent preview.
3. Adapt pure display projections to nested source fields and exact status IDs; retain explicit cross-source mappings and source badges.
4. Make presentation changes redraw locally while query changes require refresh. Preserve incompatible mappings for repair.
5. Integrate shared-query impact, local customization, draft recovery, publication, and placement selection. Keep rollout gated until every old source is migrated.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test display changes do not change query semantics, two query instances of the same source have independent mappings, state-category suggestions do not collapse identities, unavailable views explain prerequisites, and publishing updates placements correctly.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implementation:

- Core owns compare-and-swap dashboard drafts and immutable published revisions. Publication resolves
  every query through the shared runtime, does not fetch records, and registers or removes saved-query
  consumers. The panel preference keeps only a stable publication marker; placements and rectangles
  remain in the existing preference slice.
- `DashboardEditor` reuses `SourceQueryEditor` for up to eight independently keyed query instances.
  Data and Display remain visible beside a retained preview at wide widths and stack at narrow widths.
  Inline display changes run the pure projection only; a query change keeps the prior result marked
  stale until explicit refresh.
- `typedProjection.ts` reads nested values at exact JSON Pointers, keeps typed primitives until the
  panel display boundary, maps exact provider state IDs per query instance, and adds source provenance
  for multi-query panels. Category-derived columns are suggestions that retain the underlying IDs.
- The editor uses explicit 25-record previews. Published panels use bounded source execution, retain
  results in the Node-partitioned client cache, and label incomplete provider or host bounds.
- Missing fields and statuses remain in the draft and appear as unavailable repair choices. View
  choices expose their field prerequisites. Shared-query consumers can edit the shared draft or copy
  it inline with **Customize for this use**; device recovery survives late acknowledgments.
- Closing before the first Node save restores the workspace's device recovery copy. After the first
  save, **Add panel** resumes the newest unpublished core draft rather than stranding it; existing
  published panel drafts remain attached to their placements and are not mistaken for new work.
- Publishing a new panel creates its chosen placement with the selected view's size preset. Publishing
  an existing panel updates the stable definition without changing any placement or layout. Legacy
  panel definitions and plugin-reserved region authoring remain on the old path until slice 19, and the
  legacy measure sampler deliberately ignores typed publication markers during that gate.
- `PanelGrid` remains the layout and gesture orchestrator. Core dashboard publication and deletion
  live in `DashboardPanelHost`, placed-panel rendering and armed chrome actions live in
  `PanelGridItem`, and the cell-to-pixel projection is pure `panelGridGeometry` logic. This reduced the
  orchestrator from 664 to 480 lines without moving placement state or widening the phase-19 gate.

Automated checks on September 20, 2026:

- `rtk pnpm --filter @acorn/dashboards-core test`: 11 files and 213 tests passed. This includes two
  filtered instances of one source, exact-state independence, category suggestions, nested values,
  mapping, shaping, aggregation, and layout rules.
- `rtk pnpm --filter @acorn/node-core test src/server/dashboards
  src/server/routes/dashboards.test.ts`: four files and 21 tests passed. Draft conflicts, immutable
  revisions, scope, source validation without record reads, consumer impact, and sampler compatibility
  are covered.
- `rtk pnpm --filter @acorn/client-core test` over dashboard model/recovery/persistence and shared
  source-editor files: eight files and 69 tests passed. The focused assertions include query/display
  separation, retained incompatible mappings, view guidance, exact dynamic IDs, recovery, and
  placement/layout preservation across publication.
- Client, protocol, and dashboard-core TypeScript checks passed. `rtk pnpm db:check` applied all core
  and plugin migrations cleanly. The focused architecture run passed 55 tests.
- `rtk pnpm lint` completed all 33 workspace lint tasks; Oxlint reported only the repository's
  warning-only baseline. The final focused client and dashboard-core checks passed after cleanup.
- `rtk pnpm --filter @acorn/tui test src/kit/kit.test.tsx src/plugins/plugins.test.tsx`: 124 tests
  passed and two controlled cases skipped, covering the closed-kit keyboard/region behavior and the
  intentional terminal dashboard boundary.
- The maintainability split passed 63 focused dashboard/source-editor tests, 14 CSS hygiene tests,
  the client-core TypeScript and icon checks, and targeted Oxlint with no findings. Pure grid geometry
  has focused coverage for collapse, live drag offset, placeholder position, and container depth.

Real-host evidence on September 20, 2026:

- In isolated Tauri session `workflow-v2-phase12`, the installed unfamiliar `typed-source` fixture
  supplied two **Nested records** queries. One used Project **Closed**, the other Project **Open**.
  Both retained independent previews and exact `/state` mappings; the exact `open` ID from each query
  was mapped to a different user-defined column.
- Switching List to Board redrew the retained records immediately without changing either query or
  its read timestamp. The preview placed the independently mapped records in their intended columns
  with source badges. The published SQLite revision independently confirms `closed` and `open` query
  parameters, separate query-instance value maps, and the `board` view.
- The same session edited the selected saved query, showed its consumer controls, then used
  **Customize for this use**. The dashboard copy retained the edited Closed parameter while the shared
  query remained its own entity. Publishing created revision 1 and its Home placement.
- A final restart rendered the published panel through bounded source execution and its
  Node-partitioned TanStack cache, then reopened the newest unpublished core draft as **draft saved**,
  including its saved query and Closed parameter. This run also caught and fixed reactive cache
  metadata crossing the strict typed-data projection boundary; the repeated panel render completed
  with both mapped columns and no partial-data warning.
- The empty editor explained why Board and Chart were unavailable. At a 760-pixel window, Data,
  Display, preview, Close, and Publish remained readable in one stacked layout. Inspected artifacts:
  `.acorn/agent-dev/workflow-v2-phase12/screenshots/phase14-editor-independent-board.png`,
  `phase14-editor-narrow.png`, `phase14-published-placement.png`, `phase14-published-narrow.png`, and
  `phase14-published-bounded-execution.png`.
- The actual terminal client built, started its isolated Node, rendered at 80 columns, accepted keyboard
  navigation in its trust prompt, and shut down cleanly. Dashboard grids remain intentionally named
  rather than rendered in the terminal until the slice-19 consumer cutover; this run verifies that the
  shared editor additions and typed panel chunk do not break the terminal host.

The desktop automation driver does not expose key injection, and native macOS Tab/Escape synthesis did
not reach the WebView on this host. Keyboard containment and terminal navigation passed their focused
tests, but a native desktop keyboard-only traversal could not be recorded. This is an automation
evidence limitation, not a known product failure. The isolated desktop and terminal sessions were
stopped after inspection. No phase-14 implementation gap remains.

## Verify before building

Read dashboard definition/placement storage, mapping, aggregation, and sampler consumers. Presentation-specific filtering must not masquerade as complete upstream query execution.
