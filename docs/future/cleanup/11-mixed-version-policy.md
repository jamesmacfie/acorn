# 11: Mixed-version policy

> **Completion note, October 12, 2026.** The owner chose **Keep the additive rule**, so nothing is
> deleted. `pnpm lint`, the arch tests, and the `@acorn/custody` suite pass on Node 26.8.1. Only two
> files changed code, both in custody. For the rest, a script reprinted each changed file with
> TypeScript's printer and comments removed, and compared it with `HEAD`. Every other file matched.
>
> What landed:
>
> - **The policy.** `docs/api-reference/transport.md § Mixed builds` says a client, a Node, and a
>   loaded plugin's bundle may differ within a major by up to 90 days. It also covers device state
>   and stored data an earlier build wrote. It says what a client does with a build outside the
>   policy, and gives the removal rule.
> - **The removal rule.** A path's date is 90 days after the commit that added it, found with
>   `git log --reverse -S`. Acorn tags no releases and has no updater, so the commit date is the one
>   clock every build carries. Ninety days gives a paired Node elsewhere, or an outside plugin, three
>   months to catch up. A comment that covers several fields takes the newest field's date.
> - **The marker.** Every path's comment carries `Mixed-version path until <date>.`, and
>   `git grep -n "Mixed-version path until"` lists them: 40 markers in 35 files, dated from
>   December 24, 2026 to January 9, 2027. Groups 1, 2, 3, 5, and 6 are all marked, and so is each
>   group 4 field added after the baseline.
> - **The custody single-viewer names.** `legacyOwner` and `legacyRecipient` are `singleOwner` and
>   `singleRecipient`. The terminal client's and the CLI's brokers never multiplex, so they always
>   use that transport. Only the check that a Node advertises viewers is a mixed-version path.
>   `websocket.md` and `transport.md` say "single-viewer" too.
>
> Decisions and deviations:
>
> - **`workerHost.ts` keeps its five booleans.** They aren't one state. `awaitingPong` is the
>   heartbeat and runs beside every other flag. `connected` exists only to detect the legacy
>   protocol. `constructionReady` and `treeReady` arrive from two sources, and nothing in the code
>   orders them, so folding them into one field would assume an order the code doesn't enforce. Once
>   legacy mode goes, `connected` and `readyProtocol` go with it, and `dead`, `constructionReady`, and
>   `treeReady` can become one stage field. The file has a dated header and no other change.
> - **`resolvePlanColumns` isn't a compatibility path.** It doesn't check the plan version, and
>   `blankPlan` starts a version 2 plan with no columns, so any single-source plan without columns
>   reaches it. The comment says that, with no date.
> - **Comments that claimed support for pre-baseline builds are reworded, not deleted.** Each said an
>   older Node omits a field that every `acorn-1` Node sends. They now say so. Persisted query
>   entries expire after a day, so no cached pre-baseline answer survives either.
> - **The phase doc's 404 claim is narrower than it reads.** A second 404 from `/client.js` still
>   reports `not-found`. Only a `/client.js` that serves a different candidate reads as a hash
>   mismatch.
> - **Removing the SDK's `legacy` needs a major.** `AcornBridge.treeBridgeMode` is in the published
>   surface snapshot, so narrowing its union is a shape change under the published promise.
>
> For proposal 12. These look dead but a dated path keeps them alive until its date:
> `corePluginBundleRoute` and the Node's `GET /:id/client.js`, `legacyRuntimeIdentityWithheld` and
> the omitted-`active` branch of `runtimeIdentityForRow`, the editor bridge's `lineMarkers` (only the
> no-revision route branch calls it), `resolveSettingsAlias` and the settings `aliases` field, the
> composer's `legacyKeys`, `treeBridgeMode: 'legacy'` in the SDK and `bridgeTypes.ts`, the `legacy`
> parameter of `persistedAttendance`, and `adoptRenamedPluginDb`.
>
> These predate the baseline, so no `acorn-1` build needs them. Each is dead code to delete, and none
> is a mixed-version path:
>
> - The optional `vocabulary` on `AuditPage` and `requests` on `NodePluginState`.
> - The optional extension point defaults (`max`, `timeoutMs`, `onTimeout`, `collect`, and
>   `priority`) in the roster projection, and the client's `descriptor.max ?? 4`.
> - The roster row's optional `scope` on frame surfaces.
> - Custody's `.default([])` on disclosure `extensions` and `schedules`. Keep a default if you want a
>   malformed disclosure to stay recordable.
> - Rollbar's `GET /items/:identifier` composite route, which no client calls, and its optional
>   `lastActivatedAt`.
> - Linear's optional issue detail fields.
> - `listByIdentifier`'s error message, which still names bundles built before the store was
>   provider-scoped.
> - `ACORN_TOOL_CEILING` and `x-acorn-tool-ceiling`, which the MCP proxy still sends and nothing
>   uses for authority.
> - The workflow editor's `formatVersion !== 1` branches in `draft.ts` and `draftStore.ts`.
>   `formatVersion` has been the literal 1 since the baseline commit.
>
> One comment I couldn't verify: the GitHub import's "placeholder left by an older import" dates from
> August 10. Check whether any current path still creates a project with no path before you delete
> its branch.

This proposal asks for one decision: how far apart may a client, a Node, and a loaded plugin's build
be? It then lists the compatibility code each answer lets you delete. Everything here postdates the
`acorn-1` cutoff, so it can still run, unlike [10: pre-baseline compatibility](./10-pre-baseline-compatibility.md).

Date: October 11, 2026. Status: proposed, decision needed. Depends on:
[01: green the gate](./01-green-the-gate.md). Part of the [cleanup programme](./README.md).

## Problem

