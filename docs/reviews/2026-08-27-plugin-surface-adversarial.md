# Adversarial review of the plugin surface, 2026-08-27

A read-only survey of the tree at `8e773d70`, focused on one question: what breaks when someone who
does not work here writes a plugin, and what breaks again when 200 of them exist. It is a companion to
[the architecture review](./2026-08-27-architecture-review.md) and does not repeat its findings. Where
that review counted 60 contribution kinds and asked whether the growth rate holds, this one asks what
the kinds are made of.

I went in trying to break things. Most of what I tried held. The five findings that matter are
concentrated in one place: the promises the surface makes to code that is not in this repository.

## What already holds

Worth stating first, because the findings below are narrow and the rest is not.

`packages/client-core/src/plugins/frames/scopes.ts` is the best single file in the plugin system. Every
core route a sandboxed frame can reach is one row with a method-to-scope map, the unmappable routes are
listed rather than omitted so an exhaustive test can tell a decision from an oversight, and the notes
explain the sharp cases in the language of what an attacker gets. I tried to find a route it had missed
and could not.

The host binds the plugin's name at every seam that mints an identifier: routes, schedules, collections,
integration flows, and extension points. Extension points are qualified `<ownerId>:<pointId>`, which is
the right model. Reload is candidate-then-commit against a buffered registration set, with four limits
written down and each one true. A loaded plugin's `init` or `ready` failure is contained and lands on the
roster row with a reason. `makeTestNodeContext` calls the real `server/plugin/context.ts` over a temp data
root, so which tier a test gets is the host's decision. `packages/client-core/src/plugins/frames/verbs.ts`
makes a wire verb that is missing from either side a compile error, and it exists because a real PUT bug
got through.

So the problems are not in the design. They are in the parts of it that only bind inside this repository.

## Findings

### 1. The compatibility promise covers names and nothing else

`packages/plugin-api/src/surface.test.ts` pins 414 exported names against a committed snapshot, and
regeneration refuses to drop a name while `PLUGIN_API_MAJOR` is unchanged. That is a real ratchet and it
works. The test also states its own limit: "What the snapshot cannot catch is an upstream type changing
shape underneath a stable name; `tsc --noEmit` across the seventeen plugins that consume this package
already catches that, loudly."

That second half is the whole protection, and it only protects plugins that live here. The 17 in-repo
consumers get updated in the same commit as the change they would have caught. So today, under an
unchanged major, you can drop a field from `TaskRef`, add a required argument to
`core.projects.update`, or narrow a return type, fix the 17 call sites, and ship green. Every out-of-tree
plugin breaks at the next boot, and nothing announced it.

The repo already solved this once. `packages/plugin-sdk/src/public.ts` is 139 hand-written lines of
declarations held to the implementation by mutual-assignability assertions in `contract.test.ts`, and the
docs give the reasoning: hand-written is the better artifact for a compatibility promise, because a person
wrote it and a person reviewed it. That pattern was applied to six functions in the frame bridge and to
nothing else. Apply it to `NodePluginContext`, `CoreServices`, `TaskRef`, and `ProjectRef` and the
name-level ratchet becomes a shape-level one for the four types every plugin touches.

Second half of the same finding: `apiVersion` is compared by exact string equality, so there is no way to
write a plugin that supports majors 2 and 3, and no way to say "I need at least 2". The day the number
moves, every plugin in the world stops loading at once and their authors cannot ship a version that
works on both sides of the cut. A range check costs about 20 lines in
`packages/node-core/src/main/bundledPlugins.ts` and it is much cheaper before there is an ecosystem than
after.

### 2. The only tier a stranger can write is untyped JavaScript

`docs/plugins.md` is explicit: "Only the frame bridge is published, and the other seven entrypoints never
will be." The reasoning is about runtime, and it is correct. A plugin does not want a second copy of Hono,
drizzle, Solid, or Monaco.

But types are erased. A declaration-only package pulls in no runtime at all, and the repo's own frame
bridge proves the shape of the answer. What an out-of-tree author gets today, from
`packages/create-acorn-plugin/index.mjs`, is a scaffold of plain JavaScript with no imports, no
`node_modules`, and no `.d.ts`. They write `ctx.routes.fetch(...)` and `core.tasks.load(...)` against
prose. There is also no JSON Schema for `acorn-plugin.json`, so the 818-line Zod contract in
`packages/protocol/src/pluginContract.ts` gives an author nothing until the next boot rejects their file.
An editor cannot help them and neither can `tsc`.

Two artifacts close this, and neither is large:

- A declaration-only `acorn-plugin-types` package covering `NodePluginContext`, `CoreServices`, and the
  request context. Zero dependencies, zero runtime, and the same mutual-assignability test the SDK
  declaration already has.
- A generated JSON Schema for the manifest, emitted from the Zod schema and served at a stable URL, so
  `"$schema"` in `acorn-plugin.json` gives completion and inline errors for all 20 contribution arrays.

This is the finding I would fix first, because every other DX complaint an external author has is
downstream of it.

