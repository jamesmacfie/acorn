# Phase 12: add source and pane status annotations

Status: done, October 10, 2026. Branch `phase-12-rail-status`, from `48b862e8e`.

## Completion note

Other plugins can mark a rail source icon and a task pane's switcher button, but only where the
owner consented. Git's source and the Changes pane consent. Marks reach the default rail, a
replacement rail, both pane switchers, and the terminal through the existing marker feed. Each
contributor gets one request per visible key set.

### What landed

- **Contract.** `CORE_SOURCE_POINT` (`core:source`, key `['sourceId', 'projectId']`) and
  `CORE_PANE_POINT` (`core:pane`, key `['paneId', 'taskId']`) in
  `packages/protocol/src/chrome/extensionPoints.ts`. Source descriptors and task panes take an
  optional `statusAnnotations`. The Node refuses it on settings, project panes, overlays, and every
  other surface. `SourceContribution` and `PaneCommon` take the same field, the loaded source and
  pane registrations carry it, and the JSON schema was regenerated.
- **Batch owner.** `client-core/src/host/annotations/statusAnnotations.ts` registers both points
  (`max: 4`, `acceptedMarks: 256`) and two rail marker contributions. `requestSourceAnnotations(ids,
  routedProjectId)` and `requestPaneAnnotations(taskId, panes)` keep only consenting owners and ask
  through the shared `requestAnnotations`. Marks are read back only for keys this module asked
  about. A changed set of owner registrations clears the point before it asks again, so a reloaded
  or hidden owner drops its marks even when the ids come back the same. `releasePaneAnnotations`
  clears a closed task's marks unless another task's switcher asked since.
- **Drawing.** `taskAnnotations.ts` exports `annotationRailMarkers`, so all three points draw marks
  the same way. `TabRail` asks for the drawn icons and the routed project. `TaskPaneHost` asks for
  its switcher's panes and releases on unmount. `PaneSwitcherPane` gains `markers`, filled by the
  host, so core's switcher and a replacement draw the same data, as `RailData.sources` already did.
  The terminal Menu shows `N marks` or `+N` on a source row, and its menu key opens **Source
  markers**. The pane strip puts `+N` after a label and lists the shown pane's labels under it.
