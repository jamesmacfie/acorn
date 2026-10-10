# Phase 01: add URL and reference previews

Status: done, October 10, 2026. Branch `phase-01-link-previews`, from `cefa1d171`.

## Completion note

All three content paths reach one host controller. Markdown, provider HTML, and kit `Link` nodes in
remote trees all open the same preview. Both hosts have an explicit **Preview** action. Core fetches
nothing, the navigation rules are unchanged, and no new trust or network grant exists.

### What landed

- **Protocol.** `CORE_LINK_PREVIEW_POINT`, `LinkPreviewProps`, `MAX_LINK_PREVIEW_URL`, and
  `linkPreviewKey` sit beside `EDITOR_DOCUMENT_POINT` in `packages/protocol/src/chrome/extensionPoints.ts`.
  `linkPreviewKey` parses with `URL`, refuses anything but HTTPS, refuses credentials, and caps the
  result at 4,096 characters.
- **Controller.** `packages/client-core/src/host/linkPreview/linkPreview.ts` is JSX-free and imported
  by both hosts. It registers the point (`core`, `remote`, `replace`, `max: 1`) and holds the one open
  preview, the 350 ms dwell, and the 150 ms grace. `createLinkPreviewBoundary(scope)` returns handlers
  that a content owner spreads on an element it already draws. `TaskPaneHost` spreads them on each
  `.task-slot` with the pane's task, and the desktop's `.app` region spreads them with the route's
  project. The innermost boundary claims an event, so the nearest owner supplies the scope.
- **Desktop host.** `LinkPreviewHost.tsx`, mounted beside `RefPanelHost` in `App.tsx`, draws a
  `.ui-popover` capped at 420 by 360 px. It shows **From** with the contributor's plugin, plus
  **Open**. Right-click or Shift+F10 on a link opens **Preview**, **Open link**, and **Copy link**.
  **Preview** from that menu focuses the preview, and closing it returns focus to the link. Option +
  right-click keeps the platform menu.
- **Terminal host.** The kit `Link` reads a `LinkMenuContext` that `PaneBody` provides. Pressing an
  HTTPS link in a pane opens the action picker with **Preview** and **Show address**. **Preview** opens
  `LinkPreviewDialog`, an overlay with the same slot and **Open**. **Open** goes through
  `resolveTerminalLink`, and an unclaimed URL is shown in a toast.
- **Failed occupants fall back.** Both `Slot`s draw the owner's default when the `replace` occupant's
  tree fails, and they remember the failure for the life of that slot. `RemoteTree` in both hosts gains
  `onFailed`, and the terminal `TreeHost` reports failures. This closes phase 00's open issue for
  every `replace` point, `agents:tool-card` included.
