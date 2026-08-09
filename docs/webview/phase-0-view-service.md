# Phase 0 — Generic view service in main

**Size: M.** A refactor with no new capability: `previewService.ts` becomes a view service keyed
by an opaque surface key, and preview becomes its first caller. Nothing user-visible changes, and
that is the point — this is the phase that touches shipped behaviour, so it should be provable on
its own before any new surface exists.

## What exists today

`plugins/preview/src/main/previewService.ts` is a complete, careful view manager that happens to
be hard-coded to one concept: a task.

```ts
type PreviewRecord = { view: WebContentsView; owner: BrowserWindow; homeUrl: string }
const previews = new Map<string, PreviewRecord>()          // keyed by taskId
```

Everything else in the file is already generic in substance:

- `create(taskId, owner, homeUrl)` — builds a hardened `WebContentsView` (`contextIsolation`,
  no `nodeIntegration`, `sandbox: true`) on an **ephemeral per-task partition**
  (`acorn-preview-<taskId>`, no `persist:` prefix, so it dies with the process), attaches it to
  the owner window, wires navigation events.
- `onEnsure` / `onBounds` / `onShow` / `onHide` / `onLoad` / `onCommand` / `onEvict` — the IPC
  handlers, each of which resolves an `ownedRecord(e, key)` so a window can only drive views it
  owns.
- `trackOwner` — evicts a window's views when it closes.
- `emit` — pushes `{ url, loading, canGoBack, canGoForward }` back to the owner's renderer.
- `isAllowedPreviewUrl` guards `ensure`; `loadRules` and `tunnelHeaders` are injected rather than
  imported, because a plugin may not import an app.

Two things are genuinely preview-specific and must stay behind an injection seam:

- **Browser rules** (`loadRules`) — per-project page rules, a preview product feature.
- **Tunnel headers** (`tunnelHeaders`) — the credentials a preview needs to reach a remote node's
  dev server through the tunnel. This is preview's; a third-party webview must not get it.

And one is shared machinery that stays where it is: `bindBrowserContents` /
`unbindBrowserContents` register a view with the CDP driver. Phase 1 decides who may bind; phase 0
just stops assuming everyone does.

## Target shape

```ts
// main/webviewService.ts (moved out of plugins/preview, see "Where it lives")
export type ViewKey = string            // opaque; the caller decides its meaning

export type ViewOptions = {
  key: ViewKey
  owner: BrowserWindow
  homeUrl: string
  // Session isolation. One partition per key by default; callers that want views to share a
  // session pass the same partitionKey. Never `persist:`.
  partitionKey?: string
  // Extra request headers for URLs this function claims. Preview passes its tunnel headers;
  // a plugin surface passes nothing.
  headersFor?: (url: string) => Record<string, string> | null
  // Called after the view is created, so a caller can bind CDP. Preview passes
  // bindBrowserContents; nothing else does.
  onAttach?: (contents: WebContents) => void
  onDetach?: (contents: WebContents) => void
}
```

The map becomes `Map<ViewKey, ViewRecord>`, and every handler takes a key instead of a task id.
Preview's key becomes `preview:<taskId>`; phase 1's keys are `plugin:<pluginId>:<surfaceId>:<taskId?>`.
Prefixing matters: it is what stops a plugin surface and a preview colliding on the same string,
and it makes an orphaned view traceable to its owner in a debug dump.

### Where it lives

Move it to `apps/desktop/src/app/main/webviewService.ts`.

Preview's main half exists outside `apps/desktop` as an enumerated exception in
`tools/arch/boundaries.test.ts` ("the Electron surface stays where it is declared"), listing
`previewService.ts`, `browserService.ts` and the colocated test. A service that serves every
plugin is not a plugin's code; leaving it in `plugins/preview` would mean the shell's view
manager lives inside a feature package, and any plugin wanting a view would depend on preview.

So: `previewService.ts` splits. The generic manager moves to `apps/desktop`; what stays in
`plugins/preview/src/main` is the thin preview-specific caller — rules, tunnel headers, CDP
binding — plus `browserService.ts` and `browserAuto.ts` unchanged. The enumerated exception list
shrinks by one entry, which is the direction that test wants to move anyway.

### IPC

`preview:*` channels stay exactly as they are, for now, implemented by preview's caller on top of
the service. Renaming them is renderer churn with no benefit at this phase, and
`PreviewPane.tsx`'s bounds/show/hide/occlusion logic is the trickiest part of the existing
feature — leave it untouched while the thing underneath it moves.

Phase 1 adds its own channel for plugin surfaces rather than widening `preview:*`, so the two
never share an authorisation path.

## Steps

1. Create `apps/desktop/src/app/main/webviewService.ts` with the keyed manager: create, bounds,
   show/hide, load, command, evict, owner tracking, event emission. Port the existing logic
   verbatim — this is a move plus a rename of `taskId` → `key`, not a rewrite.
2. Keep the URL guard inside the service (`isAllowedPreviewUrl` moves or is imported); every
   caller goes through it. It must not be possible to create a view without validation.
3. Reduce `plugins/preview/src/main/previewService.ts` to: register the `preview:*` IPC, map
   `taskId` → `preview:<taskId>`, supply `headersFor` (tunnel), `onAttach`/`onDetach`
   (`bindBrowserContents`/`unbindBrowserContents`), and keep `loadRules`.
4. Update `registerPreviewIpc`'s composition in `apps/desktop/src/app/main/bootstrap.ts` and the
   `desktopCapabilities.ts` wiring — `driverFor(taskId)` is unchanged, since binding still happens
   on attach.
5. Update the enumerated Electron-surface list in `tools/arch/boundaries.test.ts`.

## Tests

`plugins/preview/src/main/previewService.test.ts` (252 lines, mocks the electron module) is the
safety net. The rule for this phase: **it should need no behavioural edits**, only the import
path and whatever the split forces. If an assertion has to change meaning, the port changed
something it should not have.

New coverage on the service itself:

- Two keys in one window get two views, with independent bounds and visibility.
- `ownedRecord` refuses a key belonging to another window (port the existing case).
- Closing a window evicts every view it owns, across keys.
- Partition isolation: two keys get two partitions, and neither is `persist:`-prefixed. This is
  the one that stops a future caller silently sharing a session.
- A caller with no `onAttach` produces a view the CDP driver does not know about — `driverFor`
  returns null for it. This is the invariant phase 1's whole security posture rests on, so it is
  worth asserting before phase 1 exists.

## Exit criteria

- Preview behaves identically: same pane, same rules, same tunnel, same six agent tools, same
  ephemeral partition per task.
- The generic service is in `apps/desktop`, keyed, with no preview concept in it.
- A view can be created without CDP binding, and is provably undrivable.
- Boundaries test's Electron exception list is one entry shorter.