`docs/api-reference/transport.md` says changes within a major are additive, so older `acorn-1`
clients and Nodes keep working. Since September 24, 2026, about a dozen compatibility paths were
added under that rule. Some only accept a missing optional field. Others keep a whole second
protocol. Every client and Node ships from this repository, and the only loaded plugins outside it
are the owner's own. So the rule costs more than it buys, unless paired Nodes on other machines
upgrade on their own schedule.

The paths fall into six groups.

**1. Plugin bundles built with an older SDK.** The tree worker speaks two protocols. Bundles built
before October 1 use one immutable slot per worker, and later bundles share a worker per plugin and
hash. `packages/client-core/src/host/tree/workerHost.ts` detects the protocol and keeps a "legacy"
mode. Its `Live` record carries about 18 fields, five of them booleans that together encode one
state. The same split reaches `packages/client-core/src/host/frames/sdk/connection.ts`,
`packages/client-core/src/host/frames/sdk/treeChannel.ts`,
`packages/client-core/src/host/tree/bridgeAuthority.ts`, `apps/tui/src/plugins/workerFactory.ts`,
and the SDK's own type in `packages/plugin-sdk/src/public.ts`. The HTTP plugin carries matching
fallback keys for a host without bridge authority, in `plugins/http/src/tree/variableModel.ts` and
`plugins/http/src/tree/panelModel.ts`.

**2. Device state written by an earlier build.** `plugins/agents/src/client/composer/composerDraftStorage.ts`
spends about half its length moving composer drafts out of three storage keys used before October 2.
Settings keeps four old page IDs as aliases, `connections`, `mcp#files`, `agent-concurrency#limits`,
and `agent-pricing#claude`, declared in `packages/client-core/src/features/settings/corePages.ts` and
`plugins/agents/src/client/index.ts`. The resolver lives in
`packages/client-core/src/host/registries/shell/settings.ts`,
`packages/client-core/src/features/settings/SettingsView.tsx`, and `apps/tui/src/chrome/settingsStore.ts`.

**3. A client and a Node from different builds.** These paths add code on one side or both:

- The Node keeps `GET /:id/client.js` in `packages/node-core/src/server/routes/plugins/plugins.ts`
  for clients without the hash route. Custody retries that route after a 404 in
  `packages/custody/src/plugins/pluginCache.ts`. A genuine 404 then triggers a second fetch and is
  reported as a hash mismatch, not "not found".
- Line markers answer a request without a revision with a plain array, in
  `plugins/editor/src/server/routes/editor.ts`. `plugins/editor/src/client/editorClient.ts` checks
  for that array.
- `packages/client-core/src/host/plugins/runtimeIdentity.ts` reads a roster row with no `active`
  field.
- `packages/custody/src/broker/eventViewers.ts` handles a Node that doesn't advertise event viewers.

**4. Optional wire fields.** About 25 schema fields carry a comment like "an older Node omits this,"
for example in `packages/protocol/src/plugin/contract.ts`,
`packages/protocol/src/transport/api/pluginState.ts`, and `plugins/agents/src/contract/wire.ts`. Each
costs a few characters and a default.

**5. Stored data written by an earlier build.** Removing these needs a backfill migration first:

- Agent turns and sessions written before October 8 have no attendance value.
  `persistedAttendance` in `plugins/agents/src/server/sessions/attendance.ts` falls back, and five
  call sites pass the fallback inputs. Without it, those sessions throw.
- GitHub review threads mirrored before October 7 have a null `outdated` value,
  `plugins/github/src/node/schema.ts`. A mirror refresh replaces them.
- `resolvePlanColumns` in `packages/dashboards-core/src/plan.ts` treats a version 1 panel with no
  columns as "all source fields". Check whether any writer still saves an empty column list.

**6. One-time moves to keep until every Node has started once.** `adoptRenamedPluginDb` in
`packages/node-core/src/server/plugins/storage.ts` moves the `changes` database to `git`, and runs
from `apps/node/src/composition/composition.ts`. The Node key sealing in
`packages/custody/src/custody/nodeKeys.ts` converts plain key files. Both arrived on October 11.

## Decision

Choose one answer to "may a client and a Node differ?":

| Option | Meaning | Deletes |
| --- | --- | --- |
| Same build | A client refuses a Node from a different build, through the probe it already makes. | Groups 1, 2, and 3. Group 4 shrinks as fields become required. |
| Same build for plugins, tolerant wire | Plugins and device state follow the build. Client and Node may differ by additive fields. | Groups 1 and 2, and the bundle route in group 3. |
| Keep the additive rule | No change in policy. | Nothing, but give each path a removal date. |

Recommendation: delete groups 1 and 2 under every option. Rebuilding your two outside plugins and
losing an unsent pre-October-2 draft cost less than the code. Choose between the first two options
based on whether you run paired Nodes on other machines that upgrade separately.

## Requirements

1. Record the decision in `docs/api-reference/transport.md` in place of the additive rule's wording,
   and say what a client does when it meets a build the policy doesn't support.
2. Delete the groups the decision allows. Replace the five booleans in `workerHost.ts` with one
   state field once the legacy mode is gone.
3. Write a backfill migration for each group 5 item before deleting its fallback, then delete the
   fallback.
4. Give each group 6 item a removal date in its comment, and delete it on that date.
5. Rebuild and reinstall any plugin outside this repository against the SDK before the tree protocol
   goes.

## Acceptance

- `git grep -n "'legacy'" packages/client-core/src/host apps/tui/src/plugins packages/plugin-sdk/src`
  returns nothing, if group 1 goes.
- The transport reference states the policy, and no source comment claims an older build is
  supported that the policy doesn't support.
- `pnpm test` passes, and a desktop with a loaded plugin works against a Node of the same build.
