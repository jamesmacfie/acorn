# 09: Remove the preview tunnel

> **Completion note, October 12, 2026.** No tunnel code is left on any layer. `pnpm lint`, the arch
> tests, the touched package suites, and the desktop suite with `cargo test` pass on Node 26.8.1.
>
> What landed:
>
> - The Node's `tunnel.ts`, `tunnelPorts.ts`, and their tests are deleted, and so is custody's
>   `previewTunnel.ts` with its test. `createHelper` has no `tunnelEvents` option and no `tunnels`
>   member. The helper routes, the bridge verbs, the `tunnel-opened` and `tunnel-closed` signals,
>   the Rust signal variants, and the cookie store in `webviews.rs` are gone.
> - `fleetBridge()` has no `tunnelOpen` or `tunnelClose`. The protocol has no `nodeTunnelRequestSchema`
>   or `MAX_TUNNEL_MESSAGE_BYTES`.
> - `tunnelUrl.ts` is renamed to `packages/client-core/src/infra/node/previewUrl.ts` and keeps only
>   `remotePreviewBlocked` and `previewUrlForClient`. Its test keeps every local-only case.
>   `tunnelUrl` and `closeTunnelsForTask` are out of the facade, and the surface snapshot is
>   regenerated.
> - The preview pane no longer closes tunnels on unmount. Its test drops the two cases that only
>   checked that cleanup and keeps the Node-binding case.
> - The reference pages no longer describe the tunnel. That covers the WebSocket, transport, and
>   security pages, the shell and architecture pages, the smoke checklists, and the release notes.
>
> Decisions and deviations:
>
> - **The upgrade-claim helper is gone too.** `upgradeClaim.ts` and the listener's "nobody claimed it"
>   handler came with the tunnel on August 7, so two upgrade handlers could share one listener. The
>   hub is the only handler left, so it destroys an upgrade to any other path itself. A new hub test
>   sends an authenticated upgrade to `/v1/tunnel` and expects the socket to be destroyed, the same
>   as any unknown path. Without the destroy, that test times out.
> - **The dated security review is exempt from the doc path check.** Its evidence table cites the two
>   deleted tunnel tests. `tools/arch/docPaths.test.ts` already had an empty `REVIEWS` list kept for
>   this case, so `docs/security/review-2026-10-01.md` went on it instead of being rewritten.
> - The frame scope table said `/v1/core/tasks/:id/preview-url` "hands out a tunnel URL". That route
>   runs the project's preview script, so the note says that.
> - The cloud designs said the tunnel exists. `docs/future/cloud/architecture.md` and
>   `phases/04-relay.md` now say it was deleted. Cloud phases 04 and 05 still plan to open a remote
>   preview through `/v1/tunnel`. That plan needs a new design, because remote previews are refused
>   in the client, not just missing a transport.
>
> What `git grep -il tunnel apps packages plugins` still finds, none of it tunnel code:
> `train-front-tunnel`, a Lucide icon name in `workspaceIconNames.ts`, and a dated October 9 note in
> `apps/node/scripts/check-service-budget.mjs`. `docs/frontend/startup-budget.md` and
> `docs/testing/selective-server-loading-2026-10-09.md` keep the same October 9 history.
>
> Two client-core tests failed once under the package suite and are not this change. The
> `telemetry and log` cases in `src/host/frames/sdk.test.ts` wait one `setTimeout(0)` for a message
> and fail about 1 run in 10 alone, on the base commit too. `DiffPane.test.tsx`'s "draws colour a
> timeout decided" case failed under load and passed three runs alone. Neither touches the tunnel.
>
> For later phases: proposal 12 can drop `authorizeWsUpgrade` and the `AuthorizedWsUpgrade` type
> from `wsHub.ts`. The tunnel was the only production caller, and only `wsHub.test.ts` calls the
> function.

This proposal deletes the preview tunnel. Nothing has opened one since September 28, 2026, but the
whole chain still ships, including an authenticated upgrade endpoint on every Node.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md).

## Problem

