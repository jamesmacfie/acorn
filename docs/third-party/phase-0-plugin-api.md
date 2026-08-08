# Phase 0 — Extract `@acorn/plugin-api`

**Status: done.** Shipped in three commits: the client presentation cleanup, the facade package, and
the repoint of all seventeen plugins. `docs/plugins.md` § "The plugin API" is the current
description; everything below is the plan as written, kept for its reasoning. Where the two
disagree, `docs/plugins.md` and the boundaries test are right. What actually differed is recorded in
"As built" at the end.

**Size: M–L.** Pure refactor, no behavior change. Valuable standalone: it hardens the
first-party plugin boundary whether or not the later phases ship. Two workstreams: the facade
package itself, and the client presentation-layer split that gives the `/ui` entrypoint a clean
thing to export (see "The `/ui` entrypoint" below).

## What this phase produces

A new workspace package, `packages/plugin-api`, that is the **only** package a plugin may import
from the host. Three entrypoints — two mirroring the runtime split every plugin already has
(`src/node` vs `src/client` directories, per docs/plugins.md), plus the pure design-system
surface:

```text
packages/plugin-api/
  src/
    node/index.ts      NodePlugin, NodePluginContext, registries, CoreServices facade,
                       route toolkit, storage toolkit
    client/index.ts    ClientPlugin, ClientPluginContext, contribution types,
                       client data toolkit
    ui/index.ts        pure presentation re-exports (client-core ui/ — primitives, Icon,
                       Picker, Tabs, Modal, CopyButton, diff model, appearance)
  package.json         exports: { "./node": …, "./client": …, "./ui": … }
```

Plus: every first-party plugin repointed to it, the `ui/` purity rule inside client-core enforced
by the architecture test, and a `.d.ts` snapshot test that makes surface changes deliberate.

Deliberately NOT produced: more packages. A `ui-components` (or `route-toolkit`, …) package was
considered and rejected — the problem plugins have is *contract control* (an enumerable,
snapshot-guarded import surface), not package granularity. One facade with subpath entrypoints
gives the ergonomics (`import { Button } from '@acorn/plugin-api/ui'`) with one seam, one
snapshot, one boundary rule; N packages would mean N public surfaces to version and guard. The
repo has also run the experiment in the other direction (the three agents-profiles packages were
folded back in; the Phase 10 foldering chose directories + `boundaries.test.ts` over package
walls). The test for a new package is **a consumer contract with its own change cadence**, which
is exactly what plugin-api has and a topic-shaped `ui-components` does not. If the design system
someday gets a genuine external consumer (published standalone, docs site), extraction is
trivial *because* the layering below keeps it clean in the meantime.

## Why a package and not exports from node-core

1. **Two runtimes, one contract.** A plugin ships a node half and a client half. `NodePlugin`
   lives in node-core, `ClientPlugin` in client-core, and those packages must never merge
   (client-core pulls Solid; node-core must stay DOM-free; the architecture test enforces the
   split). Neither can host both halves.
2. **It is what external authors will install.** A third-party plugin declares
   `@acorn/plugin-api` as a dev/peer dependency. Depending on node-core would hand them the whole
   server implementation and make every internal refactor a potential break.
3. **Independent versioning.** node-core versions with the app and churns freely. plugin-api
   versions with the *contract*: its version is what a manifest's `apiVersion` is checked
   against (Phase 1), and the snapshot test guards it.
4. **Cheap boundary rule.** "Plugins import plugin-api and nothing else from `packages/`" is one
   clean edge for `tools/arch/boundaries.test.ts`. "Import node-core but only these files" is a
   path allowlist that rots.

## Scope: what plugins actually import today

Measured across `plugins/*/src` (2026-08-08). This is the extraction worklist — the clusters, not
the raw modules, are the unit of decision:

