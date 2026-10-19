# Phase 5: let a rail source read the workspace

## Completion note

Built on October 20, 2026, on branch `phase-5-workspace-rail-sources`.

What landed:

- `workspaceScoped` on a rail source, with its description, in `chromeDescriptors.ts`. The parser
  refuses a source that also declares `projectScoped`, with "a source declares projectScoped or
  workspaceScoped, never both". `acorn-plugin.schema.json` is regenerated.
- `createSourceItems` in `client-core/host/chrome/sourceItems.ts` holds the rail list's query. Both
  `ChromeSourcePanel.tsx` and the terminal's `SourcePanel.tsx` call it, so the two clients can't
  build the route or the cache key differently. It reads the routed project for a project-scoped
  source, the active workspace for a workspace-scoped one, and nothing otherwise. With no workspace
  known, it calls no route and answers an empty list, so the source draws its `emptyState`.
- `scopedSourceItemsPath` takes a `SourceScope`, `{ projectId?, workspaceId? }`, and appends
  `project` or `workspace`. `readRailSearch`, `chromeSearchKey`, and `createSourceSearch` take the
  same scope, so `search` gets `?workspace=` too. A search with no scope asks nothing.
- Tests: `sourceItems.test.tsx` covers the workspace route, a workspace switch, no workspace, the
  project scope, and one cache entry for an unscoped source. `chromeData.test.ts`,
  `sourceSearch.test.tsx`, and `manifest.test.ts` cover the path, the unscoped search, and the parse
  rule.
- Docs: [descriptors](../../plugins/descriptors.md#rail-sources), and the site's rail source guide
  and sources reference.

Decisions and deviations:

- Step 2 is skipped. The source registry carries `projectScoped` for shell controls that follow the
  project: the topbar picker, copy link, and `core:source` marks. None of them changes for a
  workspace-scoped source, so a registry field would have no reader. The panels read the descriptor.
- The workspace ID is wrapped in a memo before it reaches the fan-out. `createActiveWorkspaceId`
  reads the task list, so without the memo every task change would refetch the rail list.
- The cache key's scope part is the project or the workspace ID. A source declares only one, so
  the two can't collide.
- While the workspace mapping loads at startup, a workspace-scoped source briefly shows its empty
  state, because the active workspace is undefined until then. The workspace query is usually
  cached, so this is short.
- The other site pages that `stale --touching` lists cite the descriptors doc or the chrome folder
  in general, and nothing they say changed.

For later phases:

- Phase 8's rail source declares `workspaceScoped: true`, reads `workspace` from the query of its
  `items` and `search` routes, and passes it as the data source query's `workspaceId`. It must not
  declare `projectScoped`.

Date: October 19, 2026. Status: built. Needs nothing.

## Goal

A loaded rail source can declare `workspaceScoped: true`. The host then sends the active workspace to
the source's `items` and `search` routes, and keeps one cached list per workspace. A source can list
"this workspace's sessions that need a look" without guessing the workspace from a project.

## Starting point

- `projectScoped` is the model. Its schema is in `packages/protocol/src/plugin/manifest/chromeDescriptors.ts`.
  The desktop reads it in `packages/client-core/src/host/chrome/ChromeSourcePanel.tsx`, which keys the
  cache by the routed project and builds the route with `scopedSourceItemsPath` in
  `packages/client-core/src/host/chrome/chromeData.ts`. The terminal reads it in
  `apps/tui/src/plugins/SourcePanel.tsx`.
- A source without `projectScoped` has one cache entry for every project, on purpose, so a project
  switch doesn't refetch an identical list.
- `createActiveWorkspaceId` in `packages/client-core/src/features/workspaces/activeWorkspaceId.ts`
  answers the workspace Home draws. It's undefined while no workspace is known.
- A rail source belongs to the left rail, and the rail belongs to the workspace. The source's rows,
  though, are whatever its route answers, with no workspace passed.

## The design

`workspaceScoped` is a boolean on a rail source, beside `projectScoped`. With it set:

- The host appends `?workspace=<id>` to `items` and `search`, from `createActiveWorkspaceId`.
- The cache key includes the workspace, so switching workspace shows that workspace's list and
  switching back is instant.
- With no workspace known, the source draws its `emptyState` and calls no route.
- The plugin reads the parameter as untrusted input, as it does `project`. A plugin that reads data
  sources passes it as the query's `workspaceId` scope, and the Node checks it there.

A source can't declare both `workspaceScoped` and `projectScoped`. The manifest parser refuses the
pair, because a project already names its workspace, and two scopes on one list would leave the reader
guessing which one it follows. A source that needs the project uses `projectScoped`, as before.

A source's `panels` region already follows the workspace after [phase 1](./01-dynamic-ui-fit.md).
`core:source` marks keep their `projectId` key, which is `""` for a source that isn't project scoped.

## Steps

1. Add `workspaceScoped` to the schema, with its description, and the parse rule against
   `projectScoped`. Regenerate `packages/plugin-types/acorn-plugin.schema.json`.
2. Carry it through the source registry in `packages/client-core/src/host/registries/sources/sources.ts`.
3. Read it in `ChromeSourcePanel.tsx` and `apps/tui/src/plugins/SourcePanel.tsx`. Extend
   `scopedSourceItemsPath` to take the workspace, so both clients build the route one way.
4. Document it in [descriptors](../../plugins/descriptors.md#rail-sources) beside `projectScoped`.

## Acceptance

- A test source with `workspaceScoped` receives `?workspace=` with the active workspace on both
  clients, and a workspace switch reads the other workspace's list.
- A manifest declaring both scopes fails to parse with a message that names the two fields.
- A source without the flag behaves as before, with one cache entry across workspaces.
