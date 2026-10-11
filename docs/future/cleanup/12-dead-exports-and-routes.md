# 12: Dead exports and routes

This proposal deletes exported code that nothing references, the routes only that code called, and
facade names no plugin uses. It also adds a check, so dead exports get caught at the time they die.

Date: October 11, 2026. Status: proposed. Depends on:
[09: remove the preview tunnel](./09-remove-preview-tunnel.md),
[10: pre-baseline compatibility](./10-pre-baseline-compatibility.md), and
[11: mixed-version policy](./11-mixed-version-policy.md), because each of those frees more code.
Part of the [cleanup programme](./README.md).

## Problem

Refactors leave exports behind that don't call themselves legacy. A scan of `apps/`, `packages/`,
and `plugins/` found 74 exported functions, constants, and classes that no other file references,
not even a test. The appendix lists them. Most were last changed between July and September 2026.
Four are `_reset` hooks that no test calls.

Some of the dead client wrappers lead to server routes. `bootstrapWorkspaces` in
`packages/client-core/src/features/workspaces/workspaceMutations.ts` was the only caller of
`POST /v1/core/workspaces/bootstrap`, in `packages/node-core/src/server/routes/projects/workspaces.ts`.
Other wrappers in the list, such as `setTaskPull`, `removeTaskLink`, `revokeNodeDevice`, and
`editReviewNote`, may lead to routes that the CLI, the MCP tools, or a plugin still call. Each needs
checking before its route goes.

A further 497 exports are referenced only by tests. Many are pure functions exported to test them,
which is fine. Others are leftovers whose only remaining user is their own test.

Three re-exports exist only to keep old import paths:

- `managedProviderForProfile` in `plugins/agents/src/server/sessions/sessionExecute.ts`, kept "for
  the callers already on it". There are none.
- The appearance re-export in `plugins/terminal/src/client/theme.ts`. Its only importer takes nothing
  from it.
- `uiSlots.tsx` in `packages/client-core/src/host/registries/extensionPoints/` re-exports the
  registry from `slots.ts` to keep an import path for four desktop files.

The first-party facade, `@acorn/plugin-api`, re-exports 1,093 names, listed in
`packages/plugin-api/src/surface.snapshot.txt`. About 150 of them appear nowhere in `plugins/` or
`apps/`. Some are types that other exported types need, but the rest widen the facade for no
caller.

## Goal

Every export has a caller outside its own file, or a test that exists for a reason. Nothing checks
that by hand.

## Requirements

1. Delete each export in the appendix, with any code only it reached.
2. For each dead client wrapper that names a route, search the CLI, the MCP tools, plugins, and the
   docs for callers. Delete routes with no caller, and their reference rows.
3. Review the test-only exports by package. Delete the code a test is keeping alive for no product
   reason, and the test with it.
4. Delete the three compatibility re-exports and point importers at the source.
5. Prune facade names no plugin or app uses, unless another exported type needs them. Regenerate the
   surface snapshot.
6. Add an unused-export check to `pnpm lint`. Evaluate knip first, because it understands exports
   maps and workspaces. Mark deliberate public entry points, such as `public.ts` files, the facade,
   and the plugin entry points, as entries, so the check reports only real leftovers.

## Acceptance

- The unused-export check passes in `pnpm lint` with an empty or documented allowlist.
- The appendix list is empty.
- `pnpm test` passes.

## Appendix: unused exports on October 11, 2026

The scan treated a name as used if any other tracked source or test file mentions it. Recheck each
before deleting, because a name built from a string won't show up.

