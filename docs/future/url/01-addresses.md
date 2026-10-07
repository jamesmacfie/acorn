# Phase 01: addresses

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: none.
Read the [plan](./README.md), especially [the address format](./README.md#the-address-format) and
[the safety rules](./README.md#safety-rules).

## Deliverable

One module in `client-core` that turns an `acorn://` link into a typed address, turns an address back
into a link, and opens an address inside the app. Nothing reaches the operating system yet. The
desktop and the terminal client both import it.

## Steps

1. Define the address type as a union with one member per form: task, project path, settings, source,
   open, and new task. Each member carries the Node slot as written, before any alias is resolved.
2. Write `parseLink(href)`. Return the address or a typed refusal, never throw. Refuse a link that
   isn't `acorn:`, has no Node, names an unknown form, carries a `url=` that isn't `http` or `https`,
   or is longer than the cap. Decode each value once.
3. Write `buildLink(nodeId, place)` for the places Acorn can name: a task with an optional pane and
   item, a project path, a settings target, and a source. Build paths with the helpers in
   `packages/client-core/src/host/registries/commands/corePaths.ts`, so link paths and router paths
   come from one place.
4. Write `openAddress(address)`. Resolve `local` to `homeNodeId()` from
   `packages/client-core/src/infra/node/fleet.ts`. Switch with `setActiveNode` when the address names
   another paired Node, and refuse an unpaired one. Then dispatch:
   - Task and project forms navigate the router. A task link's pane query rides through to
     `createTaskDeepLink`, which already consumes and strips it.
   - Settings emits `presentation:open-settings` with the target.
   - Source calls `setSelectedSource`.
   - Open calls `openInAppUrl`. When nothing in Acorn claims the URL, say so. Don't hand it to the
     browser, because the person asked for Acorn.
   - New task returns a refusal in this phase. Phase 04 adds it.
5. Report refusals and missing places through the notice seam, with the reason and the link.
6. Keep the module beside `corePaths.ts`, since it is the outside spelling of those paths. Export it
   through the feature's public file for the desktop and the terminal client.

## Acceptance

- Table tests cover every form, every refusal, percent-encoded IDs, a plugin path under
  `p/<projectId>/x/<pluginId>/`, an unknown plugin path, `local`, another paired Node, and an unpaired
  Node.
- A round-trip test shows `parseLink(buildLink(...))` returns the same place for each buildable form.
- Dispatcher tests in the `client-core` jsdom project show each form reaches its target, and a refused
  link raises a notice instead of navigating.
- `pnpm lint` and `pnpm test --filter=@acorn/client-core` pass.

## Verify before building

- The README's open questions about Node ID casing and workspace switching. Both change what
  `openAddress` has to do.
- How the router is reached from outside a component. `openAddress` runs from a Tauri event in phase
  02, not from inside the route tree.
- Whether a Node switch must finish remounting the shell before navigation, since the router lives
  under the keyed Node provider in `apps/desktop/src/client/index.tsx`.