| Cluster | Today's modules (top imports) | Disposition |
| --- | --- | --- |
| Plugin contexts | `node-core/server/plugin/types.ts` (17), `client-core/registries/plugin.ts` (16) | Move/re-export — this IS the API |
| Route toolkit | `server/middleware/auth.ts` (52), `middleware/requireUser.ts` (35), `server/respond.ts` (29), `server/bridge.ts` (16) | Re-export the types and helpers routes need: `AppEnv`, `requireUser`, `respond`/`respondError`, `ApiError` |
| Storage toolkit | `main/pluginStorage.ts` (42), `main/pluginMigrations.ts` (8) | Re-export — per-plugin SQLite factory and migration runner |
| CoreServices | `main/core/index.ts` (33), `main/core/secrets.ts` (12), `main/core/tasks.ts` (7) | Re-export the **type** only. The object is handed in via `ctx.core`; plugins must not construct or deep-import it |
| Capabilities | `server/plugin/capabilities.ts` (10) | Re-export `CapabilityRegistry`, capability id helpers |
| Provider types | `server/integrations/types.ts` (10), model provider adapter types | Re-export |
| Client data toolkit | `client-core/apiClient.ts` (34), `queries.ts` (29), `registries/clientEvents.ts` (15) | Re-export |
| Client registries | `registries/panes.ts` (15), `sources.ts` (10), plus slots, paletteRows, attention, nodeStats, refPanels, settings, pollers, keybindings, commands, `projectImporters` | Re-export the contribution **types**; the registration functions stay host-internal (plugins register via `ctx`, never by importing a registry) |
| UI primitives | `ui/diff` (20), `ui/primitives.tsx` (17), `ui/Icon.tsx` (10), `ui/appearance.ts` (8), `ui/Picker.tsx` (7), `ui/CopyButton.tsx` (7), `ui/Tabs.tsx` (4), `ui/metrics.ts` (4), `ui/displayMeta.ts` (4), `ui/dismissable.ts` (4), `ui/UserAvatar.tsx` (3), `ui/Modal.tsx` (2), `ui/MentionTextarea.tsx` (2) | Re-export via the `/ui` entrypoint — the pure design-system surface (see next section) |
| Editor bootstrap | `ui/monacoSetup.ts` (2, side-effect import from the editor and database panes) | **Not `/ui`.** It registers Monaco's web workers through Vite `?worker` imports — a bundler-coupled side effect, not presentation. Move it out of `ui/` (see next section) and decide its public status separately from the design system |
| Wire types | `@acorn/protocol/*` (138) | **Not absorbed.** protocol is already the pure shared wire-type package and stays directly importable |
| Test toolkit | `node-core/testkit/db.ts` (30) | **Not public.** Stays a devDependency import; add `@acorn/plugin-api/testkit` later only if third-party authors need it |

Deliberately excluded from the public surface, even though first-party plugins use them:

- `ctx.events.streams()` / `channel()` PTY and WS-channel ownership — "exactly one plugin may own
  these"; terminal-plugin infrastructure, not API.
- `persistedState` registration internals, `agentToolRenderers` (in-realm components), anything
  under `main/wsHub` or `main/notify` — the host wires those into contexts itself.

Practical approach: plugin-api re-exports from node-core/client-core rather than physically
moving code (`export type { CoreServices } from '@acorn/node-core/main/core'` style). Physical
moves can happen later without changing importers. What matters in this phase is that **plugins
import the facade**, and the facade is the enumerated, snapshot-guarded surface.

## The `/ui` entrypoint and the client presentation layer

The `/ui` entrypoint only earns its name if what it exports is genuinely pure. The good news,
measured against the tree rather than assumed: `client-core/src/ui/` is **already almost pure**.
Every component plugins import — `WorkspacePicker`, `MentionTextarea`, `UserAvatar`, `Picker`,
the primitives, the diff stack — takes its data as props and hands back DOM. `WorkspacePicker`
receives `workspaces`/`active`/`onSelect`; `MentionTextarea` receives `mentions: string[]`;
`UserAvatar` receives a `login` string. None of them fetch.

So this phase does not carve out a `connected/` folder full of components. It states the rule,
fixes the two real exceptions, and lets the architecture test hold the line from then on:

```text
packages/client-core/src/
  ui/                  pure presentation: props in, DOM out. No fetching, no store writes.
    primitives.tsx, Icon.tsx, IconPicker.tsx, iconNodes.ts, Modal.tsx, Tabs.tsx,
    CopyButton.tsx, UserAvatar.tsx, MentionTextarea.tsx, WorkspacePicker.tsx,
    Picker.tsx (the GENERIC picker: rows + callbacks, knows nothing),
    ContributionBoundary.tsx, diff/, displayMeta.ts, metrics.ts,
    cx.ts, focus.ts, dismissable.ts, appearance.ts, tokenAxes.ts
  connected/           created only when something needs it: data-aware compositions that may
                       import ui/ AND the data layer. Empty at the end of this phase, by design.
  tasks/, queries.ts, apiClient.ts, persistence/, registries/   (data layer, unchanged)
```

Import direction, strictly one way — this is the rule the boundaries test encodes:

```text
ui/  ←  connected/  ←  shell / registries / plugins
              │
              ▼
   domain queries (tasks/…) → queries.ts (machinery) → apiClient.ts (transport)
```

