# Phase 01: addresses

## Completion note, October 7, 2026

Implemented the six-form address parser, navigation-link builder, and in-app dispatcher. Task links
can name a pane without an item; an item requires a pane. Raw path and query components are checked
before URL normalization, and the builder refuses a link above the parser's length cap. The parser
has a pure leaf export for the terminal client. The dispatcher selects a paired Node, waits for that
Node's mounted shell, opens the routed place, and reports refusals in the notice ring and a toast.
It opens a project when a plugin page or task pane is missing. `new-task` still refuses links.

The parser and dispatcher are separate modules rather than one module because importing the parser
before the terminal connects must not load renderer state. Loaded project surfaces now record their
owning source so a pasted path selects the surface that renders it. The desktop registers its router
after compiled plugin registration and startup restore, using the Node captured when that shell mounts.
Node IDs are lowercase UUIDs in the Node data root; `local` resolves at dispatch time. Project paths
already drive workspace selection in the desktop shell.

Verification at the first commit: 21 parser tests and six dispatcher tests passed. Client-core and
desktop scoped lint passed, as did all 56 architecture boundary tests. The `pnpm test` run on Node
26.8 passed 31 of 36
package tasks. Failures outside this phase remain in generated Tauri schema doc paths, a Node route
golden list, desktop plugin registration snapshots, the client-core CSS token and route-scope checks,
and three Node backup tests that timed out under the full run.

Later phases should call `openLink` after the desktop receives a scheme event, use `buildLink` with the
active Node ID for Copy link, and replace the `new-task` refusal when the promotion flow is ready.
The terminal can import the pure `addresses` entry before it connects.

Phase 02 must also wait for loaded plugin route registration before treating a cold-start path as
missing. `clientPluginsReady()` covers the compiled roster only. `watchPluginChanges()` starts the
active Node's `syncPluginDistribution()` asynchronously; its distribution commit calls
`syncPluginContributions()`, which installs loaded project surfaces and sources. Expose or await that
initial active-Node reconciliation and contribution commit before dispatching a queued link. An
unreachable Node still needs a bounded fallback rather than an indefinite wait.

Follow-up verification on Node 26.9: 37 address parser tests, six dispatcher tests, four pure task
deep-link tests, and two mounted deep-link tests pass. Client-core and desktop scoped lint pass.
The isolated architecture boundary suite passes all 56 tests. The scoped client-core suite has two
failures outside this phase: `src/host/frames/scopes.test.ts:38` expects no unclassified routes but
receives `workspaceProjectOrderRoute /v1/core/workspaces/x/project-order`, and
`src/infra/styles/cssHygiene.test.ts:81` expects zero literal box shadows but receives two. The
architecture doc-path check at `tools/arch/docPaths.test.ts:89` finds three references to missing
generated Tauri schemas in `docs/future/security/01-desktop-command-authorization.md` at lines 22,
55, and 56. The detailed scoped logs are
`/private/tmp/acorn-phase01-followup-client-tests.log`,
`/private/tmp/acorn-phase01-followup-arch.log`, and
`/private/tmp/acorn-phase01-followup-boundaries.log`. The coordinator owns the next full repository
gate.

Date: October 7, 2026. Status: implemented. Dependencies: none.
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