The preview tunnel let a desktop preview pane load a page served on a remote Node, through a
loopback listener in the desktop helper and a `/v1/tunnel` upgrade on the Node. Commit `9f3e95f56`
on September 28 refused remote previews, because a remote page in the client's native webview could
reach the client's private network. Only a local Node's URL may enter the webview since then, and
it loads directly.

No caller has opened a tunnel since that commit. `fleetBridge().tunnelOpen` has no callers, so
every step behind it is unreachable:

| Layer | Code |
| --- | --- |
| Client platform | `tunnelOpen` and `tunnelClose` in `packages/client-core/src/infra/platform/index.ts` and its member list in `contract.ts` |
| Client helper | `tunnelUrl` and `closeTunnelsForTask` in `packages/client-core/src/infra/node/tunnelUrl.ts` (deleted), re-exported by `packages/plugin-api/src/client.ts` |
| Desktop bridge | `nodeTunnelOpen` in `apps/desktop/src/shell/bridge.ts`, and the `node-tunnel-open` and `node-tunnel-close` verbs in `apps/desktop/src/shell/wire.ts` |
| Desktop helper | The two tunnel routes in `apps/desktop/src/helper/helperServer.ts`, and the tunnel signals in `apps/desktop/src/helper/helperMain.ts` |
| Custody | `PreviewTunnels` in `packages/custody/src/supervision/previewTunnel.ts` (deleted), built in `packages/custody/src/index.ts` |
| Rust shell | The tunnel signals in `apps/desktop/src-tauri/src/helper.rs`, their handling in `lib.rs`, and the tunnel cookie store in `webviews.rs` |
| Protocol | `nodeTunnelRequestSchema` in `packages/protocol/src/transport/broker.ts`, and `MAX_TUNNEL_MESSAGE_BYTES` in `ws.ts` |
| Node | The `/v1/tunnel` upgrade in `packages/node-core/src/server/transport/tunnel.ts` (deleted), its port allowlist in `tunnelPorts.ts`, and their wiring in `listener.ts` |

That's about 600 lines of TypeScript and 800 lines of tests, plus Rust. `tunnelUrl` says it's kept
"for callers outside this repository", but only the first-party facade exports it, and a loaded
plugin can't import that. The preview pane still calls `closeTunnelsForTask` on unmount, which
closes tunnels that never open.

The Node endpoint is the part that matters most. It's an authenticated network entry point with its
own upgrade path and port allowlist, kept for a feature that no longer exists.

## Goal

No tunnel code remains on any layer. The preview pane's local-only rule stays, and stays tested.

## Requirements

1. Delete the Node's tunnel: `packages/node-core/src/server/transport/tunnel.ts` and
   `tunnelPorts.ts` are deleted with their tests, and `listener.ts` loses the wiring.
2. Delete custody's `packages/custody/src/supervision/previewTunnel.ts` and its test, and remove the
   tunnel members from `createHelper`'s options and result.
3. Delete the helper routes, the bridge verbs, the shell signals, and the Rust cookie store.
4. Delete `tunnelOpen` and `tunnelClose` from the client platform, and `tunnelUrl` and
   `closeTunnelsForTask` from client-core and the facade. Keep `remotePreviewBlocked` and
   `previewUrlForClient`, and rename their file for what's left, such as `previewUrl.ts`.
5. Remove the `closeTunnelsForTask` cleanup from `plugins/preview/src/client/PreviewTaskPane.tsx`.
6. Delete the protocol schema and constant.
7. Update the reference pages that describe the tunnel. `git grep -il tunnel docs` finds them. Start
   with `docs/api-reference/websocket.md`, `docs/security/webviews.md`, `docs/shell/webviews.md`, and
   `docs/security/transport-and-auth.md`. Leave the dated `docs/security/review-2026-10-01.md` as
   written.
8. Regenerate `packages/plugin-api/src/surface.snapshot.txt`.

## Acceptance

- `git grep -il tunnel apps packages plugins` finds no tunnel code. Third-party code under
  `node_modules` and the vendored WebDriver plugin don't count.
- A request to `/v1/tunnel` on a running Node gets the same answer as any unknown path.
- The preview pane still refuses a remote Node's URL, with its test passing.
- `cargo test` in `apps/desktop/src-tauri` and `pnpm --filter @acorn/desktop test` pass.
