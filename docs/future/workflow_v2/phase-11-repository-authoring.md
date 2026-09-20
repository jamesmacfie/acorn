# Slice 11: Visual repository editing and portable export

Date: 2026-09-20. Status: complete.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./publication.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 10. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A visual draft publishes to a workflow file, detects external edits, and exports saved dependencies without hidden query IDs.

## Work

1. Persist file drafts by project/confined relative path with base file hashes and recoverable edit state.
2. Integrate file changes with semantic conflict review and atomic per-file writes. Leave working-tree changes uncommitted.
3. Export published query content inline and database-owned child workflows as reviewed sibling files, rewriting references.
4. Convert Node-local connection selections to constrained named inputs; list provider project/state dependencies that need destination validation.
5. Journal multi-file publication progress, detect conflicting external writes, and retain partial-operation recovery. Preserve repository trust during run admission.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test TOML nested-value round-trip, file changed/deleted externally, symlink escape refusal, existing-path conflict, interrupted multi-file export, child reference rewriting, destination connection setup, and no database query IDs in exported definitions.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implementation:

- `workflowFileAuthoring.ts` owns persistent file drafts and publication recovery. Migration 0007
  adds `workflow_file_drafts` and `workflow_file_operations` without changing prior migrations.
- `workflowFileWrites.ts` confines paths and rechecks expected content before atomic per-file rename.
  `workflowFileReview.ts` validates child references and records same-layer file dependency hashes.
- `workflowExport.ts` captures published definitions and exact selected query revisions, embeds
  query parameters, rewrites database children, and preserves workspace originals. Occupied paths,
  cycles, unresolved references, and out-of-scope user dependencies are refused.
- Exported connection inputs are limited to the subtree that uses them. Reusing a repository
  dependency is refused when it retains an Acorn scope ID, a literal Node-local connection, or an
  unconstrained connection input.
- Connection inputs carry source constraints; Acorn scope IDs are rebound at destination admission.
  Provider project/state identifiers remain visible setup dependencies. Static metadata validates
  before admission; filters bound to runtime records validate when their data step executes.
- The device-only `/defs/files` route exposes opening, saving, reviewing, publishing, listing,
  and discarding unwritten reviews. The visual editor uses its ordinary draft controls for files,
  displays semantic conflicts, and shows the reviewed file list and resumable progress.
- File admission refuses incomplete publication sets. Repository trust remains required. The
  destructive `save-to-repo` path is refused; it cannot delete workspace originals.

Verification on September 20, 2026:

- `rtk pnpm --filter @acorn/plugin-workflows test`: 46 files, 425 tests passed.
- `rtk pnpm --filter @acorn/arch-tests test`: four files, 63 tests passed.
- `rtk pnpm db:check`: all 11 migration chains replayed successfully, including eight workflow migrations.
- `rtk pnpm lint`: all 33 package lint tasks passed. Existing repository oxlint warnings remain.
- Focused file tests cover nested TOML values, external edit/delete, stale saves, semantic choices,
  symlink/path refusal, occupied destinations, interrupted writes before journal acknowledgment for
  each exported file, exact query inlining, child references, original retention, and destination setup.
  Focused destination tests cover static metadata validation and deferred runtime filter values.
- Final focused recheck after simplifying failed temporary-file cleanup: workflow lint and focused
  oxlint passed; `workflowFileAuthoring.test.ts` passed all 14 tests.

Real-window evidence: the sandboxed launch could not create the local `tsx` IPC socket. The escalated
`workflow-v2-phase11 --reuse` session launched the real Tauri window. The project-scoped Workflows
surface created a draft, added and validated a command step, prepared and completed reviewed database
publication, then prepared a repository export for `.acorn/workflows/untitled-workflow.toml`. The file
review stated that workspace originals are preserved and files remain uncommitted. That review was
discarded, leaving no pending repository operation, and the session was stopped. Artifacts:
`.acorn/agent-dev/workflow-v2-phase11/screenshots/publication-review.png` and
`.acorn/agent-dev/workflow-v2-phase11/screenshots/export-review.png`.

## Verify before building

Read file confinement, codec, graph resolution, and trust code. Do not commit files, change branches, delete workspace originals, or silently overwrite known external changes.
