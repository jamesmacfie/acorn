# The loaded-plugin migrations — review record and remaining work

Rollbar was the first plugin to move out of both compiled composition lists into a loaded package:
node and client bundles, native descriptor rows, a sandboxed detail frame, `id: "rollbar"` preserved
so provider ids, route paths, task links and stored connections carry over.

That move's review produced four findings, all resolved and their write-ups since retired: shipping,
seeding and updating bundled plugins (was a blocker); binding task origins and task-link connections
to the supplying plugin; scoping external-project mappings to caller-owned providers; and making the
reference frame use the shared styled UI kit.

The common rule is now explicit in code: plugin-supplied ids are claims; host-bound ownership is the
authority used before a claim can cross into core state.

Two more first-party packages have moved since: `model-providers` (which needed nothing new) and
`linear` (which needed several things, all recorded in [linear.md](./linear.md)).

## The Linear-migration review — closed

The linear move added eight host carriers, and a review record (`changes.md`, since retired) walked
them commit by commit for a second pair of eyes. The review ran, its verdict was that the carriers
were sound — each one follows the rollbar rule above, plugin ids are claims and the host binds the
authority — and it produced a punch list, all of which has landed:

- **The external-item store is provider-scoped at construction** (`integrations/itemStore.ts`). The
  ownership check at the ask used to gate only the argument; the store it returned could still name
  any provider per call. Now every query carries the provider it was built for, marker keys outside
  `provider:<id>:` are refused, and the fix covers all three doors onto the store
  (`providers.items()`, `ProviderResourceContext.items`, `ownedExternalItems`).
- **`ui.openUrl` is gesture-gated**: the broker honours it only while the frame holds focus and at
  most once per second, so background frame code cannot move the reader. This was the answer to
  "should a frame navigation be a declared permission" — a gate, not a grant.
- **The https-only policy has one spelling.** Two device-side sites (the command filter and the
  descriptor `openUrl` execution site in `chrome/`) re-checked with their own `startsWith` or not at
  all; both now call `isPluginOpenableUrl`, and the execution site re-checks because a roster row is
  wire input.
- **A slot badge's `onClick` takes the command verb set**, not the full one: its click has no row and
  no routed project, so `navigate`/`createTask` could only parse and then fail. The manifest refuses
  them now.
- **A plugin's declaration lives in its package** — `plugins/<id>/acorn-plugin.config.mjs` — instead
  of a table inside `build-plugin.mjs`, so the declared surface is diffed beside the code it
  describes. The builder reads it by id; the generated `acorn-plugin.json` is unchanged.
- **Over-declared grants were withdrawn**: rollbar's `secrets: true` had no call site and is `false`;
  `model-providers` only imported `@acorn/node-core` from tests and now declares it that way.
- **The reserved `x` route segment is pinned** by an arch rule (`tools/arch/boundaries.test.ts`), so
  the two deliberate spellings — client-core's constant and node-core's parse-time literal — fail a
  test instead of a user when they drift apart.

The durable knowledge from that record now lives with its owners: the carriers themselves in
`docs/plugins.md` and `docs/integrations.md`, the out-of-process cost of the callback-shaped provider
seams in `docs/security.md`, and what the migration cost in practice in [linear.md](./linear.md).
One of its questions was answered by *keeping* the trade-off, now on the record here: the loaded
tier's confined `/p/:projectId/x/<plugin-id>/` URLs stay ugly on purpose, and the long-term answer to
the first-party/loaded asymmetry is to confine compiled plugins too, not to unconfine manifests.

## What came out right

Worth stating, because the hard parts are the ones that went well:

- **The dogfood test is green again.** `apps/node/test/integration/pluginLoader.test.ts` passes,
  and Rollbar is now the only Rollbar contribution rather than a disk copy shadowing a built-in.
  `pnpm test` is back to the three documented environmental failures (`serviceSpawn` ×2,
  `standaloneShutdown`); `pnpm lint` is green.
- **The fetch seam has a real caller** for the first time. `ctx.providers.integration(provider,
  createRollbarFetch(ctx.core.projects))` is the shape the whole loaded tier was built around, and
  it had none until now.
- **The permission set came out minimal, and the record of what was *not* needed is the valuable
  part**: no `tasks` facet, no events, no prefs, no `exec`, no project config, no project writes,
  and — notably — no task *write* scope on the frame, because creation and linking stay in the
  host-owned promotion flow. That is the evidence that the tier's grants are cut at roughly the
  right joints.
- **The descriptor trade-off was found honestly rather than worked around.** The rail lost
  Rollbar's connection/level/environment filters and its project picker, and the response was to
  move exploration into the frame and say so, not to grow the descriptor vocabulary until it
  became a UI framework. That restraint is what keeps the closed verb set closed.
- **The dual-action gap was closed in the host, not the manifest.** A row needed click-to-open and
  `+TASK`, and rather than adding plugin callbacks or a second action verb, the host now reads the
  row's existing `task` block as its promotion capability and draws the affordance itself. One
  fewer thing a plugin can get wrong.

## What is still owed, beyond these findings

