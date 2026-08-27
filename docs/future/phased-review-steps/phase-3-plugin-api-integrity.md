# Phase 3: one plugin API a stranger can trust

Part of [phased-review-steps](./README.md). Sources:
[the plugin surface adversarial review](../../reviews/2026-08-27-plugin-surface-adversarial.md)
(all five findings plus the smaller things), finding 5 of
[the architecture review](../../reviews/2026-08-27-architecture-review.md), and findings 7 and 10
of [the extensibility review](../../reviews/2026-08-27-extensibility-adversarial.md).

Why this is a cloud prerequisite and not ecosystem polish: the extensibility review's rule for the
control plane is that **the first-party cloud plugin must be a loaded plugin, built only from
documented seams, with no host privilege a third party cannot have.** Today a loaded plugin gets
no TypeScript types, cannot reach 11 of the 13 capability contracts, and lives under an
`apiVersion` check that strands every plugin the day the major moves. Those three facts are
findings 2, 3, and 1 of the plugin surface review, and each blocks the cloud plugin as surely as
it blocks a stranger.

Timing matters across this whole phase. Most items are cheap while the loaded plugins are the five
in this repository and expensive once anything out of tree compiles against the current names.
The consistency review already spent one `PLUGIN_API_MAJOR` bump well by batching its renames;
anything here that breaks the surface should batch the same way.

## Work items

### 3.1 Published types: the declaration-only package

Plugin surface review, findings 1 and 2. The name-level snapshot ratchet is real but covers names
only; a type can change shape under a stable name and only the 17 in-repo consumers catch it. And
the only tier a stranger can write is untyped JavaScript against prose.

- Publish a declaration-only types package (working name `acorn-plugin-types`, unscoped to match
  the shipped `acorn-plugin-sdk` convention) covering `NodePluginContext`, `CoreServices`,
  `TaskRef`, `ProjectRef`, and the request context. Zero dependencies, zero runtime.
- Hold it to the implementation with the mutual-assignability test pattern
  `packages/plugin-sdk/src/contract.test.ts` already uses. Hand-written declarations are the
  compatibility artifact; the test is what keeps them honest.
- Reference it from the `create-acorn-plugin` scaffold.

This turns the name-level ratchet into a shape-level one for the types every plugin touches, and
it is the review's first-priority item.

### 3.2 The manifest JSON Schema, generated

Plugin surface review, finding 2. An author writing `acorn-plugin.json` gets nothing until the
next boot rejects the file; the 818-line Zod contract in
`packages/protocol/src/pluginContract.ts` is invisible to their editor.

One recorded conflict to resolve in writing: [ecosystem/README.md](../ecosystem/README.md)
records "a JSON Schema: deliberately not built" on the grounds that a second schema is a second
source of truth. That refusal was against a hand-maintained copy. A schema **generated from the
Zod contract**, which is what [the marketing plan](../marketing/README.md) phase 3 already
specifies (published at a stable URL, CI check that regenerated output matches committed output),
has one source of truth and closes the finding. The work:

- Generate the schema from `pluginContract.ts`; publish it at a stable URL and ship it with the
  scaffold so `"$schema"` gives completion and inline errors for all contribution arrays.
- Add the CI sync check.
- Update the ecosystem README note to record the resolution, so the refusal does not get
  re-litigated.

### 3.3 apiVersion becomes a range

Plugin surface review, finding 1. `apiVersion` is compared by exact string equality, so a plugin
cannot support two majors and the day the number moves every out-of-tree plugin stops loading
with no way to ship a version that works on both sides. Replace with a range check (about 20
lines in `packages/node-core/src/main/bundledPlugins.ts` per the review; verify the loader path).
The consistency batch just moved the major to 3, which is a reminder of how real this is. Update
the compatibility promise in `docs/plugins.md § What is published` and the marketing honesty
constraint that quotes it.

### 3.4 Capability hygiene

Plugin surface review, finding 3, both halves:

- **Enforcement.** Require a capability id provided by a loaded plugin to start with
  `<pluginId>.`, matching the binding already applied at routes, schedules, collections,
  integration flows, and extension points. The two host-owned ids in node-core are exempt. This
  closes the squat where a disabled first-party plugin's id (`github.mirror`, `PREVIEW_RULES`)
  is re-provided by an impostor and resolved by the composition root.
- **Discovery.** Publish the capability id catalogue with signatures. Eleven of 13 ids live in
  `plugins/*/src/contract/` modules a loaded plugin cannot import; the catalogue belongs in the
  types package from 3.1.

### 3.5 The contribution-kind table, and a direction for every single-tier kind

Architecture review finding 5, plugin surface review finding 4. Two plugin APIs exist, they
overlap without nesting, and the vocabulary reached 60 kinds. The work is one page plus one
decision per row:

- Publish one table mapping every contribution kind to its tier (compiled, loaded, or both), its
  registration mechanism (context member or manifest descriptor), and its host. Watch the count;
  the review's "what would it take to add kind 61" question is the health metric.
