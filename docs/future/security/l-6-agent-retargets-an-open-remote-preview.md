> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-l-6-agents-can-t-retarget-an-open-remote-preview`.
>
> What landed:
>
> - A phone's preview keeps a port. `PreviewGrant` holds `port`, the number the task's address named when
>   the preview opened, and `target()`, which reads the address again. `pinnedPort` in `grants.ts` returns
>   the port only while `target()` still names it. Otherwise the preview server answers `502` on that name.
>   It never follows the address to the new port.
> - The device route keeps a port too. `serveLoopback` answers `GET <mount>/__acorn/port` with
>   `{ "port": n }`. A proxied request, HTTP or WebSocket, must carry `x-acorn-preview-port` with that
>   number, or the Node answers `502 preview_moved`.
> - The desktop helper pins its listener. `RendererConnection.openPreview` asks `__acorn/port` first, and
>   `openPreviewListener` takes the port and writes the header on every request, over any value the page
>   sent. A task whose port changed gets a new listener on a new origin, and the old one closes. So one
>   listener shows one port.
> - Both panes open again when the address changes. The desktop pane keys its listener on the whole
>   address, not just the path. The phone pane listens for `url-changed` and asks for another preview,
>   which gets another name.
> - `POST /v1/p/preview/tasks/:taskId/recipe-url` is device-only. A task token gets
>   `403 interactive_user_required`.
> - Tests: `grants.test.ts` and `loopbackRoute.test.ts` open on port A, move the target to B, and expect a
>   refusal. `listener.test.ts` refuses a WebSocket with a stale pin. `previewProxy.test.ts` checks that the
>   listener sends its own port over the page's. `rendererConnection.test.ts` gets a new origin after a
>   move. `plugins/preview/src/node/index.test.ts` expects `403` for a task token and `200` for a device on
>   `recipe-url`. Both pane tests reopen on `url-changed`. `apps/relay/src/previewEndToEnd.test.ts` moves the
>   recipe under an open phone preview through a real relay, gets `502` with none of the other service's
>   text, and then opens a new name that shows it.
> - Docs: `plugin-api.md` § Loopback routes, `bridge-and-broker.md` § Previews, `phone-channel.md`
>   § Previews, and `transport-and-auth.md` § Execution routes.
>
> Decisions and deviations:
>
> - The Node still reads the task's address on each request. It compares the address with the pinned
>   port, and never proxies to anything else. That's the finding's "answer `502` when it moves".
> - The helper asks the Node for the port rather than taking it from the renderer. That kept the
>   plugin-facing `previewProxy.open` signature as it was.
> - The Node requires the pin header on every device proxy request. An older desktop paired with this
>   Node sends none, so its remote previews answer `502` until it updates. A newer desktop with an older
>   remote Node fails to open the preview, because the older Node has no `__acorn/port`. I chose to fail
>   closed over keeping skewed versions working.
> - `recipe-url` isn't in `EXECUTION_ROUTES`, because it starts no process and the check is inside the
>   plugin's fetch handler, which that test can't see. The new plugin test covers it, and
>   `transport-and-auth.md` names it beside the execution routes.
> - A page that loses its port shows the Node's `502` text until the pane hears `url-changed`. If the
>   event is missed, reloading the pane or tapping **Try again** opens a new preview.
> - I didn't run the live check in `pnpm dev:remote`. The relay end-to-end test covers the phone path,
>   and `rendererConnection.test.ts` with `listener.test.ts` cover the desktop path in pieces.
> - Size: the Node service bundle grows by 102 B, from 1,970,224 B to 1,970,326 B.
> - `stale` lists two site pages, the trust model and the Node context reference. Neither describes the
>   loopback port or `recipe-url`, so neither changed.
>
> For later phases: R-6 is untouched. A new client of a loopback route must ask `__acorn/port` and send
> `x-acorn-preview-port`, or the Node refuses its proxied requests. R-5 may want to close a pinned
> listener's sockets on revoke the same way `RendererConnection` closes a moved one.
>
> What acorn-cloud would still need: nothing. The relay carries the preview's TLS unchanged.

# L-6: A task agent can point an open remote preview at any local port

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da`.
Severity: medium. Confidence: confirmed from code, not run live. Status: open.

## What goes wrong

A remote preview shows a task's dev server on one web address for as long as it is open. The Node asks
which port that is again on every request, and the task's own agent can change the answer. So the page
keeps its address while the service behind it changes. A page the agent wrote can then read and write
any other HTTP service on the Node's loopback through the owner's browser, as the same site.