- **Discovery and docs.** Both points appear on the Extension points page through the registry. The
  `plugin_authoring` brief names `core:task`, `core:source`, `core:pane`, their keys, and the
  consent flag. [Rows and annotations](../../plugins/rows-and-annotations.md#source-and-pane-annotations)
  owns the contract, and [terminal chrome](../../tui/chrome.md#task-markers) describes its drawing.

### Decisions and deviations

- **Consent sits on the owner, checked where the request is built.** The client reads the flag
  only on a task pane's registration branch, so a stray flag on another roster surface consents to
  nothing. Disabled and untrusted owners need no extra path, because they stop being drawn and
  stop being asked about.
- **Project keys.** A project-scoped source is keyed by the routed project and skipped while none
  is routed. Any other source is keyed by `""`. The desktop's routed project is the URL's, or the
  active task's. The terminal's is `routedProjectId()`.
- **The terminal pane strip draws compiled pane markers too.** `markersFor` merges owner, compiled,
  and annotation markers, so the Changes plugin's own dot now appears there as well. That follows
  "use the shared legend", and it's a visible change in the terminal.
- **Legend order is unchanged.** Annotation markers carry priority 0 and sort by qualified id with
  compiled markers, as `core:task` marks always have. An owner marker keeps the corner it asked for.
- **One batch per point.** Desktop and terminal each draw one rail and one pane switcher. A second
  concurrent switcher would replace the first's batch, the same limit phase 07 recorded for Editor.
- **One more client-core entrypoint.** The terminal imports `statusAnnotations.ts` directly because
  the annotations barrel carries the DOM's `AnnotationMarks`. `tools/arch/boundaries.test.ts` moves
  from 182 to 183, with the reason.
- **No committed loaded fixture,** as in phases 01 to 11. The real-host plugin was a scratch build in
  `/tmp` with both extensions and a `coreSlot: 'rail'` tree that printed each source's markers.

### Verification

Run with Node 26.8.1.

- `statusAnnotations.test.ts` (11 new) covers absent consent, unasked keys, project changes with a
  late answer, a replaced and a hidden owner, the same source on two Nodes, 60 buttons in one batch
  per contributor, six marks against four corners merged with an owner marker, a closed task's late
  answer, and a reloaded contributor. Removing the owner clear or the release guard fails a test.
- `TabRail.test.tsx` (2 new): four marks and six labels on a consenting source, nothing on another,
  its menu opening without selecting it, a replacement receiving the marks, and core drawing them
  after the replacement throws. `TaskPaneHost.test.tsx` (1 new), `chromeExtensionPoints.test.ts`
  (one POST for 40 panes, malformed and unasked rows dropped), `chromeRegister.test.ts`,
  `register.test.ts`, `paneSwitcherRemote.test.ts`, `manifest.test.ts`, `pluginAuthoring.test.ts`,
  and two terminal tests in `chrome.test.tsx`.
- Suites: `@acorn/protocol` (301), `@acorn/client-core` (2,735), `@acorn/node-core` (1,761),
  `@acorn/plugin-git` (96), `@acorn/plugin-git` (326), `@acorn/plugin-api` (14), and
  `acorn-plugin-types` (5) pass. `@acorn/tui` fails only the two known `chrome.test.tsx` task-marker
  tests, which fail the same way with this branch's terminal files reverted. `@acorn/arch-tests`
  fails only the 15 known dead links. `turbo run lint --continue`
  reports type errors only in the known agents, changes, git, and workflows server and test files, and
  oxlint flags nothing new in the changed files.
- Budgets: the Node service is 1,757,603 of 1,759,000 bytes, and the terminal startup closure
  692,304 of 700,000 bytes.
- **Desktop, `pnpm dev:agent`.** After the trust prompt, the Git icon drew a red rocket, an amber dot,
  and two green dots, and its accessible legend held all five labels. No other source was marked.
  Right-clicking Git opened **Open** and **Copy link** and left Home selected. In a task, only the
  Changes button was marked, with both labels, and its menu opened without showing the pane. With
  the scratch rail chosen, the replacement printed the same five Git labels and still placed the
  task list. With the plugin disabled and the Node restarted, core's rail returned and nothing was
  marked.
- **Terminal, `pnpm dev:tui:agent --fixture tui-navigation`.** The Menu showed `Git 5 marks`.
  Shift+F10 opened **Source markers**, and End reached the fifth. A task's strip read
  `Changes +2`, and showing Changes put both labels on the line under it. Disabled and relaunched,
  neither appeared. The legend dialog in the rail column cuts long labels, as the task one does.

### What later phases need to know

- A source or task pane opts in with `statusAnnotations: true` on its descriptor or compiled
  contribution. Nothing else is needed: the rail and switchers already ask.
- `PaneSwitcherPane.markers` is required. A host that builds pane switcher data must fill it with
  `markersFor({ kind: 'pane', id, taskId })`.
- The trust prompt still quotes the contributor's label for core points, as in "Add its own rows to
  core's “Source status” list", which phase 01 recorded. That wording says rows for an annotation
  point.

## Original plan

Let loaded plugins supply status marks for consenting rail sources and task panes. Use the shared
annotation transport and host legend rather than another rail-only route or remote subtree.

## Starting point and owners

`packages/client-core/src/host/annotations/taskAnnotations.ts` supplies loaded task marks.
`packages/client-core/src/host/annotations/annotations.ts` owns batches and invalidation.
`packages/client-core/src/features/tabs/TabRail.tsx` draws source/task rail controls.
`packages/client-core/src/features/tasks/PaneSwitcher.tsx` draws task pane controls.
`apps/tui/src/chrome/Rail.tsx` draws terminal rail state.
The compiled `railMarkers` contribution remains supported; it is not a loaded-plugin grant.

Read [annotations](../../plugins/rows-and-annotations.md),
[rail status](../../ui-design.md#rail-controls-and-status-markers), and
[core replacements](../../plugins/replacing-core-surfaces.md).

## Contract

Core owns `core:source`, annotation key `{ sourceId: 'string', projectId: 'string' }`, and
`core:pane`, annotation key `{ paneId: 'string', taskId: 'string' }`.
The viewed Node belongs to the host batch identity, not a key supplied by the contributor.
Source project IDs follow the routed project, with an empty string only for a declared Node-scoped
source. Panes target real task pane registrations, not arbitrary surface strings.

Add optional `statusAnnotations: true` to source descriptors and task-pane descriptors/compiled
contributions. This is the owner's consent to participate. Reject it on settings, project panes,
overlays, and other targets. Request marks only for visible consenting registrations, and accept
marks only for those requested keys. Owner disabled/untrusted state clears marks as contributor state does.

Return ordinary severity/text/icon marks through the contributor's own batched `items` route.
Accept at most 256 marks per contributor. Merge with owner status and compiled markers using the
host's deterministic legend ordering. Preserve all accepted labels in accessibility and the tooltip
even when the icon has no spare corner. No remote tree or per-icon request is created.

## Steps

1. Add typed points, owner opt-in descriptor fields, Node/client validation, schemas, and discovery.
   Preserve `core:task`, legacy compiled markers, and persisted rail identity.
2. Add source and pane batch owners beside rail composition. Deduplicate visible keys and clear
   immediately on project/task/Node, owner roster, or contributor registration changes.
3. Draw host marks without intercepting selection, drag, pinning, menus, or task notification state.
   Use the shared accessible legend and severity mapping in desktop and terminal.
4. Add normalized accepted marks to the data projection for rail/pane-switcher replacements. A
   selected replacement can draw that host data; contributors do not gain access to its private tree.
   Keep the default provider as fallback on replacement failure.
5. Opt one shipped source and one task pane into annotations and add a loaded fixture targeting them.
   Do not silently opt every owner in. Record which owners consented and why.

## Tests and acceptance

Extend annotation, TabRail, pane-switcher, and terminal tests. Cover opt-in absent, unknown targets,
disabled owner, same IDs on two Nodes, routed-project changes, closed tasks, more marks than corners,
malformed responses, late reads, contributor reload, and selected core replacement failure.
Count transport calls for many icons and prove one batch per contributor/key set, not one per icon.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/node-core`, `@acorn/client-core`,
`@acorn/tui`, each owner plugin that opted in, affected declaration packages, and architecture.
Expect exit zero. Check source and pane marks in both real hosts and a rail replacement; ensure
menus still work without selecting their icon and every mark remains in the accessible legend.

Complete when loaded providers annotate only consenting visible owners, default and replacement rails
receive consistent data, and no status mark changes another plugin's state or authority.

## Verify before building

- Recheck source scope, pane IDs, and replacement data projection in the live rail contracts.
- Recheck the legacy marker ordering before merging accepted annotations.
- Stop if owner consent cannot be represented explicitly or requires another plugin's private tree.
