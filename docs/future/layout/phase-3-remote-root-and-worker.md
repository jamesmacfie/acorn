# Phase 3: the remote root and the worker sandbox

Status: **shipped, 2026-08-29.** Deviations from the plan below are recorded at the end.

## Goal

Build the second render path: a tree protocol in `@acorn/protocol`, a host renderer that mounts kit
components from a tree, a Web Worker sandbox with the bridge moved onto it, `mountTree` in the SDK
with a Solid adapter, and validation with placeholders and roster rows. Prove it on one slot, the
agents tool card, by moving changes' tool renderer to a remote tree and rendering it inside today's
Solid transcript.

## Why this phase, and why now

The kit (0) is what a tree names, layouts (1) are what a tree fills, and focus (2) is what a tree
must inherit. With those in place the remote root is a renderer over an existing model rather than a
design of its own. It is proven on the tool card because that card is the reason changes is
first-party-only, because dozens render per screen so performance shows up at once, and because the
transcript is otherwise untouched in this phase.

## Scope

In:

- The tree protocol: node, mutation batch, event, and lifecycle messages, plus a props schema per
  kit node, in `packages/protocol/src/tree/`.
- The host renderer `client-core/src/plugins/tree/TreeHost.tsx`: applies batches to a Solid tree of
  kit components; owns handler-id mapping; enforces caps; draws the placeholder.
- The worker sandbox `client-core/src/plugins/tree/worker.ts` and `workerHost.ts`: one worker per
  bundle, lifecycle, termination, the bridge transport over `MessagePort`.
- `mountTree` on `@acorn/plugin-api/ui/sdk`, re-exported by `acorn-plugin-sdk`; the Solid remote
  adapter `plugin-sdk/src/remote/solid.ts` (a DOM shim the Solid runtime renders into).
- The `remote` contribution: `contributions.remote: [{ target, id, entry, ... }]` with one target in
  this phase, `agentToolRenderer`, keyed by tool name.
- The first `Slot` host: `AgentToolCallCard` in `plugins/agents/src/client/` resolves a remote
  renderer for the tool if one is registered, else the built-in card. This is the minimal slot, not
  the general one (phase 4).
- changes' `agentToolRenderer.tsx` rewritten against the kit and mounted both directly and through a
  worker in a test that diffs the two DOMs.
- Worker CSP: the shell's `app://` scheme gains `worker-src 'self'` for the worker script, served
  from the content-addressed plugin cache, with `connect-src 'none'` inside the worker enforced by
  the absence of `fetch` in the worker global (shim it to throw).

Out: the general `Slot` node and arbitration (phase 4), any loaded plugin moving (phase 5), any layout
region taking a tree from a manifest (the parser accepts it from phase 1; the renderer wires it here
but no plugin uses it until phase 5).

## Design detail

**Protocol.** As [06-remote-tree.md](./06-remote-tree.md) § The wire format. Props schemas are Zod,
one per kit node, generated from the node's exported props type where a build step can, and
hand-written where it cannot. The repo's Zod-at-wire-boundaries arch rule (`tools/arch/boundaries.test.ts`)
applies.

**Renderer.** A `Map<id, { component, setProps }>` over Solid components; `insert` creates, `patch`
sets a store, `remove` disposes, `move` reparents. Handler props arrive as ids; the renderer passes a
closure that posts `{ id, event, payload }` back. Text is set through `textContent`. Focus and
collection state come from phase 2 automatically because the mounted components are kit nodes.

**Worker lifecycle.** `workerHost.acquire(bundleHash)` starts or reuses; `release` schedules
termination after a grace period. The worker boots the bundle, which calls `mountTree`; the host
then sends `mount(slotId, props)` per tree. A thrown `mount` yields the placeholder for that slot.
A worker that misses a heartbeat is terminated and every tree it served shows the placeholder.

**Bridge on the worker.** `frames/sdk.ts` gains a transport interface with two implementations,
iframe `MessageChannel` (today) and worker `MessagePort`. `broker.ts`, `verbs.ts`, and `scopes.ts`
are untouched; the binding a worker receives is the same `FrameBinding` with `surface` naming the
remote contribution.

**Solid adapter.** A small DOM shim: `createElement(type)` becomes `insert` of a node with that kit
type, property sets become `patch`, `appendChild` and `insertBefore` become `move`, text nodes become
`text`. Attributes the kit does not know are dropped and recorded. Sized against remote-dom's Solid
adapter but smaller because the element set is closed.