## Who can do it

An agent that read hostile text and acts for whoever wrote it. It needs its own task token, which every
managed session holds, and a port to serve a page on. The owner must have the task's preview open on a
phone, or in a desktop window that shows a remote Node's preview. The sandbox that keeps an agent's shell
off other loopback ports doesn't apply, because the owner's browser makes the requests.

## How it goes

1. The agent serves a page on a port of its own and sets it as the task's preview address with
   `POST /v1/p/preview/tasks/:taskId/recipe-url`. The route refuses only a token for another task
   (`plugins/preview/src/node/index.ts:30-43`).
2. That address beats the run target, the project's setting, and the project's script
   (`plugins/preview/src/server/previewUrls.ts:91-92`). Any `http` address on a loopback name counts
   (`plugins/preview/src/server/loopbackPort.ts:6-10`).
3. The owner opens the preview. The page loads on `https://<preview>.<node>.<domain>` on a phone, or on
   the desktop helper's listener (`packages/custody/src/broker/previewProxy.ts:113`).
4. The agent sets the preview address to another port, such as a database's admin page, a debugger, or
   another task's dev server.
5. The grant holds a function, not a port (`packages/node-core/src/server/transport/preview/grants.ts:22`).
   The loopback route passes `port: () => target(params)`
   (`packages/node-core/src/server/proxy/loopbackRoute.ts:59`), and the preview server calls it for each
   request (`packages/node-core/src/server/transport/preview/previewServer.ts:115`). The route's own
   proxying resolves the port per request too (`packages/node-core/src/server/proxy/loopbackRoute.ts:46-71`).
6. The page's script fetches a path on its own origin. The proxy sends it to the second port with
   `Host: localhost:<port>` and the origin rewritten to match
   (`packages/node-core/src/server/proxy/loopbackProxy.ts:71-86`), so the service sees a local caller.
   The page reads the answer, because the browser sees one site.
7. The agent sets the address back to its own port, and the page posts what it read.

A WebSocket works the same way. The preview server admits an upgrade from the page's own origin
(`packages/node-core/src/server/transport/preview/previewServer.ts:133`), so a debugger that speaks
over a socket and checks only for a local `Host` is reachable.

## What limits it

- The owner has to have the preview open while the agent switches ports.
- The proxy refuses the Node's own port (`packages/node-core/src/server/proxy/loopbackProxy.ts:113`), and
  it speaks plain `http` only, so another Node's listener doesn't answer.
- An agent outside the sandbox can reach loopback ports directly, so this adds nothing for it. The gain
  is for a session in the read block, whose shell may reach the Node's own port and nothing else
  (`plugins/agents/src/server/drivers/claudeHarness.ts:77`).
- A grant ends after 12 hours, when its device is revoked, or when the Node restarts.

## Fix

Do both in this repository:

- Resolve the port once, when the preview opens, and keep the number on the grant. When the task's
  address moves to another port, answer `502` and let the client open another preview, which gets
  another name and so another origin. Do the same for the desktop helper's listener: one listener, one
  port.
- Make `POST /tasks/:taskId/recipe-url` device-only, as the execution routes are. The owner picks a
  recipe in the preview pane, and an agent has the run targets to say where its app listens.

The second alone leaves the run target and the project script able to move the port. The first alone
lets an agent choose the port the next preview opens on, which is the port the owner then sees.

## How to check the fix

- In `packages/node-core/src/server/transport/preview/grants.test.ts` and
  `packages/node-core/src/server/proxy/loopbackRoute.test.ts`, open a preview for port A, change the
  target to port B, and expect the next request to be refused, not proxied to B.
- In `plugins/preview/src/server/previewUrls.test.ts` or a route test, expect `403` for a task token on
  `recipe-url` and `200` for a device.
- Live, in `pnpm dev:remote`: open a task's preview, switch the address from the task's terminal, and
  confirm the open page stops loading until it is opened again.

## Related

- [R-6](./r-6-previews-put-the-cloud-inside-tls.md): who else can hold a preview's cookie.
- [R-5](./r-5-revoke-leaves-proxied-sockets-open.md): a proxied socket outlives a revoked device.
- [Execution routes](../../security/transport-and-auth.md#execution-routes), the device-only list this
  route belongs on.
- [Previews](../../relay/phone-channel.md#previews) and
  [loopback routes](../../plugins/plugin-api.md#loopback-routes).