- **model-providers has since moved**, and needed none of what follows. It is node-only with no client
  bundle, no routes, no storage and no `secrets` grant, so the move was a manifest row in
  `apps/node/scripts/build-plugin.mjs`, a line in the bundled roster, and four deletions. Nothing in
  it exercised a seam that was not already there, which is why it produced no findings of its own.
- **linear has since moved as well**, and unlike model-providers it produced findings — seven of them,
  written up in [linear.md](./linear.md), which is now an outcome record rather than a brief. It was the
  first plugin to run a frame reference panel and declarative content links, and both were broken in
  ways nothing had noticed: a refPanel frame could neither draw its own drawer nor reach `onClose`, and
  the content-link grammar is exact-arity so one URL shape needs an entry per arity. It also found the
  one thing the brief was simply wrong about — it said "Blockers: none", and the workspace↔Linear-project
  picker turns out to have no home on this tier at all, because that write is unmappable on the bridge
  and absent from `CoreServices`.
- **Cross-plugin references are done** — the design is [cross-plugin-refs.md](./cross-plugin-refs.md)
  and all three pieces have landed. github no longer imports linear's `contract/` package (that
  directory no longer exists) and no longer depends on `@acorn/plugin-linear`: extraction is a host
  scanner over the contentLinks plugins already declare, enrichment is a `refResolvers` manifest
  carrier, and bare-id linkification is host-owned and learns its prefixes from confirmed refs. The
  one capability a loaded github could not have kept is no longer needed, so it no longer gates that
  migration. The design's v2 token grammar remains deliberately unbuilt.
- **http, database and editor were not moved.** All three remain in both composition lists. Their
  migration briefs are in this folder — [http.md](./http.md), [database.md](./database.md),
  [editor.md](./editor.md) — each with a note at the top correcting what the rollbar migration changed
  underneath it. `http` carries the only analysis of the plugin-migrations path, which nothing has
  exercised. The rollbar brief itself was not restored; this file plus `plugins/rollbar/` is the
  reference now.
- **`agentContexts` has a manifest form**, so http and database are no longer blocked on the carrier.
  A descriptor names two routes in the plugin's own namespace — `options` (GET) and `capture` (POST) —
  and the host binds everything a plugin should not: `source` from the plugin id, the capture time,
  and the byte measurement the 512 KiB ceiling is checked against. `revision?()` deliberately has no
  form: it is synchronous and a descriptor answers across a fetch.
- **Editor's blockers are now named rather than vague**: its `overlay` component slot and its
  `persistedState` slice have no manifest form, and whether an unminified Monaco frame fits under the
  8 MiB client-bundle cap is unmeasured. That last one gates database too, which also depends on
  `monaco-editor`.
- **Release validation**, as the moved doc already noted: a real-token soak and an installer-driven
  update. The bundled-plugin distribution work (rollbar's blocker finding) is a precondition for the
  second of those.

## Pick up work here

**[tasks/](./tasks/README.md) is the queue**: each file is one self-contained piece of work with
context, touched files and acceptance criteria. Tasks 01–06 have landed — the cross-plugin-reference
carriers, the two dead-click gates, authored source empty states, and the `build:plugin` dev-package
trap — and that file records where the durable part of each now lives. One is left, and it needs a
person rather than a compiler: [07](./tasks/07-live-verification-pass.md), the manual pass over the
linear-migration surfaces. The three plugin migrations remain their own briefs (http, database,
editor, below).

## Known issues and open decisions the review left standing

Carried forward from the retired review record so they are not lost with it. None blocks the
remaining migrations; each is a decision or fix someone should own deliberately. The four that had
task files — the two dead-click gates, the missing source empty state and the `build:plugin` dev-package
trap — are fixed and gone from this list.

- **A frame surface has no `when` predicate**, so every provider pane appears on every task with an
  empty state. Deliberate for now (an empty state is more discoverable than a pane that silently is
  not there); a `when` would need a descriptor vocabulary for task predicates.
- **`broker.fetch` throwing `Unknown node` is the only connection failure not modelled as a
  connection state**; it prints a stack instead of degrading into the offline/stale vocabulary the UI
  speaks. Left alone during the migration because fixing it would have hidden the local-node
  singleton bug rather than surfacing it.
- **The local node's label resets to "This computer" after an identity change** (a replaced data
  root). A rename arguably belongs to the machine, not the identity.
- **`pullsBatch` swallows GitHub server errors** — partial alias failures mirror the PRs that did
  resolve, so the UI keeps previously-mirrored rows with no visible signal that the pass failed.
- **Multiple bundled plugins raise multiple boot trust prompts**, which wedges a dozen desktop e2e
  specs that assert on one. Pre-existing suite assumption, not a plugin bug; the suite is being
  extracted from this repo.
- **`refs`/`onSelectTarget` on `RefPanelProps` have zero callers** of any kind and are carried dead;
  delete or justify.
- **Verification debt** for everything only a running app can prove — the reference panel from a PR,
  bare-id anchors, the ticket chips, the project-scoped issue view, the rail's new empty state,
  `ui.openUrl` on screen, the project-mapping picker, both appearance axes, a real Linear token — is a
  tickable checklist at the end of [linear.md](./linear.md), which is the source of truth for it.
  → [tasks/07](./tasks/07-live-verification-pass.md)