- `packages/client-core/src/features/dashboards/dashboardEditorModel.ts`: `setRoleField`, `exactStatusFields`
- `packages/client-core/src/features/dataSources/editorModel.ts`: `observedFields`
- `packages/client-core/src/features/dataSources/queries.ts`: `discoverDataSourcesOptions`
- `packages/client-core/src/features/tasks/taskMutations.ts`: `renameTask`, `setTaskPull`, `removeTaskLink`
- `packages/client-core/src/features/tasks/tasks.ts`: `isSourceId`, `activeLayout`, `hydrateTaskLayouts`
- `packages/client-core/src/features/workspaces/workspaceMutations.ts`: `setWorkspaceExternalProjects`, `bootstrapWorkspaces`, `setProjectWorkspace`, `setProjectHidden`
- `packages/client-core/src/host/annotations/annotations.ts`: `hasAnnotations`, `annotationSignature`
- `packages/client-core/src/host/chrome/chromeStyles.ts`: `PLUGIN_STYLE_PREFIX`
- `packages/client-core/src/host/chrome/extendedPane.ts`: `_resetExtendedPane`
- `packages/client-core/src/host/chrome/sourcePanel.ts`: `_resetSourcePanel`
- `packages/client-core/src/host/registries/extensionPoints/exclusiveSlots.ts`: `exclusiveSlotFailureCount`
- `packages/client-core/src/host/registries/extensionPoints/extensionPoints.ts`: `extensionPointOwners`
- `packages/client-core/src/host/registries/panes/panes.ts`: `paneLabel`
- `packages/client-core/src/host/tree/workerHost.ts`: `pluginWorkerUrl`
- `packages/client-core/src/infra/node/apiClient.ts`: `apiError`
- `packages/client-core/src/infra/node/fleet.ts`: `homeClient`
- `packages/client-core/src/infra/node/fleetActions.ts`: `nodeDevices`, `revokeNodeDevice`
- `packages/client-core/src/infra/persistence/deviceConfigSync.ts`: `configPluginRequests`, `selectedConfig`
- `packages/client-core/src/infra/persistence/persistedState.ts`: `nodeIdFromStorageKey`
- `packages/client-core/src/kit/tokens/focusRoles.ts`: `focusRole`
- `packages/dashboards-core/src/model.ts`: `newPanelId`
- `packages/node-core/src/server/integrations/connections.ts`: `ownedConnections`, `withOwnedConnections`
- `packages/node-core/src/server/integrations/resourceRuntime.ts`: `providerResource`
- `packages/node-core/src/server/notify.ts`: `broadcastTerminalSessionsChanged`, `broadcastWorkflowStepChanged`, `broadcastWorkflowStepEvent`, `broadcastAgentSessionChanged`
- `packages/node-core/src/server/pluginHost/emits.ts`: `declaredEmits`, `_resetEmits`
- `packages/node-core/src/server/plugins/installer.ts`: `isInstalled`
- `packages/node-core/src/server/storage/diskEncryption.ts`: `_setDiskEncryption`
- `packages/node-core/src/server/transport/listener.ts`: `startServer`
- `packages/node-core/src/server/transport/wsHub.ts`: `wsHasClients`
- `packages/node-core/src/server/worktrees/taskWorktree.ts`: `repoFor`
- `packages/protocol/src/chrome/extensionPoints.ts`: `kindNeedsLocation`, `isCoreHookPoint`
- `packages/protocol/src/plugin/contract.ts`: `hasDocumentRegion`, `isCoreSlotSurface`
- `packages/protocol/src/runtime/runs.ts`: `runsKey`
- `plugins/agents/src/client/sessions/managedDrafts.ts`: `hydrateManagedDraft`, `setManagedDraft`
- `plugins/agents/src/client/sessions/wsChannel.ts`: `_resetAgentWsChannel`
- `plugins/agents/src/shared/schemas.ts`: `agentRuntimeStateSchema`, `agentAttentionReasonSchema`
- `plugins/docker/src/client/dockerClient.ts`: `teardownTaskContainers`
- `plugins/editor/src/client/editorDocumentPool.ts`: `retireEditorFile`
- `plugins/editor/src/client/editorTreeState.ts`: `clearEditorTreeStates`
- `plugins/editor/src/client/editorViewState.ts`: `clearEditorViewStates`
- `plugins/editor/src/client/wsChannel.ts`: `_resetEditorWsChannel`
- `plugins/git/src/client/changes/reviewNoteMutations.ts`: `editReviewNote`
- `plugins/git/src/shared/changes/api.ts`: `reviewNotesKey`
- `plugins/github/src/client/clientRoutes.ts`: `githubBrowseRoute`, `githubPullRoute`
- `plugins/github/src/client/pullList/filterStore.ts`: `hydratePrFilters`
- `plugins/github/src/client/queries.ts`: `pinsOptions`
- `plugins/linear/src/shared/api.ts`: `linearProjectsRoute`
- `plugins/rollbar/src/shared/api.ts`: `rollbarItemRoute`, `rollbarItemKey`, `rollbarItemMetadataKey`, `rollbarOccurrencesKey`, `rollbarOccurrenceKey`
- `plugins/workflows/src/server/authoring/edit.ts`: `restoreProtectedWorkflowTargets`
