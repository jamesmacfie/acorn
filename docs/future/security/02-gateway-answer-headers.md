# Phase 2: sandbox what the gateway forwards

## Completion note

Done on October 22, 2026.

What landed:

- `forward` in `apps/mobile/src/gateway/gateway.ts` sets `SANDBOXED` on every Node answer:
  `content-security-policy: sandbox; default-src 'none'` and `x-content-type-options: nosniff`.
  `answer` sets the same two on every gateway error.
- `NOT_RETURNED` also drops the Node's `content-security-policy` and `x-content-type-options`. The
  Node's header names keep their case, so spreading `SANDBOXED` over them would send a plugin's
  `Content-Security-Policy` beside ours rather than replace it.
- The app page's policy is `APP_POLICY`, with the four directives this doc lists. A comment names the
  directives of the desktop's `renderer_csp` it leaves out and why.
- The mobile gateway reference describes the sandbox under **Forward requests** and gives the full app
  policy in the paths table. No public site page cites the changed files.
- Tests in `gateway.test.ts`: a plugin HTML answer with its own mixed-case policy, a JSON answer, the
  app page's policy, and a 404 error answer.

Decisions and deviations:

- The two success answers the gateway builds itself, `GET /session` and the sign-in `204`, don't carry
  the sandbox. The doc asked only for `answer`'s errors. Both are JSON or empty.
- `content-security-policy-report-only` from the Node still passes through. It can't loosen anything.

For later phases:

- The `pnpm dev:mobile` walk in Acceptance didn't run here, because it needs a real phone. Phase 6
  should open `/node/v1/core/tasks` in the phone's browser and check the policy in its tools.
- The phone app downloads attachments with `fetch` and builds a `blob:` link, so the sandbox doesn't
  touch downloads. A future feature that links straight to a `/node` address would open a sandboxed
  page.

Date: October 22, 2026. Status: proposed. Severity: medium.

The phone gateway serves the phone app and the Node's API from one address, and the session cookie
works for both. A Node answer that a browser renders as a page runs with that cookie. A loaded plugin
can answer with HTML, so a hostile or compromised plugin can get out of its sandbox through a phone.
This phase stops a browser rendering any forwarded answer, and fills out the policy on the app's own
page. Read [the programme](./README.md) first.

## Starting point

Read at `47287b67c`.

- `forward` in `apps/mobile/src/gateway/gateway.ts` writes the Node's status, its headers minus
  `NOT_RETURNED`, and its body. `NOT_RETURNED` drops `set-cookie` and the hop-by-hop headers. It keeps
  `content-type`.
- `servePluginFetch` in `packages/node-core/src/server/pluginHost/fetchRoute.ts` returns a loaded
  plugin's response as the plugin built it, and `pluginRpc.ts` rebuilds it from the worker with the
  plugin's own headers. Nothing on the way sets a content security policy.
- First-party routes are safer. JSON routes answer `application/json`. Attachments and artifacts
  answer `content-disposition: attachment` with `nosniff` (`plugins/agents/src/server/routes/managed.ts`).
  The editor's image route serves raster types only, with `nosniff`
  (`plugins/editor/src/contract/imagePreview.ts`).
- The cookie is `SameSite=Strict`, so a link from another site arrives without it. A link inside the
  phone app is same-site, so it arrives with it. The app's Markdown renderer turns an absolute `https`
  link in an agent's message into a link, and an agent can learn the gateway's address from the
  `--origin` flag in the process list.
- `serveApp` sends `content-security-policy: script-src 'self'` with the app's files, and nothing
  else in the policy. The desktop's policy, in `apps/desktop/src-tauri/src/app_scheme.rs`, is longer.

The chain this closes: a loaded plugin answers `GET /v1/p/<plugin>/page` with an HTML page and a
script. An agent posts a message with a link to `https://HOST/node/v1/p/<plugin>/page`. The owner taps
it on the phone. The script runs on the gateway's address and calls `/node/...` with the cookie, which
can open a terminal.

## Changes

### Sandbox every forwarded answer

In `forward`, after `returnedHeaders`, set these on every answer the Node sends back:

- `content-security-policy: sandbox; default-src 'none'`
- `x-content-type-options: nosniff`

Set them over whatever the Node sent, so a plugin can't loosen them. The phone app reads every
forwarded answer with `fetch` (`apps/mobile/src/client/platform.ts`), and a policy on a fetched
answer doesn't apply to the page that fetched it, so nothing the app does changes. An `<img>` that
points at a `/node` path still draws, because a policy doesn't stop an image loading. A page opened at
a `/node` path renders with no script and no requests, and its origin is opaque, so it can't use the
cookie.

Set the same two on the gateway's own error answers from `answer`, so every answer that isn't the
app follows one rule.

### Fill out the app page's policy

Extend the policy `serveApp` sends with directives that can't break the app:

- `object-src 'none'`
- `base-uri 'none'`
- `frame-ancestors 'none'`
- `form-action 'self'`

Don't add `default-src` or `style-src` in this phase. The app sets styles at run time, and a style
directive needs its own check on a real phone. Compare with `app_scheme.rs` and note in a comment
which of its directives were left out and why.

### Update the reference

In [the mobile gateway](../../security/mobile-gateway.md), add to **Forward requests**: the gateway
sandboxes every forwarded answer, so a Node answer never renders as a page with the phone's session.
Update the app page's policy in the paths table.

## Tests

In `apps/mobile/src/gateway/gateway.test.ts`:

- A broker answer with `content-type: text/html` and its own `content-security-policy` comes back
  with the sandbox policy and `nosniff`, and the original policy gone.
- A JSON answer keeps its `content-type` and gains the same two headers.
- An app file answer carries every directive above, and an error answer carries the sandbox policy.

## Acceptance

- With `pnpm dev:mobile`, the phone app signs in, lists tasks, opens an agent conversation, shows an
  attachment picture, and holds its event socket, as before.
- Opening a `/node/v1/core/tasks` address directly in the phone's browser shows the JSON as text,
  and the browser's tools show the sandbox policy on it.
