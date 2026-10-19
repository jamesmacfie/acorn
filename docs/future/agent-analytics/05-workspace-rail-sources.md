# Phase 5: let a rail source read the workspace

Date: October 19, 2026. Status: proposed. Needs nothing.

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
