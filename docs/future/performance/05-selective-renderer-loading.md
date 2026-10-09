# Phase 05: Load renderer implementations when their features open

Date: October 9, 2026. Status: implemented October 9, 2026. Depends on: phases 01 and 04.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Reduce the initial renderer graph and mandatory post-frame registration work. Use the startup and
local loading states from phase 04 so delaying code does not create missing navigation or blank panes.

## Outcome

Everything a launch loads before the workspace restores dropped from 1,051,291 B to 923,264 B of
minified scripts. Startup scripts went from 808,886 B, over their ceiling, to 703,911 B. The compiled
roster went from 242,405 B to 219,353 B. The terminal client's startup graph went from 730,269 B,
over its ceiling, to 673,918 B. The [evidence](../../testing/selective-renderer-loading-2026-10-09.md)
has the method and the real-app checks. The owning references are
[loaded contribution readiness](../../frontend/registries.md#loaded-contribution-readiness),
[startup order](../../frontend/data-and-startup.md#startup-order), and the
[startup budget](../../frontend/startup-budget.md).

Decisions made during implementation:

- The loaded-plugin frame, chrome, and worker hosts reached startup through `reload.ts`, and the
  roster through the `@acorn/plugin-api/ui/host` barrel. Cutting only the startup edge moved about
  146 KB of source into the roster, which the restore still waits on. `registerKeybindings` and
  `slotFills` moved to `@acorn/plugin-api/client`, and the changes and context models import them
  from there. The budget check counts the roster with its own ceiling and denylist, so a cut can't
  just move bytes.
- Frame and chrome registration load on the first distribution commit. After that a pass runs in its
  commit's tick, so withdrawal stays synchronous. `preparePluginContributionsForNode` is the
  readiness result that deep links await. Restored loaded panes already waited on the Node's roster
  read, and the import adds to that wait.
- Distribution keeps its synchronous worker teardown through `host/tree/workerTeardown.ts`, which
  the worker host fills in as it loads.
- Step 3 stopped at the barrel fix and the workflow run model's `stepFields` import. The rest of the
  roster is pane models, session stores, and command declarations. A pane's `model` is a
  synchronous factory, and deferring it would change that contract, which this phase excludes. The
  changes model still loads the diff parser through `@acorn/plugin-api/ui/diff`, about 9 KB of
  source.
- Step 5 commits the selected Node first, then reads other Nodes and caches bundles up to four at a
  time. One local Node, the usual case, sees no difference.
- Step 6 loads the code of a task's saved panes through the existing prefetch timer, when the pointer
  or keyboard focus rests on its rail row. The restored destination's panes load as they draw.

## Starting point and owners

`apps/desktop/src/client/plugins.ts` statically imports all 12 compiled client plugins.
`apps/desktop/src/client/activate.ts` loads that roster after the first frame and gates restoration
on registration. The October 8 build measured 213,795 B in its incremental static closure.

`packages/client-core/src/host/plugins/reload.ts` eagerly imports contribution synchronization.
`packages/client-core/src/host/plugins/syncContributions.ts` imports frame and chrome registration.
`packages/client-core/src/host/plugins/distribution.ts` imports tree-worker teardown and also owns
synchronous availability/trust projections. These host implementations contribute to initial scripts.

`apps/desktop/src/client/App.tsx` imports the conditional project promotion modal eagerly.
`apps/desktop/src/client/pageContributions.tsx` already demonstrates lazy components with eager
searchable declarations. CodeMirror grammars, Shiki grammars, Mermaid, and major pane components
already load lazily. Preserve those cuts.

## Implementation

1. Capture the renderer manifest, source-module inventory, and static import chains for both the
   initial closure and the roster closure. Trace each candidate's other callers; a dynamic edge
   saves nothing when another static caller retains the same module.
2. Make conditional core dialogs load on their opening action, starting with project promotion.
   Reuse phase 04's pending/error presentation and keep cached project/task context available.
3. Separate compiled registration from implementation imports one plugin at a time. Keep IDs,
   order, requires/when rules, routing, command declarations, and required persisted-state bindings
   available before restoration. Put optional command handlers, views, and substantial model work
   behind explicit loaders. Use small supported exports rather than implementation-heavy barrels.
4. Separate loaded-plugin trust/availability state from frame, chrome, and worker implementations.
   Keep serial distribution commits and atomic paired frame/chrome registration. Publish a clear
   contribution-readiness result and have loaded deep links and restored panes await that result.
   Preserve immediate revocation of active authority and teardown during Node switching; import
   deferral must not let a retired worker continue running. Phase 04 step 8 may draw a loaded
   plugin's recorded rail icon, inert, until this result confirms it.
5. Review distribution latency in `syncPluginDistribution`. Prioritize the selected Node and its
   required offers; read independent Nodes and cache bundles with bounded concurrency. Preserve
   ordered commits, provenance reporting for cached hashes, consent, owner overrides, and stale
   result rejection. Do not simply publish unverified descriptors early.
6. Warm the selected destination and its visible features after required state is known. On hover
   or keyboard intent, preload only the likely feature. Reuse the registry's prefetch seam without
   warming every pane or starting background feature reads across the whole fleet.
7. Compare first frame, restored usable content, first opening, and both byte closures after each
   cut. Lower relevant ceilings and add source-module exclusions for demonstrated lazy boundaries.
   Count work required before usability even when a dynamic import moves it outside the first-frame
   budget. Keep the terminal startup graph free of DOM-only implementations.

Loader promises have one owner and a retry policy. Preserve the host's registration/disposal
contracts, explicit dependency injection, schema validation, and stored plugin identity. This phase
does not change a compiled plugin into a loaded plugin or redesign plugin contracts speculatively.

## Verification and completion

Test restored tasks before optional code arrives, deep links to loaded routes, late state-slice
hydration, disabled plugins, partial load failure, retry, revocation during loading, and Node changes.
Assert navigation remains discoverable and that registration does not duplicate listeners or commands.
Distribution tests must prove stale reads cannot regain authority and selected-Node work cannot wait
on unrelated remote reads indefinitely.

Run `pnpm --filter @acorn/desktop build` and `pnpm --filter @acorn/tui build`; byte and denied-module
checks must pass. Run `pnpm lint`, `pnpm test --filter=@acorn/client-core`, changed compiled-plugin
suites, `pnpm test --filter=@acorn/tui`, `pnpm --filter @acorn/desktop test`, and
`pnpm --filter @acorn/arch-tests test`.

Use a fresh and reused `pnpm dev:agent` session to open Agent, Editor, Changes, Settings, GitHub,
and a loaded plugin. Check saved destinations, keyboard opening, slow imports, and offline data.
Measure cold first openings as well as subsequent openings. A smaller initial graph with slower
usable restoration does not complete this phase without a stated, accepted tradeoff.

Complete with measured cuts, retained state, visible placeholders, and a contribution-readiness
contract used by restore and deep links. Update [registries](../../frontend/registries.md),
[startup readiness](../../frontend/data-and-startup.md), and [startup budgets](../../frontend/startup-budget.md).

## Recheck before implementation

Do not defer module-level registration as an accidental side effect. Move its declaration to the
eager owner first. If an operation requires synchronous authority withdrawal, preserve a synchronous
teardown handle; an async import cannot replace that requirement.