- For each kind that exists in only one tier, record a direction: gains a twin in the other tier,
  or stays where it is permanently, with the reason. The consistency batch already shrank the
  list (task slots folded into `slots`, which has a manifest descriptor), and
  [compiled-tier.md](../compiled-tier.md) has already answered several rows (agent-tool renderers
  stay first-party; rail markers await rail-tab slice 3). Reconcile the vocabulary drift the
  review names while writing the slot rows: `UiSlotId` locations against the manifest's
  `slotDescriptor` values.
- Home for the table: `docs/extensibility.md` or a new `docs/` page it links; it must be one
  page an author can see whole.

### 3.6 Namespace new contribution ids

Plugin surface review, smaller things. Pane, command, source, and slot ids are un-namespaced
because they double as persisted layout keys. Plugin-vs-plugin collisions fail loudly; the
unhandled collision is with a future core id, where core loses to a first-come race with an
installed plugin. Namespace ids minted from now on, with an alias map for the handful already in
stored layouts. The window closes when the first third-party plugin ships; this phase is the
window.

### 3.7 purgeData tells the truth

Plugin surface review, smaller things. `uninstallPlugin` removes the package directory, lockfile,
and SQLite files, then audits `dataPurged: true` while leaving `plugin:<id>:*` prefs rows (where
every sandboxed frame's state lives), schedule state, layout keys, and cached external items.
Widen the purge to cover those, or narrow the audit claim. The prefs rows are the sharp edge:
nothing can enumerate or delete a plugin's preference namespace today, so add that capability to
the purge path whichever way the decision goes.

### 3.8 PluginBroadcast surgery, before the ratchet pins it

Extensibility review, finding 7. `ctx.events` carries the workflows plugin's domain vocabulary
(`notice`, `stepEvent`) on the context every plugin receives, and has no receive side. Both moves
are cheap now and blocked once out-of-tree plugins compile against the shape:

- Relocate `notice` and `stepEvent` behind a capability the workflows plugin provides.
- Land the `on` side of `PluginBroadcast` for core events, scoped by manifest grant, disposal on
  unload, per [events/subscriptions.md](../events/subscriptions.md) item 1. The events folder
  owns the catalogue and delivery design; this item lands only the node-side subscription shape
  so the send-only surface is not what gets pinned.

### 3.9 The forward-compatibility rule

Extensibility review, finding 10. Four mechanisms handle "the plugin knows something this build
does not": one retains and reports (schedule rows), two drop silently (unknown core facets,
unknown manifest keys), one hard-refuses (`apiVersion`, fixed by 3.3). Write the rule once,
in `docs/plugins.md`: **unknown is retained and reported, never dropped silently.** Then make the
two silent cases report through `recordSurfaceFailure` and the attention inbox, which already
handle the same class of event for id collisions.

### 3.10 Name the typeof facets

Plugin surface review, smaller things. `CoreServices` declares `fs`, `git`, and `proc` as
`typeof` their modules, so adding an export to any of the three widens the plugin API and the
permission grant with no snapshot line. Name the three interfaces explicitly so the surface
snapshot sees them.

### 3.11 Grow the testkit against the 141 imports

Architecture review, finding 4. Plugin tests reach past `@acorn/plugin-api` into 15 core modules
in 141 places; each import names something a third-party author needs and does not have. This is
a program with a ratchet, not one change:

- Treat the deep-import list as the specification. Extend `@acorn/plugin-api/testkit` (real
  SQLite via the node testkit pattern, route harnesses, whatever the imports name), migrate
  plugin tests onto it in batches, and lower `MAX_DEEP_IMPORTS` in `boundaries.test.ts` with each
  batch.
- The exit condition: a plugin's test suite compiles against published surfaces only, which is
  also the condition for moving that plugin out of the repo ([split.md](../split.md)).

## Acceptance

- A scaffolded plugin outside this repo type-checks its node half against the published types
  package and gets editor validation on its manifest from the published schema.
- The host loads a plugin declaring a compatible `apiVersion` range and refuses an incompatible
  one with an error naming both versions.
- A loaded plugin providing a capability id outside its own namespace fails registration with a
  reason on the roster row.
- The contribution-kind table exists, is linked from `docs/extensibility.md` and
  `docs/plugin-authoring.md`, and every single-tier kind has a recorded direction.
- Uninstall with purge leaves no `plugin:<id>:*` prefs rows, or the audit row no longer claims
  `dataPurged: true`; a test holds whichever.
- `PluginBroadcast` has an `on` side and no workflow vocabulary; the surface snapshot reflects
  it inside the same major bump as the rest of this phase's breaking changes.
- The deep-import ceiling is lower than 141 and ratchets.

## Verify before building

- Re-read the top of the consistency review for what its batch already landed; several counts in
  the adversarial review (23 client members, snapshot at 415 names) predate it.
- Check `packages/plugin-sdk/src/public.ts` and `contract.test.ts` before designing 3.1; the
  pattern to copy is there and may have grown.
- Confirm where the `apiVersion` equality check lives now; the review names
  `bundledPlugins.ts` but the loader has been refactored before.
- Re-count the deep imports and the `// prune candidate` markers in
  `packages/plugin-api/src/client/index.ts` before starting 3.11.
- Check whether rail-tab slice 3 (manifest rail markers) landed; it adds a row to the
  contribution-kind table and removes one compiled-only entry.