### 3. Capability ids are the one seam with no namespace enforcement

Every other identifier-minting seam binds the plugin's name. `ctx.routes` binds the namespace so a plugin
cannot mount under another's. `ctx.schedules` prefixes the key. `ctx.collections` mints the id.
`integrationFlows` requires the id to equal the plugin name. Extension points are qualified by the host.
`scopeCapabilities` in `packages/node-core/src/main/pluginPermissions.ts` filters `get`, `require`, and
`ids`, and passes `provide` straight through, with the reasoning that "exporting a capability is a
contribution, not an access grant".

The gap is that capability ids are namespaced by convention only. All 13 in the tree read
`<plugin>.<thing>`, and nothing checks it. Built-ins init before loaded plugins, so a squatter cannot
take an id that a running first-party plugin already holds. Only four plugins are `required`: agents,
notes, memory, and terminal. GitHub, preview, and workflows are not, so:

1. The owner disables the GitHub plugin.
2. A loaded plugin calls `ctx.capabilities.provide('github.mirror', impostor)`.
3. Core resolves the impostor.

That third step is what makes this worth fixing rather than noting. The consumers of `GITHUB_MIRROR`
are not other plugins, they are the composition root. `apps/node/src/server/pluginDeps.ts:49` resolves
it to answer `failingChecks`, which gates a workflow policy step, so an impostor decides what the
workflow engine believes about a task's CI. `apps/node/src/server/composition.ts:134` calls
`footprint()` on it during `reconcileNode`. `PREVIEW_RULES` has the same shape at
`apps/node/src/service/runtime.ts:243`. All three read the unfiltered registry, because the composition
root is not a plugin.

Nothing in the trust dialog says a plugin is claiming another's name, because the manifest's
`permissions.node.capabilities` block covers what a plugin consumes, not what it provides. The fix is
the medicine already applied at five other seams: require a provided id to start with `<pluginId>.` for
loaded plugins, with the two host-owned ids in node-core exempt.

The same finding has a DX half. Of the 13 capability ids, 11 live in first-party `contract/` modules
under `plugins/*/src/contract/`, and only `AGENTS_HARNESS_REGISTRY` and `WORKTREE_CREATED` are on the
`@acorn/plugin-api` surface. A loaded plugin is a bare directory that can import relative paths and
`node:` builtins, so it cannot reach a `contract/` module at all. It can pass a plain string to
`ctx.capabilities.get` and receive `unknown`, and `ids()` is filtered to what it declared, so it cannot
enumerate to discover what exists. The documented way for two plugins to collaborate is, in practice,
first-party only. A published catalogue of ids with their signatures is the missing piece, and it belongs
in the declaration package from finding 2.

### 4. The two tiers overlap rather than nest

The architecture review describes the manifest as a subset an author discovers by failing. It is worse
than a subset. Neither tier contains the other.

Loaded only, with no `ClientPluginContext` member and no registry on the plugin API surface: `themes`,
`contextMenus`, `extensionPoints`, `extensions`, and `refResolvers`. A first-party compiled plugin cannot
contribute a theme or a context menu row.

Compiled only, with no manifest descriptor: `taskSlots`, `pollers`, `railMarkers`, `persistedState`,
`agentToolRenderers`, `integrationFlows`, and `contextSections`. Several of these are structural and will
stay that way, and `docs/extensibility.md` says so for agent-tool renderers.

> **Updated 2026-08-27**, after the consistency review's findings 2 and 3 landed. `taskSlots` no longer
> exists: task slots are rows in `slots`, and `slots` HAS a manifest descriptor, so the compiled-only
> list is one shorter and the `task.footer` half of it was never compiled-only in the first place.
> `pollers` is now `schedules`; still compiled-only. The `UiSlotId`/`slotDescriptor` drift below is
> unchanged, except that `UiSlotId` is six locations rather than five.

The vocabulary has drifted too. `UiSlotId` in `packages/client-core/src/registries/slots.ts` is six
locations, spelled `topbar.left` and `topbar.right`. The manifest's `slotDescriptor` is two, spelled
`footer` and `topbar`. Same concept, different names, different cardinality.

This matters because the stated ecosystem path is that a compiled plugin migrates to loaded, and
`docs/future/split.md` names five packages already in the loaded shape with more to follow. A migration
that can hit a wall in both directions is not a path. The one-page table the architecture review asks
for would surface it. What I would add: pick a direction for each of the 12 kinds above and record it,
even if the answer for half of them is "stays where it is, permanently, for this reason".

### 5. `ctx.contribute` means the counted surface is not the real one

`ClientPluginContext` has 23 members, 20 of them named contribution points, and reads like a closed
vocabulary. One of the other three is:

```ts
contribute<T extends { id: string }>(registry: Registry<T>, entry: T): void
```

Any `Registry<T>` a plugin can get a reference to. The ownership check still applies and the disposable
is still recorded, so this is not a hole in the containment. It is a hole in the documentation: the true
client contribution surface is those 20 points plus every registry object exported from the facade, and
`packages/plugin-api/src/client/index.ts` exports five of those: `sourceRegistry`,
`brandMarkRegistry`, `projectImporterRegistry`, `agentToolRendererRegistry`, and `contentLinkRegistry`.

