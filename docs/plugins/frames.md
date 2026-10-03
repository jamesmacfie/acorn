# Frames

This page covers the frame render path: a sandboxed iframe the plugin draws itself, and the bridge it
talks through. Use a frame only when the surface owns its pixels, such as a canvas or a chart
library. Otherwise use a [remote tree](./remote-trees.md). It's part of the
[plugin reference](../plugins.md).

## Frame contribution kind

A frame is a pane, reference panel, settings page, project importer, or full-screen overlay picker
that the plugin draws. A `pane` declares a `scope` of `task`, the default, or `project`:

- A task pane is a rectangle in a task's layout.
- A project pane is drawn beside its own rail source's list at `/p/:projectId`, with no task. It must
  have a `routes` entry addressing it and a source whose `onSelect` navigates to it. Those are its
  address and its only mount site, so a manifest missing either is rejected.

Each frame renders in an iframe on `app-plugin://<bundle-hash>`, a scheme the shell serves from its
content-addressed cache with `connect-src 'none'`. The frame has no network, no `window.acorn`, and
no reach into the shell. Its only input and output is one `MessagePort`. The host pins which Node the
frame talks to, and the frame can't name one.

A `refPanel` and an `overlay` are the two frame targets whose surrounding chrome the host draws. An
iframe can't draw outside the box it was placed in, so the host supplies the drawer or backdrop and
the dismiss control, and the frame supplies the body. A reference panel is also the one surface no
plugin mounts. The shell holds which item is open and draws it in one place
(`client-core/host/registries/panes/refPanels.ts`), so any surface can call
`openRefPanel({ providerId, displayId })`. One panel is open at a time, and `openRefPanel` returns
`false` when that provider has no panel on this device. A panel's props name its subject `target`,
never `ref`, because Solid compiles `ref` into a DOM setter. `tools/arch/boundaries.test.ts` enforces
that.

`mountFrame({ styles }, (bridge, root) => …)` on `/ui/sdk` boots a frame in one call. It injects the
inlined stylesheet, creates the root element, mounts the frame's own tooltip listener, waits for the
bridge, and paints an alert banner if the handshake never lands. It takes a render callback, so the
entrypoint stays framework-free.

A frame has to say hello. The SDK posts `connected` when `connect()` resolves, and the host starts a
10-second deadline when it transfers the port. A frame that sends nothing is replaced with a "This
plugin's UI failed to start" placeholder. Any message counts as the acknowledgement. A surface the
device couldn't register, usually because something else owns the contribution id, is skipped and
reported in the attention inbox.

### Ids sit inside the plugin's namespace

Contribution ids double as persisted layout keys and chord targets, so a loaded plugin's pane,
source, and slot ids must equal its plugin id or start with `<id>-` or `<id>.`. An id that doesn't
is bound to `<pluginId>.<id>`. That keeps a plugin from claiming an id core adds later. Commands are
already qualified as `plugin.<pluginId>.<commandId>`.

The binding happens once, where the device reads the roster row
(`packages/client-core/src/host/plugins/contributionIds.ts`). It rewrites the declaration and every
reference to it: `action.pane`, `action.surface`, `action.overlay`, `routes[].surface`, and
`contentLinks[].pane`. Compiled plugins aren't rewritten, because a collision with core fails in
`pnpm test`.

## Enforcement

Every bridge call is checked against the manifest's declared scopes by an allowlist that names each
path and method (`packages/client-core/src/host/frames/scopes.ts`). The plugin's own `/v1/p/<id>/`
namespace needs no scope. Another plugin's namespace is always refused. The grantable scopes are in
[permissions](../plugin-authoring/permissions.md).

The bridge parses a request path before authorization and forwards that same canonical path with its
query string. It refuses a path whose route changes during URL parsing, encoded path separators, and
fragments, so a plugin route can't normalize into a core route or another plugin's route.

The `api` verbs are `get`, `post`, `put`, `patch`, and `del`, matching `PluginBridgeApiRequest.method`.
`frames/verbs.ts` derives the wire union, the author surface (`bridgeTypes.ts`), and the host surface
(`PluginFrame.tsx`, through `FrameServices`) from one list, with two `Covers<>` assertions that fail
the build when they disagree. Three verbs ask nothing of the services: `cancel`, `connected`, and
`telemetry`.

### Request lifetime

The bridge reserves a request id until its API, state, document, or webview handler settles or the
request is cancelled. A non-cancel message that reuses a live id closes the bridge before dispatch.
Completed or cancelled ids can be reused.

Cancellation and disposal suppress late replies. API calls get an abort signal. State writes,
document flushes, and webview commands have no abort, so cancelling doesn't undo an effect already
issued. A cancelled operation still counts against the outstanding-work cap until its handler
settles. Disposal aborts every active API signal and suppresses late completions.

The host closes a bridge after more than 1,000 messages in 10 seconds, or when a message arrives while
100 handlers are outstanding, including cancelled handlers that haven't settled. The host then shows
a "plugin misbehaving" placeholder.

## Binary bridge calls

The five `api` verbs send JSON. For a route whose body is bytes, such as an image or a PDF, use the
byte calls:

```ts
const { bytes, type, filename } = await bridge.api.getBytes('/v1/p/image-markup/files/a1')
await bridge.api.postBytes('/v1/p/image-markup/files', { bytes, type: 'image/png', filename: 'a.png' })
```

They use a separate wire kind, `api.bytes`, so a JSON call can't get byte semantics by getting a
field wrong. `allowApi` decides the path before either handler reads a body, so a 12 MiB POST at
another plugin's namespace is refused unread. Only GET and POST are supported, capped at 12 MiB each
way, with no streaming. `type` and `filename` are advisory. The receiver decides what the bytes are.

## Browser features a frame lacks

The iframe is sandboxed `allow-scripts allow-same-origin`, without `allow-modals` or `allow-popups`:

- `window.confirm` and `alert` are suppressed, so `confirm()` returns false. Draw your own
  confirmation.
- `navigator.clipboard` refuses to write, because the frame's document isn't the focused one. Use
  `bridge.ui.copy`.
- A link can't navigate. Use `bridge.ui.openUrl(url)`, or `openLinkOnClick(bridge, event)` from the
  SDK as a delegated anchor handler.

`openUrl` accepts `https` only, the same policy as a manifest's `openUrl` verb
(`@acorn/protocol/externalUrl.ts`). The host honors it only while the frame holds focus and at most
once a second, so background code can't move the reader. The host then runs the shell's content-link
rules: in-app when a recognizer claims the URL, the owner's browser otherwise. A link in a reference
panel swaps that panel's subject, and one in a pane opens the pane.
