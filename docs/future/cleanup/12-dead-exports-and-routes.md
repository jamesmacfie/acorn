# 12: Dead exports and routes

> **Completion note, October 12, 2026.** The appendix list is empty, `pnpm lint` runs knip and
> passes, and the arch tests pass on Node 26.8.1. A full `pnpm test` left six packages red, all from
> this change. After the fixes, those six suites pass on their own: client-core, desktop, node (the
> failing file), linear, rollbar, and preview (its known flake passed alone). The change touches 622
> files and deletes about 2,900 more lines than it adds.
>
> What landed:
>
> - **The check.** knip 6.39 (`knip.jsonc`, `pnpm lint:exports`) runs inside `pnpm lint` between the
>   formatter check and `tsc`. It reports unused exports, unused exported types, and duplicate
>   exports. A test counts as an importer. Package `exports` map entries are checked too
>   (`includeEntryExports: true`), which is what caught `isSourceId` and the rest of the appendix
>   behind `public.ts` files. The published packages, the `@acorn/plugin-api` facade, and the
>   terminal client's alias files opt out as deliberate public surfaces. The allowlist is seven
>   `ignoreIssues` lines, each with its reason: tool-read config defaults, fixtures, type tests,
>   loaded-plugin factories named by string, two JSX runtimes, and the SDK source. AGENTS.md,
>   `docs/testing/commands.md`, `docs/testing/ci.md`, and the CI comment describe it.
> - **The sweep.** knip's fix dropped `export` from about 340 values and 250 types with no outside
>   importer. Then oxlint's unused-variable rule, run to a fixed point, deleted whatever lost its
>   last caller. Every appendix name is gone, plus `homeClient`, `startServer`, `panelMeasure` (and
>   `dashboards-core/src/measure.ts`), `pruneMapping`, `reviewNotesKey`, and the five unused
>   `notify.ts` broadcasts. `client-core/host/frames/public.ts` lost every export, so the file and
>   its exports-map entry are gone.
> - **Routes.** Deleted, with their tests, scope rows, and reference rows:
>   `POST /v1/core/workspaces/bootstrap`, `DELETE /v1/core/tasks/:id/links`,
>   `GET`/`PUT /v1/p/github/pins`, `PATCH /v1/p/git/tasks/:id/review-notes/:noteId`,
>   `POST /v1/p/docker/tasks/:id/teardown`, and Rollbar's composite `GET /items/:identifier`. The
>   Rollbar integration tests that used the composite now go through `/detail` and `/occurrences`.
> - **Re-exports.** `managedProviderForProfile` and the terminal theme re-export are gone. The four
>   desktop files import the slot registry from `slots.ts`, and `uiSlots.tsx` holds only the hosts.
> - **Facade.** 328 names left `@acorn/plugin-api` and its snapshot. The terminal client's alias
>   files dropped the same names. Kit nodes stay on `./ui` even when no plugin imports them, because
>   `support.test.ts` requires every row of the support matrix on that barrel. Three of them
>   (`KeyValueEditor`, `Grid`, `Fallback`) now come straight from their component files through new
>   client-core exports-map entries, since knip doesn't count a re-export inside the facade as a use. `docs/plugins/plugin-api.md`, `collaboration.md`, `task-checks.md`,
>   and `cli-commands.md` no longer name them. No published name changed, so
>   `publishedPluginSurface.snapshot.txt` is untouched and the major stays 5.
> - **Handed-over items.** `requestedGeneration` and `NodePluginObservation.generation` are gone
>   (phase 08). The `authorize`/`authorizeWsUpgrade` wrapper is one function (phase 09). From
>   phase 11: `ACORN_TOOL_CEILING`, `x-acorn-tool-ceiling`, `encodeToolCeiling`, and
>   `decodeToolCeiling` are gone; the workflow editor's `formatVersion` branches and
>   `renameInLayout` are gone; `AuditPage.vocabulary` and `NodePluginState.requests` are required;
>   Rollbar's `lastActivatedAt` is gone; `listByIdentifier` no longer names pre-baseline bundles.
>   From phase 15: `StartRequest.prefill`, and the four boolean fields `textStyle` repeated beside
>   its mask. No "Mixed-version path until" marker or the code under one changed: 43 before, 43
>   after.
> - **Test-only code.** About 30 helpers whose only caller was their own test are deleted with those
>   tests: nine functions of the old dashboard editor model, the chart and mapping suggestion
>   helpers, `checkDashboardPanel` (the Node validates publication in `dashboards/publication.ts`),
>   `evolveAgentState`, `refreshPullWithFiles`, `uniqueWorkflowSlug`, `recipeBrowserUrl`,
>   `currentTraceparent`, `rowIdentityKeys`, `parseVersionedDataValue`, and others. The terminal
>   client's compact density went with `setDensity`, its only setter.
>
> Decisions and deviations:
>
> - **`GET /v1/core/devices` stays.** Its client wrapper was dead, but the route is documented in
>   `core-routes.md` and `authentication.md`, its `DELETE` sibling is live, `lastSeenAt` exists only
>   to feed it, and the auth integration tests observe revocation through it.
> - **`authorizeWsUpgrade` stays exported.** Only `wsHub.test.ts` calls it, but that test is the one
>   check that an internal token from a remote peer is refused, which a loopback socket can't reach.
> - **Test seams stay.** Registry `clear*` and `_reset*` hooks, invariant tables, route builders the
>   scope tests sweep, and helpers a test uses to observe or seed live state (`bundleAccepted`,
>   `focusSession`, `extensionPointFor`, the notice and editor `serialize`/`hydrate` pairs,
>   `resolveVars`) are tests that exist for a reason. Where a test drove live
>   code through a dead helper, it now calls the live code: the Codex fan-out regression folds
>   `projectAgentEvent`, and the emitter tests read `currentTrace`.
> - **Two unwired features stay.** `bindWorkflowProcessingScope` is the write half of schedule
>   processing history, and `retryCacheRetirement` is the explicit cache-retirement retry. Nothing
>   calls either, but each fronts machinery whose other half runs. Wiring or removing them is a
>   product call.
> - **Three phase 11 items stay.** Linear's optional issue-detail fields have a live producer:
>   `toPublic` builds a summary-only detail before the detail read lands. Making the extension-point
>   defaults or the frame `scope` required would make 40 and 17 test fixtures spell out schema
>   defaults, to remove one `?? 4`. Custody's `.default([])` keeps a malformed disclosure
>   recordable, which its comment argues for.
> - **Two arch tests read declarations without `export`.** `contributionKinds.test.ts` and the
>   route-segment check in `boundaries.test.ts` matched `export type`/`export const` by regex.
>
> Left over:
>
> - `panelRefreshSeconds` has no product caller, but `docs/dashboards/panels.md` says a panel's
>   refresh is held between 30 seconds and a day through it. Either the clamp isn't applied or the
>   doc is wrong. That's a behavior question, so the function stays.
> - knip runs without `files`, `dependencies`, or `unlisted`. Turning on unused files would also
>   catch the tracked `apps/node/.plugin-build` artifact.
> - The terminal client's alias files aren't checked, because knip can't follow a Vite alias.
>   Prune them by hand with the facade.

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