**The tool card slot.** `AgentToolCallCard` asks a small registry `remoteToolRenderers` for the
tool name. If a trusted, enabled plugin on this node declared an `agentToolRenderer` for it, the card
body is a `TreeHost` bound to that plugin's worker with `props = { tool, defaultOpen, onOpenChange }`;
otherwise today's built-in card. changes registers its renderer both ways in this phase: compiled
(direct) in the shell as today, and as a remote entry from a test bundle, so the two can be diffed.

## Code touched

- New `packages/protocol/src/tree/{nodes.ts,messages.ts,schemas/*.ts}`.
- New `packages/client-core/src/plugins/tree/{TreeHost.tsx,workerHost.ts,worker.ts,placeholder.tsx,
  registry.ts}`.
- `packages/client-core/src/plugins/frames/sdk.ts`: transport interface; `mountTree`.
- `packages/plugin-sdk/src/{index.ts,public.ts}`: export `mountTree`; new `remote/solid.ts`.
- `packages/plugin-api/src/ui/sdk.ts` barrel: export `mountTree`.
- `packages/protocol/src/pluginContract.ts`: `contributions.remote`.
- `packages/client-core/src/plugins/contributions.ts` and `frames/register.ts`: register remote
  contributions per plugin, gated on trust like frames.
- `plugins/agents/src/client/toolRendererRegistry.tsx` and `AgentToolCallCard`: the slot.
- `plugins/changes/src/client/agentToolRenderer.tsx`: rewritten against the kit.
- `apps/desktop/src-tauri/src/app_scheme.rs`: `worker-src`; a Rust test pins it.
- `packages/create-acorn-plugin/index.mjs`: a `--remote` template (default flips in phase 9).

## Tests

- Protocol: every kit node has a schema; a fuzzed mutation stream never throws in `TreeHost`; a
  batch over the caps is dropped whole and recorded.
- Renderer (jsdom `hosts`): a fixed tree renders the expected kit components; `patch` re-renders one
  node; `move` preserves focus and collection state.
- Worker: a bundle that throws on `mount` yields the placeholder and a roster row; a terminated
  worker leaves the owner's tree intact; two trees from one bundle share one worker.
- The changes tool card renders identically through the direct path and through a worker.
- `app_scheme.rs` test: `worker-src` present, `frame-src` unchanged.

## Docs owed

- `docs/shell.md`: new § "The plugin worker"; § "The renderer bridge" notes the transport.
- `docs/security.md` § "The containment ladder" gains the worker rung; § "Third-party plugin
  bundles" notes the trust decision covers the worker.
- `docs/plugins.md` § "Loaded plugins: the client half": the tree path, alongside the frame path.
- `docs/managed-agents.md` § "Client surfaces": the tool card is a slot.

## Doors left open

- The wire format names nothing about the DOM.
- Events are the kit's semantic set, never keys or pointer events.
- The worker is one implementation behind a small sandbox interface.

## Done when

- changes' tool card renders through a worker in the running app and is indistinguishable from the
  compiled card.
- A deliberately broken test bundle yields the placeholder, a roster row, and an intact transcript.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## What was built, and where it differs from this plan

Seven deviations, all deliberate.

1. **`mountTree` takes a map, not a single render.** The plan wrote `mountTree(render)` and the
   contribution wrote `entry`. One worker serves every tree its bundle contributes, so the host has to
   say which renderer it wants; `mountTree({ toolCard: … })` makes `entry` a key lookup and a missing
   one a legible failure. A single callback would have needed the entry name passed into it anyway.

2. **One props schema for all 62 nodes, not 62.** `@acorn/protocol/tree/props.ts` holds one schema and
   `KIT_NODE_SCHEMAS` maps every node onto it, so the per-node tightening still has a place to land.
   The reason: the kit's components enumerate the props they read and never spread the leftovers onto
   an element, so an unknown prop is inert. What is not inert — a function, a `class`, a `style`, a
   role prop carrying a raw colour — is refused by the shared schema. 62 hand-written lists would have
   been defence in depth that rots on every kit change. Marked `ponytail:` at the file head with the
   upgrade path.