- `ui/` imports nothing from client-core's data layer at runtime, and nothing from `connected/`.
  **Type-only imports are allowed**: `WorkspacePicker` does `import type { FleetWorkspace } from
  '../workspaces/fleetWorkspaces'`, which is a shape it renders, not a store it reads. Write the
  rule against runtime imports or it fails on a component that is behaving correctly.
- The two exceptions to fix, both real:
  - **`ui/focus.ts`** imports `setFocusedPane` from `../tasks/tasks` and its `paneFocus` directive
    writes that store on `focusin`/`pointerdown`. Every other export in the file
    (`nextListIndex`, `createListNavigation`, `trapOverlayFocus`) is pure. Move `paneFocus` and
    its `solid-js` `Directives` declaration to the pane host area; leave the rest.
  - **`ui/monacoSetup.ts`** registers Monaco's web workers via Vite `?worker` imports. It is a
    bundler-coupled side effect, imported for its effect by the editor and database panes. Move
    it out of `ui/` into the editor feature area. It should not sit on a design-system entrypoint
    a third-party author is told to import from.
- `connected/` contains **components only — no query definitions**. Query keys are a data-layer
  contract (node-scoped keys, scope eviction, the persisted-IndexedDB-cache buster rule),
  reviewed where the domain queries live — a key minted inside a component file escapes that
  review surface, and "only one consumer" never stays true. The projects list is the live example:
  one key (`projectsKey = ['projects','v2']`, `packages/protocol/src/api.ts`) feeding pickers,
  palette rows, the rail, and settings. This mirrors plugins exactly: a plugin defines its own
  queries in its client dir on the `queries.ts` machinery; `connected/` is core's version of a
  plugin's panes — consumers, not definers.
- The connected shape, when something finally needs it, is deliberately thin — subscribe to a
  domain hook, hand rows to a pure component:

  ```tsx
  // connected/<Thing>Picker.tsx — the whole idea in one file
  export function ThingPicker(props: { onPick: (thing: Thing) => void }) {
    const things = useThingsQuery()                             // the connected part
    return <Picker rows={things()} onSelect={props.onPick} … /> // the ui/ part
  }
  ```

  This is the standing refactor recipe: when a `ui/` component starts wanting data, wrap it in
  `connected/` — never add the fetch to it. `WorkspacePicker` is what the recipe protects: its
  callers do the subscribing, so the component itself stays reusable and exportable.

Because the folder is already clean, the boundaries rules are pure path checks with **no
baseline** once the two exceptions above are moved. (The alternative — leave them and carry an
enumerated shrinking baseline — was considered; moving two things is cheaper than carrying
exceptions forever.)

Downstream consumers of this split: the `/ui` export list is the source-of-truth vocabulary for
the third-party CSS primitive kit (phase 3), and a clean `ui/` is what makes a future standalone
design-system package a trivial extraction rather than a project.

## Steps

1. The client presentation cleanup first (it changes what the entrypoints export): move
   `paneFocus` out of `ui/focus.ts` into the pane host area, move `ui/monacoSetup.ts` into the
   editor feature area and repoint its two side-effect importers (editor and database panes), then
   add the path rules to `tools/arch/boundaries.test.ts` — `ui/**` makes no runtime import of the
   data layer and none of `connected/`. Type-only imports pass.
2. Create `packages/plugin-api` with the three entrypoints, `package.json` `exports` map,
   tsconfig matching sibling packages. Wire into the pnpm workspace and the root lint loop.
3. Populate `node/index.ts`, `client/index.ts`, and `ui/index.ts` per the table above. Types
   re-export with `export type`; the handful of value exports (respond helpers, storage factory,
   apiClient, query helpers, UI components) re-export as values.
4. Repoint every import in `plugins/*/src` from `@acorn/node-core/...`, `@acorn/client-core/...`
   to `@acorn/plugin-api/node`, `/client`, or `/ui`. Mechanical; do it per-plugin so each commit
   is reviewable. `@acorn/protocol` imports stay. `contract/` imports between plugins stay.
   `testkit` imports stay.
5. Add boundary rules to `tools/arch/boundaries.test.ts`:
   - `plugins/*` may import `@acorn/plugin-api`, `@acorn/protocol`, sibling `contract/`
     entrypoints, and its own package — **nothing else from `packages/`** (carve-out: `testkit`
     from test files only).
   - `packages/plugin-api` may import only types/values that `packages/node-core`,
     `packages/client-core`, and `packages/protocol` export — it adds no behavior of its own.
   Follow the existing pattern of a shrinking enumerated baseline if any import cannot be moved
   immediately; the baseline must be empty by the end of the phase.
