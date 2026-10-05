# Phase 07: add file annotations

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 06 and phase 04's canonical file targets.

Let plugins mark visible files and open Editor tabs with review, coverage, or generated-file facts.
Reuse batched annotation delivery and owner drawing. Do not create a worker or poller per file.

## Starting point and owners

`plugins/editor/src/client/FileTree.tsx` owns expanded tree entries.
`plugins/editor/src/client/EditorPane.tsx` owns open tabs and live revisions.
`packages/client-core/src/host/annotations/annotations.ts` owns batched identity and invalidation.
`packages/client-core/src/host/annotations/AnnotationMarks.tsx` draws accepted marks.
`packages/client-core/src/host/annotations/taskAnnotations.ts` is the core task precedent.
`plugins/editor/src/contract/lineMarkers.ts` is a separate line/range contract that stays unchanged.

Read [annotations](../../plugins/rows-and-annotations.md) and [line markers](../../editor/line-markers.md).

## Contract

Editor owns `editor:file`, kind `annotation`, key `{ taskId: 'string', path: 'string' }`.
Use canonical case-preserving relative paths. No basename renderer key is used for lookup.
The host Node and Editor registration identify the source of the batch. Directories are excluded
from the first contract; a directory summary needs its own defined semantics.

A contributor declares `items` on its own Node route. The host posts distinct visible file keys,
and the route returns ordinary `{ key, severity, text, icon? }` marks. Task identity is in each key
because one contributor may serve multiple Editor mounts. Never send file text or absolute paths.
The metadata is not a filesystem grant. Contributors needing bytes use Editor's read capability.

Accept at most 256 marks from one contributor for a batch. Share the generic raw-response ceiling,
provenance, ordering, stale response rejection, and failure isolation. Display a bounded glyph/legend
beside a file row or tab without changing selection, close controls, or hit targets.

## Steps

1. Declare the annotation point in Editor and expose it in discovery. Keep its owner-specific key
   type beside the Editor contract and reuse the shared validator/delivery implementation.
2. Feed one batch per Editor owner from visible tree entries and open tabs. Deduplicate paths across
   both lists; collapse and virtualization remove offscreen keys. No per-row hook starts a request.
3. Draw row and tab marks through kit presentation. Preserve filenames, ellipsis behavior, tab close
   affordances, and owner dirty indicators. Keep every mark in the accessible provenance legend.
4. Add a loaded fixture returning known review marks. Let changed cached provider data follow the
   shared refresh contract rather than a private per-file interval.
5. Add terminal marks with the same legend and severity mapping. Ensure a preview replacement does
   not remove the tab's identity or marks and that dirty buffer changes do not pretend disk data changed.

## Tests and acceptance

Use `packages/client-core/src/host/annotations/annotations.test.ts` and
`packages/client-core/src/host/annotations/annotationKey.test.ts` for transport patterns.
Extend FileTree and EditorPane tests for collapsed subtrees, duplicate paths, different tasks with
the same filename, Node switches, oversized/malformed marks, provider errors, and late responses.
Count batch calls in a large tree and verify the count depends on visible-key changes, not row count.

Run `pnpm lint`, full suites for `@acorn/plugin-editor`, `@acorn/client-core`, `@acorn/tui`, affected
protocol/Node/schema packages, and `pnpm --filter @acorn/arch-tests test`; expect exit zero.
In desktop and terminal sessions, mark two files and tabs, collapse their folder, and disable the
contributor. Confirm marks disappear with their identities and file actions still target the right path.

Complete when the point works for loaded providers through one batch and no annotation can alter
Editor data, read another task's bytes, or overwrite the owner's dirty-state UI.

## Verify before building

- Recheck which tree entries are actually visible in the Rows virtualization contract.
- Recheck shared annotation refresh and task/Node invalidation before adding a private cache.
- Stop if the implementation would widen the line-marker contract to mean file status.