The snapshot pins them as ordinary names, so nothing marks them as contribution points, and nothing stops
the count from growing by one whenever a registry is added to the barrel for an unrelated reason. If the
contribution-kind count is a number to watch, this is the leak in the counter. Either move each of the five
to a named context member, or mark them in the snapshot so the count includes them.

## Smaller things

**`typeof` facets widen the API by side effect.** `CoreServices` declares `fs: typeof fs`,
`git: typeof git`, and `proc: typeof proc`, so the plugin-visible surface of those three facets is
whatever `core/filesystem/confinement.ts`, `core/vcs/git.ts`, and `core/exec/proc.ts` happen to export.
That is 20 names today. Adding an export to any of the three puts it in the plugin API and inside the
matching permission grant, with no snapshot line and no review. Name the three interfaces and the
snapshot starts seeing them.

**`purgeData: true` does not purge the plugin's data.** `uninstallPlugin` in
`packages/node-core/src/main/pluginInstaller.ts` removes the package directory, the lockfile, and the
three SQLite files. It leaves the `plugin:<id>:*` rows in core's `prefs` table, which is exactly where
every sandboxed frame's `state` verb writes through `prefsFor`. It also leaves schedule state rows,
persisted layout keys naming the plugin's panes, and cached external items for its providers. The route
audits the result as `dataPurged: true`. Either widen the purge or narrow what the audit trail claims.
The prefs rows are the sharpest part, because nothing in the tree can enumerate or delete a plugin's
preference namespace, so a frame's state survives uninstall permanently and unreachably.

**The manifest carries no compatibility or dependency metadata.** No minimum acorn version, no plugin
dependency, no version on a consumed capability. `permissions.node.capabilities` names ids without
signatures or versions, so a plugin that needs `notes.store` as it exists today has no way to say which
today it means. Loaded-plugin init order is roster order, which is install order, which nothing documents
and nobody chose.

**Un-namespaced contribution ids are a one-way door that is still open.** Pane, command, source, and slot
ids are un-namespaced because they double as persisted layout keys and chord targets, and
`registries/plugin.ts` records that prefixing them later breaks stored state. Collisions between plugins
are handled well: the second registration fails, `recordSurfaceFailure` keeps the reason, and the
attention inbox shows it. The collision that model does not handle is with a future core id. Core adds a
pane called `issues` in a year, and every installed plugin that already used `issues` loses its pane to a
first-come race. Namespacing ids minted from here on, with an alias map for the handful already in
someone's stored layout, closes the door while it is still cheap. The window is open exactly as long as
there are no third-party plugins in the wild.

**The sandboxed tier cannot build much on its own, and the tier that can is not sandboxed.**
`GRANTABLE_SCOPES` is six names, all reads and writes of core tasks, projects, and workspaces. A frame
with no node half can list tasks and create one. Anything more interesting needs the plugin's own node
bundle, which runs unsandboxed in the node process and, as `pluginPermissions.ts` says plainly, can
`import('node:fs')` and ignore `ctx` entirely. The documentation is honest about this at every turn. The
risk is that the words "sandboxed frame" do the reader's thinking for them, and the trust decision that
actually matters is the node bundle. If the containment ladder's rung 2 is real, the surface is mostly
ready for it: `ctx.routes.fetch` is framework-neutral, `PluginRequestContext` is plain data. Two things
would have to move, and both are noted in the code already: `providers.items()` returns a live store, and
`ctx.storage.open()` returns a drizzle handle.

**`order` numbers are the only coordination between independent authors.** Every ordered contribution
takes an integer from 0 to 100,000 with a default of 500. That works while one team picks all the
numbers. It is the mechanism that produced z-index wars everywhere else it has been tried. No change is
needed today, but the day two plugins both want to be first is the day this needs an answer, and
sort-by-order-then-id is not it.

## What I would do, in order

1. Publish `acorn-plugin-types`, declaration-only, covering `NodePluginContext`, `CoreServices`,
   `TaskRef`, and `ProjectRef`, held by the same mutual-assignability test `plugin-sdk` already uses.
   Generate a JSON Schema for the manifest from the Zod contract and reference it from the scaffold.
2. Namespace-check `ctx.capabilities.provide` for loaded plugins, and publish the id catalogue with its
   signatures.
3. Replace the exact-string `apiVersion` check with a range, before there is an ecosystem that a bump
   would strand.
4. Decide a direction for each of the 12 kinds that exist in one tier only, and record it in the
   contribution-kind table the architecture review asks for.
5. Namespace newly minted contribution ids, with an alias map for the ones already persisted.
6. Widen `purgeData` to cover the prefs namespace, schedule state, and layout keys, or narrow the audit
   line.

Items 1 through 3 are the ones that get more expensive with every week there are external plugins.
Items 4 through 6 are cheap now and cheap later.
