# Phase 0 — Extract `@acorn/plugin-api`

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
                       client data toolkit, connected components
    ui/index.ts        pure presentation re-exports (client-core ui/ — primitives, Icon,
                       Picker, Tabs, Modal, CopyButton, diff model, appearance)
  package.json         exports: { "./node": …, "./client": …, "./ui": … }
```

Plus: every first-party plugin repointed to it, the `ui/` vs `connected/` split inside
client-core with its boundary rules, and a `.d.ts` snapshot test that makes surface changes
deliberate.

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
| Client registries | `registries/panes.ts` (15), `sources.ts` (10), plus slots, paletteRows, attention, nodeStats, refPanels, settings, pollers, keybindings, commands | Re-export the contribution **types**; the registration functions stay host-internal (plugins register via `ctx`, never by importing a registry) |
| UI primitives | `client-core/ui/primitives.tsx` (17), `ui/Icon.tsx` (10), `ui/Picker.tsx` (7), `ui/CopyButton.tsx` (7), `ui/Tabs.tsx` (4), `ui/Modal.tsx` (2), `ui/diff/model.ts` (8), `ui/appearance.ts` (8) | Re-export via the `/ui` entrypoint — the pure design-system surface (see next section) |
| Connected components | `ui/RepoPicker.tsx`, `ui/WorkspacePicker.tsx`, `ui/MentionTextarea.tsx` (plugins use all three) | Move to `client-core/src/connected/`, re-export via `/client` beside the data toolkit they depend on |
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

The `/ui` entrypoint only earns its name if what it exports is genuinely pure. Today
`client-core/src/ui/` mixes pure presentation with three data-aware components, so this phase
splits the folder and enforces the layer:

```text
packages/client-core/src/
  ui/                  pure presentation: props in, DOM out. No fetching, no stores.
    primitives.tsx, Icon.tsx, IconPicker.tsx, Modal.tsx, Tabs.tsx, CopyButton.tsx,
    Picker.tsx (the GENERIC picker: rows + callbacks, knows nothing),
    diff/, cx.ts, focus.ts, dismissable.ts, appearance.ts, tokenAxes.ts
  connected/           data-aware compositions: may import ui/ AND the data layer.
    RepoPicker.tsx, WorkspacePicker.tsx, MentionTextarea.tsx
  tasks/, queries.ts, apiClient.ts, persistence/, registries/   (data layer, unchanged)
```

Import direction, strictly one way — this is the rule the boundaries test encodes:

```text
ui/  ←  connected/  ←  shell / registries / plugins
              │
              ▼
   domain queries (tasks/…) → queries.ts (machinery) → apiClient.ts (transport)
```

- `ui/` imports nothing from client-core except itself. Nothing in `ui/` imports `connected/`.
- `connected/` contains **components only — no query definitions**. `RepoPicker` imports
  `useReposQuery` from the tasks domain module; it does not define it. Query keys are a
  data-layer contract (node-scoped keys, scope eviction, the persisted-IndexedDB-cache buster
  rule), reviewed where the domain queries live — a key minted inside a component file escapes
  that review surface, and "only one consumer" never stays true (the repo list is wanted by
  pickers, palette, sources, onboarding). This mirrors plugins exactly: a plugin defines its
  own queries in its client dir on the `queries.ts` machinery; `connected/` is core's version
  of a plugin's panes — consumers, not definers.
- The connected shape is deliberately thin — subscribe to a domain hook, hand rows to a pure
  component:

  ```tsx
  // connected/RepoPicker.tsx — the whole idea in one file
  export function RepoPicker(props: { onPick: (repo: Repo) => void }) {
    const repos = useReposQuery()                              // the connected part
    return <Picker rows={repos()} onPick={props.onPick} … />   // the ui/ part
  }
  ```

  This is also the standing refactor recipe: when a `ui/` component starts wanting data, wrap
  it in `connected/` — never add the fetch to it.

Because only three files move, the boundaries rules are pure path checks with **no baseline**:
`ui/**` imports no data layer and nothing from `connected/`; done. (The alternative — leave the
files and carry an enumerated shrinking baseline — was considered; moving three files is cheaper
than carrying exceptions forever.)

One judgment call during the move: `UserAvatar` — if it renders from props it is `ui/`; if it
resolves a user itself, it lands in `connected/` or gets the wrap treatment. Either is fine; the
test enforces whichever it is from then on.

Downstream consumers of this split: the `/ui` export list is the source-of-truth vocabulary for
the third-party CSS primitive kit (phase 3), and a clean `ui/` is what makes a future standalone
design-system package a trivial extraction rather than a project.

## Steps

1. The client presentation split first (it changes what the entrypoints export): move
   RepoPicker/WorkspacePicker/MentionTextarea to `client-core/src/connected/`, settle
   UserAvatar, fix imports (mechanical), and add the two path rules to
   `tools/arch/boundaries.test.ts` (`ui/**` → no data layer, no `connected/`).
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
- `client-core/src/ui/` contains only pure presentation; the three connected components live in
  `connected/`; both path rules pass with no baseline.
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