6. Add the surface snapshot test: build `plugin-api`'s rolled-up `.d.ts` (tsc
   `--emitDeclarationOnly` into a temp dir, concatenate deterministically) and compare against a
   committed snapshot file in the package. The test fails on any diff; updating the snapshot is
   the deliberate act of changing the contract. Keep it in the package's own vitest suite.
7. Update `docs/plugins.md`'s line "There is no separate `plugin-api` package" to describe the
   new package and the import rule.

## Exit criteria

- No file under `plugins/` imports `@acorn/node-core` or `@acorn/client-core` directly (except
  testkit in tests, if kept).
- `client-core/src/ui/` contains only pure presentation: `paneFocus` and `monacoSetup` have
  moved out, and both path rules pass with no baseline.
- `tools/arch/boundaries.test.ts` enforces all new rules (plugin imports + ui layering) with
  empty baselines.
- The `.d.ts` snapshot test exists and is green.
- `pnpm lint` green in every package; full vitest suite matches the pre-phase baseline.
- `docs/plugins.md` updated.

## Landmines

- **Deep type dependencies.** `NodePluginContext` references `Hono<AppEnv>`, `WsServerFrame`,
  `StreamHandlers`. Re-exporting the context type drags these; that is fine for now (hono is a
  normal dependency; protocol is public) but keep `StreamHandlers`/`WsChannelHandler` out of the
  documented surface — they ride along as internal types referenced by an excluded member. If tsc
  forces them into the rollup, note them in the snapshot as `@internal`.
- **`client-core/ui` churn.** Re-exporting the design system makes its props part of the
  contract. Export the small stable set (the `/ui` list above); resist exporting page-level
  components. The `ui/`↔`connected/` split helps here too: only the pure layer is on the `/ui`
  contract, and a component that grows a data dependency must move folders — which the snapshot
  diff and path rules both surface at review time.
- **Import-cycle risk is low** (plugin-api only re-exports) but run the acyclic-graph check in
  the architecture test before assuming.

## As built

Seven differences between the plan above and what shipped. Five of them are the same discovery:
**an entrypoint is a barrel, so importing one member evaluates every module on it**, and Solid
compiles a component to code that touches `window` at module scope. That is invisible in the app,
where a bundler tree-shakes and a DOM exists, and immediate in this repo's test setup, where suites
run in bare Node with no DOM by deliberate choice.

- **Four entrypoints, not three.** `/ui/diff` is separate because the diff model's `Row` type
  collides with the `Row` layout component on `/ui`, and renaming a symbol at thirty call sites is
  worse than one more export line.
- **`/client` and `/ui` are split by "is it a component", not by "is it presentation".** The
  design system's plain functions (`cx`, `token`, the metrics, `displayMeta`) are on `/client`;
  `registerKeybindings` and `registerWillHandler` are on `/ui` despite not being presentation,
  because they live in `.tsx` modules. The rule is mechanical and enforced by a boundaries rule
  rather than left to memory: only `ui/index.ts` may re-export from a `.tsx` module.
- **The surface snapshot pins exported NAMES, not a rolled-up `.d.ts`.** Every package here is
  consumed as TypeScript source, `noEmit` is global and nothing in the repo emits declarations, so
  a real rollup would mean adding both a declaration build and API Extractor to a monorepo that
  deliberately has neither. Names catch every addition, removal and rename; `tsc --noEmit` across
  the seventeen consumers already catches an upstream type changing shape.
- **`monacoSetup` moved to the app boot, not to a plugin.** Its two importers were in two
  different plugin packages, so "the editor feature area" did not exist as a shared home. It now
  lives at `client-core/src/editor/monacoSetup.ts` and is imported once from the renderer entry —
  which is also more correct than two panes racing to assign `self.MonacoEnvironment`.
- **No empty `connected/` directory.** Git cannot track one. The rule is stated here and in
  `docs/plugins.md`, and the `ui/` boundaries rule (an allowlist of destinations) already rejects
  an import of it.
- **Plugin tests keep their direct core imports**, with the reviewed-roots ratchet retargeted at
  them. See `docs/plugins.md` for why.
- **Two test harnesses had to catch up.** `apps/desktop`'s client suite stubs the globals that
  module-scope code needs; `@solidjs/router` reads `history.state`, and it is now on the import
  path of any plugin with a UI, so the stub grew a `History`. And `apps/node` registered agent
  profiles from a global `setupFile`, which pre-loaded core's whole server surface before any
  suite's `vi.mock` could hoist — every provider suite that mocks `server/db` got the real module.
  Profiles now register in-graph, which is the pattern `test/registerProviders.ts` already
  documented for exactly this hazard.
