# Structure follow-up: the three places the drawing still lies

Status: proposal, 2026-08-30. Waits on [structure/](../structure/README.md) phases 5 to 7.

[structure/](../structure/README.md) makes the folder names say what
`docs/architecture-overview.md` says. An architecture review on 2026-08-30, run after structure phase
4 shipped, asked a different question: if someone drew acorn on a whiteboard from the docs alone,
where would the drawing be wrong? The runtimes, the plugin tiers, and the control-plane seams
(`ctx.providers.nodes`, enrollment, adopt, the first-party rule) all drew correctly. Three things did
not, and none of them is a folder move, which is why they are not a structure phase. A fourth candidate,
that the compiled-only contribution kinds carry no per-row reason, did not survive checking
and is recorded in [refused.md](./refused.md) so it is not found again.

Paths in this folder are hints, not promises. Current paths were checked on 2026-08-30 against a
tree with structure phase 5 applied. Target paths are written without a workspace prefix so the path
checker does not chase files that do not exist yet.

## The three findings

**The custody box is named after one host.** `@acorn/desktop-helper` is the fleet store, device-token
custody, plugin trust, and node supervision. Nothing in it is desktop-specific: the arch test already
keeps it shell-free, [terminal/](../terminal/README.md) needs the same box ("one node, three
supervisors"), [remote.md](../remote.md) needs it as a `WebBroker`, and
[client-plugins/](../client-plugins/README.md) names its contract `PluginCustody`. Three hosts, one
package, named for the first host. [structure/refused.md](../structure/refused.md) refused the rename
on release-path cost. The owner overturned that on 2026-08-30 because the argument is new: the cost
was weighed against a better word, and it is a better word for three programmes.

**Core still names plugins.** The task-origin enum in the architecture doc is a comment on a text
column (`packages/node-core/src/server/db/schema.ts:158`) and one built-in row in
`packages/client-core/src/features/tasks/origin.ts`. Around it: `features/tasks/activate.ts` branches
on `providerId === 'linear'` to pick the first pane, `features/tabs/TabRail.tsx` and
`features/tasks/agentSessions.ts` probe for the terminal plugin, `infra/persistence/preferenceSlices.ts`
names `github.diff-view`, `packages/node-core/src/server/agentTools/contextSections.ts` builds the
`pr`, `notes`, `memory`, and `issues` sections itself, `packages/node-core/src/server/mcpRegister.ts`
knows `claude` and `codex`, and `apps/desktop/src/client/TaskView.tsx` and `App.tsx` require the
terminal plugin and ship a `task.terminal.new-claude` command. None is dangerous. Together they mean a
fourth tracker plugin needs a core edit, which is the test the plugin docs say a seam must pass. The
composition root's `GITHUB_MIRROR` import (`apps/node/src/composition/composition.ts`) is legal and
stays: a composition root is where plugin names belong.

**The plugin context type promises more than a loaded plugin gets.** `NodePluginContext`
(`packages/node-core/src/server/pluginHost/types.ts`) carries members that are compiled-only:
`routes.register`, `contextSections`, `tools`, `events.channel`, `events.streams`, `providers.model`.
The docs' own words for the failure are "an immediate not a function". The published
`packages/plugin-types/src/public.ts` is the honest twin, kept by hand, so two types can drift. The
registries also speak five verb families: `register`, `declare/record`, `open/contribute/entries`,
`declare/handle/run`, `provide/get/require`. Each is defensible alone. Together they are the thing an
author looks up every time.

## The phases

Every phase ends with `pnpm lint`, `pnpm test`, and the `tools/arch` suite green, and with the owning
docs saying the new true thing ([docs-migration.md](./docs-migration.md) says which).

| Phase | What it does | Waits on |
| --- | --- | --- |
| [0: custody rename](./phase-0-custody-rename.md) | `packages/desktop-helper` becomes `packages/custody`, `@acorn/custody`. The desktop's `src/helper/` process keeps its name. | structure 7 |
| [1: core plugin names](./phase-1-core-plugin-names.md) | Each plugin-name literal in `packages/*` moves behind a seam that already exists; a shrinking-baseline arch rule holds the rest at zero. | 0 |
| [2: honest context](./phase-2-honest-context.md) | One context type per tier on both sides, the published twin held by a type test, and one verb vocabulary across the registries. | structure 5 |
| [3: docs sweep](./phase-3-docs-sweep.md) | Re-check every path the phases moved, retire this folder. | 2 |

What was considered and set aside is in [refused.md](./refused.md).

## Keeping the cloud door open

There is a future where a closed-source control plane starts nodes on short-lived machines and a
client elsewhere drives them. It is not designed, and the owner decided on 2026-08-30 that it should
not be designed here. What this folder does instead is name four facts that are true today, that the
cloud will lean on, and that no phase here or elsewhere may quietly change. Each has an owning doc,
and this list only points.

- **A provided node is an endpoint the custody box dials, pinned by the node's own certificate
  fingerprint.** There is no seam for a plugin to say how to reach a node, and there should not be
  one: the dial happens in the credential path. A provider that cannot give a dialable URL has a
  networking problem, not a plugin problem. `docs/plugins.md` § Node providers; `docs/security.md`
  § The control plane.
- **`providerNodeId` is the provider's stable identity for a machine, and `nodeId` may change under
  it.** A node is its data root; a new disk is a new node. Whatever the cloud decides about durable
  volumes, the two ids stay separate. `packages/protocol/src/nodeProviders.ts`.
- **`ACORN_BUNDLED_PLUGINS_DIR` is the one boot input a headless node reads to arrive with plugins.**
  It is a developer path today (`apps/node/src/entries/standalone.ts`, `docs/node-distribution.md`
  § Plugins). A baked image would use the same variable. Nothing here promotes it; nothing here
  removes it.
- **`nodeCreateRequestSchema.options` stays an opaque record of strings.** Core has no business
  knowing a provider's catalogue, and the create form the host draws today takes only a label
  (`packages/client-core/src/features/settings/ProvidedNodes.tsx`). When a provider needs a real
  form, the carrier is a descriptor the provider declares, not a core field per option.

The related material is `docs/node-enrollment.md`, `docs/plugins.md` § Node providers,
`docs/security.md` § The control plane, `docs/architecture-overview.md` § The three parties, and
[remote.md](../remote.md) for reachability. Where any of them disagrees with this section, they win.

## How this relates

[structure/](../structure/README.md) is the parent; this folder starts when its phase 7 deletes it,
except phase 2 here, which only needs structure phase 5 because it edits the facade that phase
re-points. [terminal/](../terminal/README.md) phase 3 and [client-plugins/](../client-plugins/README.md)
phase 0 both compose the custody package and should be written against the phase 0 name.
[compiled-tier.md](../compiled-tier.md) is the standing map of what moves tiers and is untouched.
Nothing in this folder designs the cloud; the section above says what it keeps open.
