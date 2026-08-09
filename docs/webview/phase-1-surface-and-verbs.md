# Phase 1 — The `webview` surface and its verbs

**Size: M.** Requires [phase 0](./phase-0-view-service.md). After this phase a third-party plugin
can declare a webview surface in its manifest, have it rendered in a pane, and navigate it from
its own frame — without any Electron object crossing into plugin code.

## The manifest

A fifth `target` alongside `pane | refPanel | settings | importer`
(`packages/node-core/src/main/pluginManifest.ts`):

```jsonc
"contributions": {
  "frames": [{
    "target": "webview",
    "id": "docs",
    "label": "Docs",
    "glyph": "book-open",
    "order": 70,
    // Where it starts. Either a literal https URL, or a route in the plugin's own namespace that
    // returns one — the second is what a plugin needs when the URL depends on the task or on its
    // own settings.
    "url": "https://docs.example.com/",
    "urlSource": "/v2/p/docs/webview-url",       // GET → { url: string }; mutually exclusive with `url`
    // REQUIRED. Every host this surface may ever load. The host refuses navigation outside it,
    // and the trust prompt names them.
    "hosts": ["docs.example.com", "*.example.com"]
  }]
}
```

Validation at parse time, in the existing `superRefine`:

- exactly one of `url` / `urlSource`; `urlSource` confined to `/v2/p/<id>/` like every other
  descriptor route.
- `url`, if literal, must be `https://` and its host must appear in `hosts`.
- `hosts` non-empty, each entry a literal host with at most one leading `*.`, bounded in length
  and count. Same grammar as the shipped content-link pattern host part
  (`packages/node-core/src/main/pluginManifest.ts`) — reuse that compiler rather than writing a
  second one.
- `http://` is refused, with one exception decided below.

**Localhost.** A plugin previewing a local dev server needs `http://localhost:3000`. The install
route already sets the precedent for a narrow loopback carve-out
(`docs/plugins.md` § As built: `http://` accepted when the host is
`localhost`, `127.0.0.1` or `::1`, re-checked after redirects). Take the same rule here, and
re-check after redirect for the same reason — a `http://localhost` that 302s to a remote host must
not keep loading.

## Rendering

The frame adapter (`packages/client-core/src/plugins/frames/register.tsx`) gains a `webview` case,
registering an ordinary pane contribution whose component is a new `PluginWebview` rather than
`PluginFrame`. Everything around it is unchanged: the trust gate, the host-bound ids, disposal,
the per-node binding.

`PluginWebview` is a near-copy of `PreviewPane.tsx` minus the preview product features:

- reports its rect to main on resize/scroll, calls show on mount and hide on unmount,
- handles the overlay-occlusion case the same way (a native view paints above web content; the
  renderer detects coverage and hides),
- renders chrome — a URL label, back/forward/reload — from the state events main emits,
- shows a placeholder when the view has no URL yet or the surface is not visible.

Do not try to share one component between preview and plugins in this phase. Preview's pane
carries rules, tunnel awareness and devtools; the shared part is the bounds/occlusion dance, which
is ~40 lines and worth duplicating until a third caller shows what the real abstraction is.

## The bridge verbs

Four verbs plus one event, on the existing port
(`packages/client-core/src/plugins/frames/broker.ts` — the `ui` verb family is the model):

```ts
{ id, kind: 'webview', op: 'navigate', url: string }
{ id, kind: 'webview', op: 'back' | 'forward' | 'reload' }
// host → frame
{ kind: 'event', channel: 'webview:navigated', payload: { url, canGoBack, canGoForward, loading } }
```

Enforcement, all host-side and all from values the host read off the manifest:

- **The surface is implied, never named.** A frame's binding already carries its
  `(pluginId, surface)`; a `webview` op addresses *its own* surface and cannot name another.
  A plugin with two webview surfaces drives each from its own frame.
- **`navigate` is checked against `hosts`** before it reaches the service, and the service checks
  the scheme again. Two checks, because the manifest arrives at the device as a roster row and a
  roster row is bytes a node sent — the same argument that makes descriptors re-confine their
  routes on the device (`docs/plugins.md` § As built).
- **Redirects are the real enforcement point.** A host allowlist that only checks the URL the
  plugin asked for is theatre: any allowed page can 302 anywhere. Enforce in main on
  `will-redirect` / `will-navigate` — a navigation to a host outside the list is cancelled and
  reported as a `webview:blocked` event. Get this right or the allowlist means nothing.
- **Rate-limit** with the existing bridge budget; navigation is cheap to spam.

## What is deliberately absent

- **No CDP.** A plugin webview is created with no `onAttach`, so the driver never binds and
  `driverFor` returns null for it (phase 0 asserts exactly this). No snapshot, no click, no fill,
  no console, no screenshot. Permanently — see the README for why display and driving are
  different grants.
- **No devtools.** Preview's `command: 'devtools'` is not in the plugin verb set.
- **No tunnel headers.** A plugin webview passes no `headersFor`, so it cannot reach a remote
  node's dev server through preview's tunnel. That credential is preview's.
- **No cookie or storage access**, by construction: every surface gets its own ephemeral
  partition, keyed by `plugin:<pluginId>:<surfaceId>`. Two plugins never share a session, and a
  plugin's view never sees the app's.
- **No `postMessage` into the page**, and no script injection. The plugin does not talk to the
  content; it points at it.

## Steps

1. Manifest: `webview` target, `url`/`urlSource`/`hosts`, cross-field validation, shared host
   grammar.
2. Protocol: the webview verb and event shapes in `pluginBridge.ts`.
3. Main: a plugin-surface IPC channel (its own, not `preview:*`), authorising the key against the
   window and refusing keys not shaped `plugin:*`.
4. Broker: the `webview` verb family, host-checked against the binding's manifest entry.
5. `PluginWebview` + the `webview` case in the frame adapter.
6. Redirect enforcement in the service, with the blocked event.
7. Docs: the manifest reference in `docs/plugins.md`, the frame-target list in
   `docs/plugins.md`, and a line in `docs/panes.md`.

## Tests

- Manifest: both URL forms, mutual exclusion, host grammar, an `https` literal whose host is not
  in `hosts` refused, `http://` refused except loopback.
- Broker: `navigate` to an allowed host forwards; to a disallowed host is denied and **never
  reaches the service** (spy at the service boundary, the way the API-deny test does); an op
  naming another surface is impossible by construction — assert the binding is the only source.
- Service: a redirect to a host outside the list is cancelled and emits `webview:blocked`. Drive
  it with a real redirect in an e2e rather than a unit mock; this is the assertion most likely to
  be wrong in a way a mock cannot show.
- Isolation: two plugin webviews get two partitions; neither is the app session; a cookie set in
  one is absent in the other.
- No driver: `driverFor` is null for a plugin surface key, and preview's tools refuse it.
- e2e: a fixture plugin declares a webview, it renders, navigates within its hosts, is blocked
  outside them, and disappears when the plugin is disabled.

## Exit criteria

- A third-party plugin renders a live web page in its own pane and navigates it, with no Electron
  object and no CDP reachable from plugin code.
- Host allowlist holds across redirects.
- Preview is untouched and still drives its own views.
