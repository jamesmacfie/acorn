# 10: Pre-baseline compatibility

> **Completion note, October 12, 2026.** Every item below is gone, except the Home board adoption,
> which turned out to serve a state that `acorn-1` still writes. `pnpm lint`, the arch tests, and the
> `@acorn/node`, `@acorn/node-core`, `@acorn/client-core`, `@acorn/custody`, `@acorn/protocol`,
> `@acorn/plugin-api`, `acorn-plugin-types`, `create-acorn-plugin`, `@acorn/tui`, `@acorn/desktop`
> (TypeScript and Rust), and workflows, rollbar, linear, and github plugin suites pass on Node 26.8.1.
>
> What landed:
>
> - Workflows save-to-repo is gone: the route, `WorkflowDefsBridge.saveToRepo`, `saveDefToRepo`, the
>   client's `workflowSaveToRepoRoute` and `saveDefToRepo`, the draft store's `saveToRepo`, their
>   tests, the route registry snapshot entry, and the reference row. Two workflow pages no longer
>   mention it.
> - The Rollbar codec reads schema version 4 only, and the Linear codec version 1 only. `CodecResult`
>   has no `migrated`. Each provider's conformance fixture is a current-version row, because the old
>   fixtures were the legacy shapes the conformance test expected to migrate.
> - The GitHub repos list reads freshness from the sync row alone. `/refresh` zeroes only the sync
>   row, since nothing else reads a repo row's `fetchedAt`. The column stays, because dropping it
>   needs a migration.
> - `open`, `contribute`, and `entries` are gone from `ctx.extensionPoints`, both type files,
>   `hostCallModes.ts`, the published surface snapshot, and `docs/plugins/plugin-api.md`. The
>   workflows runner's `WorkflowExtensions` reads `handlers`.
> - `POST /v1/core/integrations` takes `providerId` only. The Rollbar integration test sent
>   `provider`, so it sends `providerId`.
> - The prefs comment in `db/schema.ts` no longer describes installs from before boot-minting.
>
> Decisions and deviations:
>
> - **`PLUGIN_API_MAJOR` is `4`.** `tools/arch/publishedPluginSurface.test.ts` refuses to drop a
>   published member under the same major, and `docs/plugins/publishing.md` says a breaking removal
>   needs one. The scaffold, the three Node test fixtures, the manifest schema title, the plugin-types
>   README, the authoring docs, and the release notes say `4`. No plugin outside this repository
>   calls the aliases. I checked the 11 under `~/Source/acorn-*`. Six of them declare
>   `"apiVersion": "3"` and stop loading until their manifests say `"3 || 4"` or `"4"`. That's a
>   manifest edit and a rebuild, with no code change.
> - **Home board adoption stays, renamed `adoptUnscopedHome`.** Home is the default source at `/`.
>   With no project routed and no active task, `createActiveWorkspaceId()` answers `undefined`, so a
>   board composed there is keyed `home`. Adoption is what carries it into the next workspace that
>   opens Home. Deleting it would hide those panels, so requirement 3 isn't done. The comments, the
>   test names, and `docs/dashboards/placements.md` describe the live case instead of boards from
>   before August 24. Whether Home should let a person compose a board with no workspace is a
>   product question, and the answer decides whether adoption can go.
> - **The trust schema lost ten defaults, not two.** Every grant array except `customAgents`, and the
>   file's `devGrants`, predates the baseline-named trust file, and the baseline commit's writer
>   always wrote them. `customAgents` (September 29) and `nodeId` (September 27) postdate the cutoff,
>   so they keep their defaults for proposal 11. The custody test that read a pre-webview file is
>   deleted. Two tests that hand-wrote a file without `devGrants` now include it.
> - **The GitHub repos fallback had a live producer.** `resolveRepo` in `repoMirror.ts` writes one
>   repo row with no sync row when a person opens a repository before the list loads. The fallback
>   then served that one-row list as fresh. Without it, the list reads as cold and fetches in full.
>   A new test in `repos.test.ts` covers that.
>
> For later phases: proposal 11 owns the `customAgents` and `nodeId` trust defaults. The published
> surface snapshot records major 4, so proposal 12 needs major 5 to remove any published name. Its
> facade names in `@acorn/plugin-api` aren't published and don't need one.

