# 11: Mixed-version policy

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