- **Discovery.** The point appears on **Settings > Advanced > Extension points** through the shared
  registry. The `plugin_authoring` brief names its key, props, and host support.
  [Remote points](../../plugins/remote-points.md#link-previews) has a table row and a section.

### Decisions and deviations

- **Focus opens nothing.** Only the pointer opens a preview on hover. Tabbing through a reply would
  otherwise open a preview at every link. Focus returning to a link after its preview closed would
  also reopen it. The keyboard asks through the link menu.
- **The link menu is host-only.** No `contextMenus.ts` location was added, because phase 00 finalized
  that vocabulary and listed no link location. Plugins can't add items to it.
- **No shared-kit callback.** The desktop catches links by event delegation, so the shared kit
  `Link` and `Markdown` are unchanged. Only the terminal's kit `Link` reads a context. The context
  lives in `apps/tui/src/kit/paneContext.ts`, beside `PaneIdContext`, and imports no registry.
- **Pointer transfer keeps the worker.** A new URL in the same scope is a props update on the same
  `RemoteTree`. A new task or project remounts it, because `RemoteTree` binds its scope at mount.
- **`ref` comes from `claimFor`.** It is `{ kind, id }` when an in-app recognizer claimed the URL,
  with `kind` capped at 64 characters and `id` at 300.
- **Anchor removal** is watched by a `MutationObserver` on `document.body`, only while a preview is
  open. A link in the streaming trailing block of an agent message is rebuilt on every chunk, so its
  preview closes while that block streams. Earlier blocks keep their elements.
- `tools/arch/boundaries.test.ts` raises client-core's entrypoint ceiling from 177 to 179, for
  `linkPreview.ts` and `LinkPreviewHost.tsx`. The terminal can't load the `.tsx`, so the two can't
  share one barrel.

### Verification

Run with Node 26.8.1.

- `LinkPreviewHost.test.tsx`, 11 tests. It covers the dwell and grace, all three content paths,
  no tree for a link nobody hovered, worker retention, pointer transfer into the preview, a tie and
  the person's pick, tree failure, plugin disable, Escape, outside press, task change, node change,
  anchor removal, the keyboard menu with focus in and back, and Option + right-click. Removing the
  failure fallback or keying the surface on the URL fails two of them.
- `apps/tui/src/linkPreview.test.tsx` covers the fallback, a compiled contributor, and Escape on the
  real shell. `agentsWeb.test.tsx` presses a web card's link, picks **Preview**, and checks the
  dialog. A `kit.test.tsx` case covers the link menu.
- `pnpm test` for `@acorn/protocol`, `@acorn/plugin-api`, `acorn-plugin-sdk`, and `@acorn/node-core`:
  all pass. `@acorn/client-core`: 2,641 of 2,642. The one failure,
  `sdk.test.ts > marks a span that threw`, passed three runs alone, so it's load-sensitive and
  unrelated. `@acorn/tui`: the two known `chrome.test.tsx` task-marker failures only.
- `pnpm --filter @acorn/arch-tests test`: only the known `docPaths` failure, 15 links.
- `pnpm lint`: oxlint is clean. Type checks fail only in the agents, changes, and git plugins, which
  are the known reds.
- **Desktop, `pnpm dev:agent`.** A scratch loaded plugin, built with `build:plugin` into `/tmp` and
  installed through `/v1/core/plugins/install`, declared `matches` for `https://docs.example.com/*`.
  Its Node half answered a title and summary after 600 ms, and refused other hosts. I used a Notes
  pane note with three links in **Preview**. The preview opened after the dwell and showed
  "Loading", then the plugin's title and summary with **From Link preview example**. Moving to the
  second docs link kept the worker and showed the new URL's answer. The third link, on an unmatched
  site, showed the owner fallback. The surface measured 420 px wide. Escape, outside press, the
  Shift+F10 menu, focus in and back, and right-click all behaved. The first run found that
  `.ui-popover`'s `max-width` overrode the cap. The fix is a `.ui-popover.link-preview` selector.
- **Terminal, `pnpm dev:tui:agent`.** The trust prompt listed the contributor and accepted it. Neither
  seeded fixture contains a web tool card, which is the one pane that draws an addressed `Link`.
  Creating one needs a live agent turn, so the drawn dialog is covered by the full-shell tests above.
- **Native-child overlap:** not checked. The desktop driver can't see child webviews. The preview is a
  `.ui-popover`, so `nativePages.ts` lists it like any other popover.

### What later phases need to know

- A `replace` point gets the owner fallback on tree failure for free. Phases 02, 03, and 10 don't
  need to add it.
- `Slot`'s `occupied` callback also reports the standing contributor's `pluginId`, for an owner that
  shows provenance.
- To opt a region into link previews, call `createLinkPreviewBoundary` in its owner and spread the
  handlers on an element it draws. Overlays and reference panels have no boundary yet.
- In the terminal, closing a dialog leaves the keys on the task rail rather than on the link that
  opened it. The action picker does the same. `requestRenderableFocus` didn't help, because the
  transcript redraws the link while the overlay covers it.
- For a point registered in code, the trust prompt quotes the contributor's own label, as in "Draw
  its own UI inside core's “Documentation”", because the Node can't see the point's label. Agent-cost
  shows the same thing.
- `build:plugin` runs `pnpm install`, so a scratch plugin under `plugins/` gets added to
  `pnpm-lock.yaml`. Restore the lockfile after a real-host check.
- The tie picker on the Extension points page still ignores `matches`, as phase 00 recorded. With
  many `core:link-preview` contributors it will offer picks for sites that don't overlap.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 00's confirmed Editor baseline and registry contracts.

Add a bounded preview when a person hovers a supported HTTPS link or deliberately requests its
preview by keyboard. Keep navigation and preview separate host actions.

## Starting point and scope

`packages/client-core/src/kit/components/content/Link.tsx` draws safe links and preserves modified
clicks. `packages/client-core/src/kit/components/content/Markdown.tsx` draws sanitized anchors.
`packages/client-core/src/host/components/ProviderHtml.tsx` draws provider HTML and reference links.
`packages/client-core/src/host/registries/panes/contentLinks.ts` resolves content destinations.
`packages/client-core/src/kit/components/overlays/Popover.tsx` supplies host portal presentation.
`packages/client-core/src/infra/platform/nativePages.ts` handles overlap with native pages.

Read [remote points](../../plugins/remote-points.md), [native overlays](../../testing/native-overlays.md),
and [the bridge](../../plugin-authoring/the-bridge.md). Keep registries out of kit imports.

## Contract

Core owns `core:link-preview`, a `remote`, `replace`, single-occupant point keyed by the normalized
HTTPS URL. Normalize with `URL`, preserving path case, query, and fragment. Accept at most 4,096
characters. Do not turn tracking removal, canonical redirects, or credential handling into normalization.
URLs containing credentials do not open previews. Matching declarations retain their 128-character cap.

Props are `{ url, label?, taskId?, projectId?, ref? }`. `ref`, when the host has already resolved it,
is bounded `{ kind, id }`, not arbitrary provider HTML. Scope comes from the owning content mount.
With no resolving contributor, show an owner fallback containing the label, URL, and Open action.
Do not fetch network metadata for the fallback or install a wildcard default contributor.

Example contributor declaration:

```json
{ "id": "docs-preview", "point": "core:link-preview", "label": "Documentation",
  "matches": ["https://docs.example.com/*"], "remote": "docsPreview" }
```

The plugin reads its own Node route with the URL. Its Node half validates allowed hosts, redirects,
response size, timeout, and network permissions. Arbitrary external iframe previews are out of scope.

## Steps

1. Add the typed point and its core registration using `core:storage` as the owner-registration pattern.
   Expose its props, matching key, and host support through discovery and `plugin_authoring`.
2. Add a host-owned link preview controller and content boundary. Delegate pointer/focus handling
   within the owner boundary so Markdown and ProviderHtml need no per-anchor listener. Remote Link
   nodes participate through host rendering. No pointer events cross to a worker.
3. Use a 350 ms hover dwell, a 150 ms leave grace, and one open preview per client. Entering the
   popover cancels closure. Scope changes, anchor removal, Escape, and outside clicks dispose it.
4. Build on the anchored popover and native overlay rules. Cap width at 420 px and height at 360 px,
   clamp to the viewport, allow scrolling inside, and show contributor provenance. Hover does not
   steal focus. An explicit Preview link menu action focuses the preview and returns focus on close.
5. Provide the same explicit Preview action from host link menus in the terminal. Use a host dialog
   capped to the available rows. Terminal has no automatic hover or frame support.
6. Add a loaded test contributor that returns a title and summary from its own route. Verify updates
   retain the worker, obsolete reads abort, and late results cannot change another link's preview.

## Tests and acceptance

Use `Slot.test.tsx`, `ProviderHtml.test.tsx`, `Popover.test.tsx`, and `nativePages.test.tsx` as patterns.
Cover two matching contributors, user picks, owner fallback, plugin disable/reload, Node changes,
rapid anchor changes, pointer transfer, keyboard dismissal, nested menus, and modifier navigation.
Ensure an invisible transcript link starts no worker or request. Preserve Markdown selection/streaming.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/client-core`, `@acorn/plugin-api`,
`acorn-plugin-sdk`, and `@acorn/tui`, plus `pnpm --filter @acorn/arch-tests test`; expect exit zero.
Run a desktop and terminal session with the example and confirm fallback, preview, and Open.
Record the native-child overlap check separately because the desktop driver cannot inspect child views.

Complete when all three content paths reach the same host controller, both hosts expose an explicit
preview action, and no navigation, trust, or network boundary has widened.

## Verify before building

- Confirm the shared kit can supply a presentation-only link menu callback without registry imports.
- Recheck anchor and native overlay behavior before adding private adapters.
- Stop if a design requires raw worker pointer events, another plugin's route, or external nested frames.