This proposal deletes code that only serves data or builds from before the `acorn-1` baseline on
September 24, 2026. The baseline refuses that data and those builds, so none of this code can run.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md). The [compatibility cutoff](./README.md#the-compatibility-cutoff)
explains why the date decides.

## Problem

Each item below predates the cutoff, dated with `git log --reverse -S`. Each serves data or callers
that an `acorn-1` Node or client refuses.

**Workflows "save to repo," refused since September 20.** The route `POST /defs/:id/save-to-repo` in
`plugins/workflows/src/server/routes/defs.ts` calls a bridge method that always returns an error.
`saveDefToRepo` in `plugins/workflows/src/server/definitions/store.ts` has no callers and returns an
error too. The client keeps `workflowSaveToRepoRoute` and `saveDefToRepo` in
`plugins/workflows/src/client/workflowsClient.ts`, and `saveToRepo` in
`plugins/workflows/src/client/editor/draftStore.ts`, and nothing calls any of them.
`docs/api-reference/workflow-routes.md` keeps a row for the route "for older clients".

**Old provider cache formats.** These conversions handle states no `acorn-1` database holds:

- `parseRollbar` in `plugins/rollbar/src/server/provider.ts` converts schema versions 1, 2, and 3,
  and bare rows, into version 4.
- `parseLinear` in `plugins/linear/src/server/provider.ts` converts a pre-descriptor row.
- The `migrated` flag on `CodecResult` in `packages/node-core/src/server/integrations/types.ts` is
  set by every codec and read only by one assertion in
  `apps/node/test/integration/conformance.test.ts`.
- The repos route in `plugins/github/src/server/routes/repos/repos.ts` falls back for a "pre-ETag
  mirror" with repo rows and no sync row. The refresh writes both in one batch.

**The pre-workspace dashboard board.** `adoptLegacyHome` and `adoptLegacyHomeDashboards` in
`packages/client-core/src/features/dashboards/persist.ts` re-key boards saved before Home became per
workspace on August 24. Those boards lived in Node prefs, which the reset cleared. Home calls the
adoption every time it draws, from `packages/client-core/src/features/workspaces/Home.tsx`.

**Renamed extension point methods.** The plugin context still accepts `open`, `contribute`, and
`entries`, renamed on August 31 to `declare`, `handle`, and `handlers`. They live in
`packages/node-core/src/server/pluginHost/context.ts`, `packages/node-core/src/server/pluginHost/types.ts`,
and the published `packages/plugin-types/src/contracts/extensionPoints.ts`. Every plugin that loads
needs an `acorn-1` manifest, which postdates the rename by more than three weeks. The only caller
left is the workflows runner, `plugins/workflows/src/server/runs/runner.ts`, which calls `entries`.

**The legacy `provider` field.** `POST /v1/core/integrations` accepts `provider` as an alias for
`providerId`, in `packages/node-core/src/server/routes/integrations.ts`. That arrived on August 7.
The client sends only `providerId`.

**Trust file defaults.** The plugin trust schema in `packages/custody/src/plugins/pluginTrustStore.ts`
defaults `webviews` and `keyClaims` for files "written before webviews," from August 23. The file is
named for the baseline, so every copy postdates both fields.

**Comments about pre-baseline installs.** `packages/node-core/src/server/db/schema.ts` describes
installs that "predate boot-minting." No such install can open.

## Goal

No branch reads a pre-baseline shape, accepts a pre-baseline name, or answers a pre-baseline caller.

## Requirements

1. Delete the save-to-repo route, bridge method, store function, client wrapper, draft store action,
   their tests, and the reference row.
2. Reduce each provider codec to its current version. Delete `migrated` from `CodecResult` and the
   conformance assertion. Delete the GitHub repos fallback and read freshness from the sync row.
3. Delete `adoptLegacyHome`, its caller in Home, and any placement-key handling for a missing
   workspace that exists only for adoption.
4. Delete the three extension point aliases from the context, both type files, and the published
   surface snapshot. Change the workflows runner to call `handlers`.
5. Delete the `provider` alias from the integrations route's body schema.
6. Make `webviews` and `keyClaims` required in the trust schema.
7. Remove the pre-baseline sentence from the prefs schema comment.

## Out of scope

Compatibility added after the cutoff belongs to
[11: mixed-version policy](./11-mixed-version-policy.md).

## Risks

The extension point aliases are in the published `@acorn/plugin-types` declarations. Removing them
is a breaking change for any third-party plugin that still calls them. Check the plugins you run
outside this repository, such as the machine-stats and worktree manager plugins, and bump the
published package's major if your publishing policy requires it.

## Acceptance

- `git grep -n "save-to-repo\|saveDefToRepo\|adoptLegacyHome\|migrated:" apps packages plugins docs`
  returns only unrelated matches.
- No codec handles a schema version below its current one.
- `pnpm test` passes, including the provider conformance suite.
