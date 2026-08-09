# Webviews for any plugin

This folder is the working documentation for turning acorn's browser preview from a
preview-plugin feature into a **capability any plugin can use**: a host-owned native web view that
a plugin can place in its own surface and point at a URL, without the plugin touching Electron.

Written for the agent or developer implementing it. Each phase has its own file with enough
context to execute without re-deriving the analysis.

## The shape of it, in one paragraph

Today exactly one plugin can show a web page: `plugins/preview`, because it has an Electron main
half that constructs a `WebContentsView` and hangs it in the window beside the renderer. Main
access is first-party-only and permanently so (below). This project extracts the *display* half
of that into a generic, host-owned view service, exposes it as a fifth frame target
(`webview`) plus four bridge verbs, and leaves preview as its first caller — keeping its main
half, its CDP driver, and its six agent tools exactly as they are.

Nothing is deleted. The generalisation does not require it, which is the single most important
thing to know before starting.

## Why preview needs main at all

Not incidental — the capability *is* a main-process capability. From
`plugins/preview/src/main/previewService.ts`:

```ts
const view = new WebContentsView({
  webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
})
owner.contentView.addChildView(view)     // sibling of the shell, not inside it
…
record.view.setBounds({ x, y, width, height })   // renderer reports the rect; main positions the view
```

Only main can construct a `WebContentsView` or attach one to a `BrowserWindow`. Three reasons it
is a native view and not an iframe in the renderer:

1. **The shell's CSP forbids remote origins.** The renderer is locked to `app://acorn`; a preview
   of `localhost:3000`, let alone a real site, cannot load inside it. Relaxing that CSP would undo
   the containment the whole plugin sandbox rests on.
2. **Sites refuse to be framed.** `X-Frame-Options` and `frame-ancestors` — plenty of dev servers
   and essentially every real site. A preview that fails on half the web is not a preview.
3. **The automation needs CDP.** `browserService.ts` builds accessibility trees, resolves refs and
   runs fill scripts; that is `webContents.debugger`, which exists only on a main-side
   `WebContents`.

## Why loaded plugins still cannot have a main half

The objection is not "privileged code" — a loaded plugin's node half is already unsandboxed
(docs/security.md is blunt about it). Main is different in three specific ways:

- **Main owns the trust machinery itself.** The plugin cache, the trust store, device tokens,
  `safeStorage`, `ipcMain`, and the `app-plugin://` handler all live there. Third-party code in
  main would not be a wider sandbox; it would be a bypass of the process that *decides* what the
  sandbox is — it could mark its own bundle accepted or read the device bearer.
- **There is no route to containment, even in principle.** The node half has one written down:
  rung 2 puts it in a child process under Node's permission model with `ctx` over RPC. Main
  cannot take that route, because being the process is what main is.
- **Wrong artifact, wrong cadence.** Main code ships in the desktop binary; a loaded main half
  would mean a Node pushing code into the app's own process.

So the answer is not "let plugins into main". It is "let the host own the view and hand plugins a
narrow, typed way to use it" — the same answer the sandbox already gives for diffs and inline
renderers: a host-rendered surface driven by plugin-supplied data.

## What third-party plugins get, and what they do not

**Get:** a `webview` surface in the manifest, and four bridge verbs — `navigate`, `back`,
`forward`, `reload` — plus a `did-navigate` event. Host-owned view, host-enforced URL allowlist,
host-owned bounds and visibility.

**Do not get, permanently:** the CDP driver. Reading a page's accessibility tree and typing into
it, on a view that may be showing a logged-in session, is a credential-adjacent capability, not a
display one. It stays with `plugins/preview`, which is first-party, reviewed, and ships its six
tools (`navigate`, `snapshot`, `click`, `fill`, `screenshot`, `console`) to agents through MCP.
If a third-party plugin ever needs driving, the escalation path is first-party adoption — the same
rule as inline renderers (docs/plugins.md § Two tiers).

That split is what makes this safe to generalise: display is bounded and observable, driving is
not.

## Status

Implemented. The phase files remain the contract and rationale for the shipped design.

| Phase | File | Status |
| --- | --- | --- |
| 0 — Generic view service in main | [phase-0-view-service.md](./phase-0-view-service.md) | complete |
| 1 — The `webview` surface and its verbs | [phase-1-surface-and-verbs.md](./phase-1-surface-and-verbs.md) | complete |
| 2 — Trust, allowlists, and what the owner is told | [phase-2-trust.md](./phase-2-trust.md) | complete |

Ordering is strict: 1 requires 0, 2 requires 1. Phase 0 stands alone as a refactor with no new
capability — it is worth landing on its own even if 1 and 2 are deferred, because it is the part
that touches existing shipped behaviour and it should be provable in isolation.

## Invariants

- **Preview keeps everything it has.** Its main half, its CDP driver, its agent tools, its
  ephemeral per-task session partition. It becomes the first caller of the new service, not a
  casualty of it. If a step in these phases requires deleting preview functionality, the step is
  wrong.
- **No plugin code runs in main, ever.** Plugins name a URL and receive events. Every Electron
  object stays behind the service.
- **A URL from a plugin is a request, not an instruction.** The host validates it against
  `isAllowedPreviewUrl` and against the plugin's own declared host list before loading.
- **Ephemeral, isolated sessions stay mandatory.** Every view gets a non-`persist:` partition, as
  preview already does — one plugin's view must never read another's cookies, and nothing a view
  stores may outlive the process.
- **The occlusion contract is unchanged.** A native view always paints above the window's web
  content, so overlays cannot sit above it by z-index; the renderer detects coverage and calls
  hide. Whatever the service becomes, that stays the renderer's job.

## Reference

- `plugins/preview/src/main/previewService.ts` — the view lifecycle being generalised. Read it
  first; phase 0 is mostly a widening of this file.
- `plugins/preview/src/main/browserService.ts`, `browserAuto.ts` — the CDP driver that stays
  first-party.
- `plugins/preview/src/client/PreviewPane.tsx` — the renderer half: bounds reporting, show/hide,
  and the overlay-occlusion handling.
- `apps/desktop/src/app/main/preload.ts` § `preview` — the current IPC surface.
- `docs/plugins.md` — the frame targets this adds a fifth to.
- `docs/first-party-plugins.md` — why preview is first-party (reason C) and stays that way.
- `docs/panes.md`, `docs/security.md` § Execution boundaries.
