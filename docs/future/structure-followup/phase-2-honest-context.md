# Phase 2: one context type per tier, one verb vocabulary

Status: **shipped 2026-08-31**. Four things landed differently from the plan below; they are recorded
in "What shipped differently" at the end, and the owning docs already say the true version. Phase 3
reads that section, not this plan.

## Goal

A loaded plugin's context type has exactly the members a loaded plugin gets, on both sides, so
reaching for a compiled-only member is a `tsc` error and not a runtime "not a function". The
published declaration for the loaded tier is held equal to the host's type by a test rather than by
hand. And the registries on both contexts speak one verb vocabulary, written down in
`docs/plugins.md` § The plugin API and enforced by the facade's surface snapshot.

## Why this phase, and why now

`NodePluginContext` in `packages/node-core/src/server/pluginHost/types.ts` is one type for both tiers,
with per-member comments saying which tier gets it. `docs/plugins.md` § Loaded plugins lists the
members that are never present on a loaded plugin's context whatever its manifest says. That list is
prose, and the type disagrees with it. `packages/plugin-types/src/public.ts` is the honest copy, and
`packages/plugin-types/src/contract.test.ts` already holds parts of it against the host, which is the
pattern this phase finishes.

The verbs are the same problem at a smaller scale. `register` on most registries, `declare` and
`record` on audit, `open`, `contribute`, and `entries` on extension points, `declare`, `handle`, and
`run` on hooks, `provide`, `get`, and `require` on capabilities, and five bespoke names on providers.
Each was chosen with a reason. Together they are a lookup table an author keeps open. It waits on
structure phase 5 because that phase re-points every `@acorn/plugin-api` entrypoint, and the renames
here ride the same facade edits.

## Scope

### The node side

Split the type in `pluginHost/types.ts`:

- `NodePluginContext` becomes the loaded shape. It loses `routes.register`, `contextSections`,
  `tools`, `events.channel`, `events.streams`, and `providers.model`, and keeps the rest.
- `CompiledNodePluginContext = NodePluginContext & { ...those six }`. `NodePlugin.init` and `ready`
  on the compiled roster take it; the loader hands the loaded shape. `HostPluginContext` layers on
  the compiled one as today.
- `permissions.ts` (`scopeContext`, or whatever builds a loaded context) returns the loaded type, so
  the omission is in the type and not only in the object.

Then `contract.test.ts` asserts the published `public.ts` shape equals the loaded shape, member for
member, so a member added to one and not the other fails the suite. If the two are already equal
except for naming, generate `public.ts` from the host type instead and delete the hand copy; the test
then pins the generated file's bytes, the way `pluginSchema.test.ts` pins the manifest schema.

### The client side

`ClientPluginContext` in `packages/client-core/src/host/registries/extensionPoints/plugin.ts` gets the
same split. Compiled-only today, per `docs/contribution-kinds.md`: client `schedules`,
`integrationFlows`, `railMarkers`, `persistedStateSlices`, `capabilities`. A loaded plugin's client
half is a manifest plus a tree or a frame and never receives this object, so the split is for the
type's honesty rather than for a caller. Do it anyway, because the contribution-kinds table names the
context members and the test that reads it should see the same partition.

### The verbs

Decide once, in this table, and apply it to both contexts:

| Shape | Verb | Applies to |
| --- | --- | --- |
| Many entries, host collects | `register` | routes, tools, schedules, collections, taskChecks, contextSections, runs, panes, sources, commands, and the rest that already say it |
| Owner declares a point, others fill it | `declare` and `handle` | extensionPoints (today `open`/`contribute`/`entries`), hooks (already `declare`/`handle`) |
| One provider, late-bound | `provide`, `get`, `require` | capabilities (unchanged) |
| A registry with one action call | keep the action verb | `audit.record`, `hooks.run`, `events.send` |
| Providers | `register` per kind | `providers.integration`, `.connection`, `.model`, `.nodes` become `providers.register({ kind, ... })` only if the four shapes share a discriminant cleanly; otherwise they stay, and the table says why |

