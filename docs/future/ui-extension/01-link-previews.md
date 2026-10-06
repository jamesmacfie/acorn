# Phase 01: add URL and reference previews

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
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