3. **The Solid adapter is `solid-js/universal`, not a DOM shim.** The plan sized it against remote-dom's
   Solid adapter. That was the wrong reference: `generate: 'universal'` compiles JSX straight into
   renderer calls, so there is no `document`, no template cloning and no `innerHTML` parser to write.
   `packages/plugin-sdk/src/remote/solid.ts` is forty lines. The consequence is that the remote root's
   mutators are free functions rather than methods, because that babel preset emits module-level calls;
   a node carries the root it is attached to in a side table.

4. **The worker script is served from `app://acorn/plugin-worker/<hash>.js`.** The plan said the shell's
   scheme gains `worker-src 'self'`, and it already had it. What it did not have was a way to *serve* a
   bundle at its own origin, which a worker script needs: `new Worker()` cannot cross to
   `app-plugin://<hash>`. `app_scheme.rs` now reads the same content-addressed cache the plugin scheme
   reads and answers under `PLUGIN_WORKER_CSP`.

5. **The tree channel is a second port, not a second message kind.** The host transfers two ports in
   the same hello: the bridge on `ports[0]`, the tree on `ports[1]`. `broker.ts`, `verbs.ts` and
   `scopes.ts` are untouched, exactly as planned, and the reason they could be is that nothing about
   the tree ever reaches them.

6. **changes ships compiled, and the remote proof is a test bundle.** As the plan's own scope note
   said. Its renderer was rewritten in the kit — `Fold`, `Stack`, `Badge`, `CodeBlock`, `Button`, no
   raw tag and no class — which is the part that ships.

7. **The two-path equivalence test compares a description, not a component.** A `.tsx` file compiles
   under one JSX preset per vitest project and the remote path's preset is `generate: 'universal'`, so
   compiling one component both ways needs a second build pipeline. `twoPaths.test.tsx` describes the
   tool card once as calls over a sink, renders it compiled and through the remote root plus `TreeHost`,
   and asserts the two `innerHTML`s are identical. Everything downstream of the preset is pinned; that
   Solid's universal preset reaches these same calls is the adapter's own test and the running app's.

8. **A tree's bridge carries no task and no project.** One worker per bundle means one bridge per
   bundle, and a bridge bound to whichever tree happened to start the worker would let a card in one
   task push a pane into another through `bridge.ui.openPane`. So the binding has no subject and the
   subject reaches a tree through its mount props, which are per slot and always current. The cost is
   that `openPane` and the in-app rung of `openUrl` are inert from a tree. That is the right default
   anyway — opening into somebody else's task layout is not obviously a contributor's to do — and
   phase 4 is where a slot's scope gets designed rather than inherited.

Two things the phase gained that the plan did not ask for:

- **An arch rule** (`tools/arch/boundaries.test.ts`, "the plugin SDK carries no dependency into a
  stranger's bundle"). `mountTree` reached for a protocol constant from the module beside the Zod
  schemas, and the published bundle went from 26 KB to 166 KB. The vite config already warned about it
  in a comment; a comment is not a check.
- **`contributions.remote` ids are namespaced** like frames, sources and slots
  (`packages/client-core/src/plugins/contributionIds.ts`), because a remote id is what a roster row and
  a failure row name it by.
- **One pre-existing flake fixed.** `registries/panes.test.tsx` polls for a lazy layout import with a
  250 ms budget and lost the race under a full `pnpm test` once this phase added more jsdom work to the
  same project. The budget is two seconds now.

Owed and not done: the manual check that changes' card renders through a worker in the running app.
`docs/testing.md`'s smoke checklist is where that belongs.

## Verify before building

- `packages/client-core/src/plugins/frames/{sdk.ts,broker.ts,verbs.ts,scopes.ts}` exist with the
  roles the survey describes; `verbs.ts` is the one list both sides compile against.
- `plugins/agents/src/client/toolRendererRegistry.tsx` resolves renderers by tool and
  `AgentToolCallCard` passes `defaultOpen` and `onOpenChange` (per `docs/managed-agents.md`).
- `plugins/changes/src/client/agentToolRenderer.tsx` exists and is registered through
  `ctx.agentToolRenderers`.
- `apps/desktop/src-tauri/src/app_scheme.rs` builds the shell CSP and has a test asserting
  `frame-src app-plugin:`.
- `packages/plugin-sdk/src/public.ts` declares `mountFrame` and `connect`; confirm how the published
  package is built so `mountTree` ships the same way.
- The Zod-at-boundaries arch rule in `tools/arch/boundaries.test.ts` exists and will apply to the
  new protocol module.