The reading of an extension point's entries (`entries`) becomes `handlers`, matching hooks. Every
rename lands as the new name plus the old one marked deprecated for one major, so the six loaded
plugins in this repo and any outside it move on their own schedule. `PLUGIN_API_MAJOR` in
`packages/protocol/src/plugin/apiVersion.ts` bumps when the old names go, `packages/plugin-api/src/surface.snapshot.txt`
updates in the same commit, and `packages/plugin-api/src/surface.test.ts` is what refuses a name
removed without the bump.

### Docs

`docs/plugins.md` § The plugin API gains the verb table and the two-type split. § Loaded plugins drops
the prose list of never-present members and points at the type. `docs/plugin-authoring.md` uses the
new verbs in every example. `docs/contribution-kinds.md`'s member column follows the renames;
`tools/arch/contributionKinds.test.ts` fails if it does not.

## Out of scope

- Adding a manifest carrier to any compiled-only kind. That is per-kind work with its own reason,
  recorded in the **Direction** cell of `docs/contribution-kinds.md`.
- Changing what any registry does.
- The `HostPluginContext` extras (`nodeActions`, `harnesses`). They are host-fed and already off the
  authoring type.

## Done when

- `ctx.routes.register` on a loaded plugin's context is a `tsc` error in a plugin compiled against
  `acorn-plugin-types`.
- `contract.test.ts` fails when a member is added to `NodePluginContext` and not to `public.ts` (or
  the generated file is stale).
- `rg 'extensionPoints\.(open|contribute|entries)\(' plugins packages` returns only the deprecated
  aliases' own definitions.
- `docs/plugins.md` § The plugin API carries the verb table.

## Verify before building

- `NodePluginContext` is still one type with per-member tier comments.
- `public.ts` is still hand-written and `contract.test.ts` still compares only part of it.
- `PLUGIN_API_MAJOR` is still 7 (the snapshot header on 2026-08-30) and the snapshot still lists the
  old verb names.
- Structure phase 5 has landed, so the facade paths are final.

## What shipped differently

**`public.ts` is still hand-written, and the test got stricter instead.** The plan offered generating it
from the host type and pinning the bytes. Generating it would have to invent the two type parameters
(`Conn`, `Items`), the `HostOwned<…>` aliases and the prose on every member, all of which exist so the
published file can describe a shape without dragging in drizzle or Zod. The drift lock is exact now
because there is nothing left to subtract for tier: the host's `NodePluginContext` IS the loaded shape,
so `contract.test.ts` compares them directly and the hole list shrank from six members to four.

**The providers registry keeps its four bespoke verbs.** The plan made a single `providers.register({
kind, … })` conditional on the four shapes sharing a discriminant, and they do not: `integration` takes a
descriptor plus an optional route carrier, `model` takes an adapter naming an already-registered
connection provider, and `nodes` takes a contribution whose `create` obliges a `destroy`. The verb table
in `docs/plugins.md` § One vocabulary across the registries says so and says why.

**The client's own extension-point members were not renamed.** On the node, `ctx.extensionPoints` is one
member carrying three verbs, which is what made the vocabulary ambiguous. On the client the same idea is
two separate registries, `extensionPoints` and `extensions`, each with a plain `register` — already the
"many entries, host collects" shape the table gives that word to. Renaming them would have moved them
away from every other client contribution point, not towards it.

**The client split is honest, not load-bearing.** `ClientPluginContext` and
`CompiledClientPluginContext` both exist and `tools/arch/contributionKinds.test.ts` reads both halves,
but nothing is ever handed the loaded one: a loaded plugin's client half is a manifest plus a tree or a
frame. The plan said to do it anyway, and it was worth it for the arch test, which would otherwise have
stopped seeing the compiled-only kinds the moment they moved.

Two smaller notes for phase 3. `PLUGIN_API_MAJOR` did **not** move: `open`, `contribute` and `entries`
are still there as deprecated aliases, and removing them is what buys the next major — the plan says the
same, but the phase README's "verify before building" list says the major is 7, and phase 1 took it to 8.
And `CompiledPluginBroadcast` is a new name on the facade surface (docker owns a WS channel prefix,
terminal owns the PTY streams), so `surface.snapshot.txt` grew by one line.
