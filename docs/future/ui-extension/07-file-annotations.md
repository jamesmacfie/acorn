# Phase 07: add file annotations

Status: done, October 10, 2026. Branch `phase-07-file-annotations`, from `bf64f132c`.

## Completion note

Other plugins can mark the files Editor draws. Marks show beside tree rows and on document tabs in
both hosts, with every mark and its plugin in the row's or tab's legend. Each contributor gets one
batch per Editor pane, made from the open tabs and the files in expanded folders. With no
contributor, the tree and tabs look as they did.

### What landed

- **Contract.** `plugins/editor/src/contract/fileAnnotations.ts` holds `EDITOR_FILE_POINT`
  (`editor:file`), `EDITOR_FILE_KEY` (`['taskId', 'path']`), `EditorFileAnnotationKey`, and
  `MAX_EDITOR_FILE_MARKS` (256). Editor registers the point in `client/index.ts` with
  `acceptedMarks: 256`. The shared registry lists it on the Extension points page.
- **Batch.** `client/fileAnnotations.tsx` builds the keys, removes duplicate paths, and calls the
  shared `requestAnnotations`. `FileTree` reports the file rows of expanded folders through a new
  `onVisibleFiles` prop, and `EditorPane` asks once from an effect, for those rows and its open tabs.
  Transport, validation, provenance, the 4,096-row ceiling, stale-answer rejection, and failure
  isolation are the shared host's, unchanged.
- **Tree rows.** Up to three glyphs follow Git's badge: the mark's icon on the desktop, otherwise a
  dot. The row's tooltip and accessible label add every mark as "text — plugin". The terminal draws
  dots and the legend as muted text, the way it shows Git's label.
- **Tabs.** The kit's `DocumentTabs` takes an optional `marks: { tone, label, icon? }[]` on both
  hosts. The desktop draws up to three glyphs between Git's letter and the unsaved dot, and reads
  every label in the tab's accessible name. The terminal draws up to three dots after the label and
  lists the active tab's marks after its Git status below the strip.
- **Docs.** [File annotations](../../editor/file-annotations.md) owns the contract. The
  `plugin_authoring` brief names the point, its key, the bodies, and how to be asked again.
  [Rows and annotations](../../plugins/rows-and-annotations.md) points to it.

### Decisions and deviations

- **Expanded folders, not the scroll window.** `Rows` doesn't report its rendered window, and the
  shared host clears a contributor's marks whenever the key set changes. Asking per scrolled row
  would blank every mark on each scroll step. So collapse removes keys and scrolling doesn't. A tree
  with thousands of expanded files sends them all in one POST, which is the known ceiling.
- **No empty batch.** With no tabs and no file rows, Editor asks nothing, because nothing could draw a
  mark. This also drops the empty request a fresh tree made before its first listing.
- **One batch per pane.** The host draws one Editor pane per client, so one pane's batch is the
  point's batch. A second concurrent pane would replace the first one's batch; merging every mount's
  paths in `fileAnnotations.tsx` is the fix if that ever exists.
- **Severity mapping** is `info` muted, `warn` warn, `danger` danger, as `AnnotationMarks` uses. The
  terminal draws `○` for muted and `●` otherwise, always as dots, because it has glyphs for only some
  icon names.
- **Glyphs carry no label or focus stop.** The row or tab already carries the full legend, and a
  labelled dot would be a live region inside a tree row.
- **No committed loaded fixture,** as in earlier phases. The real-host fixture was a Node-only scratch
  plugin built to `/tmp`, answering fixed marks for `README.md`, `AGENTS.md`, and `docs/README.md`.
- **Malformed marks** are covered by the shared transport tests. Editor's tests check what is
  Editor-specific: a mark for another task, a path in another case, or a key missing `taskId` lands
  nowhere.

### Verification

Run with Node 26.8.1.

- `FileTree.test.tsx`: 21 tests, 3 new. A 10,000-file tree asks once, with no folder keys, and
  draws fewer than 100 rows. A refresh with the same files asks nothing. Expanding and collapsing a
  folder each ask once more. A mark doesn't open, select, or arm its row. An unmounted tree reports
  no files.
- `EditorPane.test.tsx`: 6 new tests. Tabs and tree files go in one deduplicated batch, and the
  close control stays. A dirty buffer and a plugin-drawn preview keep the tab's mark and ask nothing
  new. Only marks for this task and exact path land. A Node switch clears marks and drops the old
  Node's late answer. One provider's 300 marks keep 256 and draw three glyphs while a failing provider
  draws nothing. A removed contributor's marks disappear. All six fail with the batch effect removed.
- `kit.test.tsx` (terminal): one new test for tab dots and the legend line.
- `pnpm test --filter=@acorn/plugin-editor`: only the four known status-menu failures.
  `@acorn/client-core` 2,662 and `@acorn/node-core` 1,756 pass. `@acorn/tui`: only the two known
  `chrome.test.tsx` marker failures. `pnpm --filter @acorn/arch-tests test`: only the 15 known
  docPaths links. `turbo run lint --continue`: errors only in the agents, changes, git, and workflows
  files already known to fail. The service budget reads 1,756,613 B of 1,759,000 B.
- **Desktop, `pnpm dev:agent`.** With the scratch plugin installed, a task worktree showed a warn dot
  on `README.md`, a red lock on `AGENTS.md`, and an info dot on `docs/README.md` once `docs` was
  expanded. Both open tabs drew their mark, the active one beside its close control, and their tips
  listed the mark and plugin. The `README.md` row's menu still opened **Rename…** on `README.md`. With the
  plugin disabled and the Node restarted, every mark went and both tabs stayed.
- **Terminal, `pnpm dev:tui:agent`.** The same plugin marked `README.md`, `AGENTS.md` after Git's
  `U`, and `docs/README.md` with `○` once expanded, gone again when collapsed. The tab strip showed
  `AGENTS.md [?] ● ×` and "Untracked — Unstaged · Generated file — review-fixture". Shift+F10 on the
  marked `README.md` row opened **Actions for README.md**. Disabled and relaunched, no marks drew. The
  terminal held one tab at a time here, because Go to file opens a preview that replaces the last.

### What later phases need to know

- A plugin disable keeps the plugin running, so its marks stay, until the Node restarts. That is the
  shared disable behavior, not this point's.
- `DocumentTabs` now takes `marks` on both hosts. Another owner of a tab strip can reuse it.
- An owner whose list is virtual should batch what's expanded, not what's scrolled, until the shared
  host can keep marks for keys that remain across a key-set change.

## Original plan

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
Built-in Git marks use `editor:file-status`, typed in `plugins/editor/src/contract/fileStatus.ts`.
Preserve that task-level status read and folder grouping. It is separate from contributed file annotations.

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
