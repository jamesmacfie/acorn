# The platform seam: one door to the desktop

From the node-first session (2026-08-15). Nothing here is scheduled. `docs/future/remote.md`
names "everything that touches `window.acorn` goes behind one narrow interface" as the
load-bearing preparation for a web client, and until now claimed it was reflected in the shipped
system. The survey says otherwise: **the seam exists as a TypeScript type, not as a boundary.**

## What exists today

- `client-core/src/capabilities.ts` types the `window.acorn` global and exports a getter —
  and then **44 call sites across 14 modules reach into the global directly**, including two raw
  `window.acorn` touches that bypass even the getter (`lib/onClosePaneWithin.ts:10`,
  `plugins/preview/src/client/PreviewPane.tsx:9`). Exactly one module applies the intended rule —
  `plugins/host.ts`, whose header states it ("sprinkling `window.acorn.*` through client code
  would make the storage the contract by accident"). The rule was written; it was applied to one
  of fifteen modules.
- **No arch rule guards it.** `tools/arch/boundaries.test.ts` bans static `electron` imports
  outside the desktop app and says nothing about `window.acorn`.
- The type itself leaks the wrong direction: `capabilities.ts` bakes Electron-main concepts (trust
  decision shapes, per-device ack records) into the contract every client module sees, and
  `@acorn/plugin-api/client` re-exports it to every plugin.

This is drift, not damage — every reach is mechanical to fix. The point of fixing it *now* is
that the count only grows, and the web client's first task otherwise becomes archaeology.

## The fix

1. **One platform module.** `client-core/src/platform/` (or fold into the existing
   `plugins/host.ts` pattern): a handful of narrow, capability-shaped interfaces — node transport
   (fetch/abort/send/frames/status), fleet actions, plugin custody (cache/trust), desktop extras
   (folder picker, webview, will-quit) — with the Electron preload as the only implementation.
   Grouped by capability, not one god object, so a web implementation can say "no desktop extras"
   by omission instead of by stubbing.
2. **A ratchet, same shape as the electron-import ban.** `window.acorn` and `acornGlobal()` are
   legal only inside the platform module; everything else is a baseline that may only shrink.
   Migrate call sites as they are touched — the rule the testkit deep-import baseline already
   uses.
3. **Fix the one probe that lies.** `taskBridge()` returns null when the native folder picker is
   absent (`tasks/taskBridge.ts:50`), and that null gates the **entire terminal drawer, agents,
   run targets, and workflows** through `capabilities.terminal` — surfaces that are pure HTTP+WS
   today. Split "can this platform pick a folder" (a desktop extra) from "does this node run
   terminals" (always true). This is the highest-leverage single fix in the review: it unhides
   the largest block of already-portable product surface, and it fixes a real wrong-shaped check
   on desktop today.

## Recorded for the web client, not built now

Two facts the survey pinned that `remote.md` should carry (noted there):

- **The WS bearer rides the upgrade header** (`nodeBroker.ts:208-211`, `wsHub.ts:138`) — a
  browser cannot set headers on a WebSocket. The node needs a second auth carrier
  (subprotocol/query token/cookie) when web happens. Additive; fits inside the version-skew
  rules.
- **`nodeFetch` buffers whole responses** (`apiClient.ts:34-35` says why: streaming cannot cross
  IPC). The platform interface should type the transport so a web implementation can stream —
  the desktop one keeps buffering.

The genuinely Electron-only surfaces — the browser-preview pane, plugin `webview` panes, the
CDP-driven agent browser tools — are `WebContentsView` machinery and stay desktop extras behind
the seam. A web client omits them; nothing else should notice (that is what the capability
grouping is for).

## Not proposed

- Not building the `WebBroker`, web pairing, web token custody, or node-served shell now —
  `docs/future/remote.md` owns all of that, unscheduled.
- Not abstracting Electron main's internals. The seam is the *renderer's* view of the platform;
  main's files (broker, stores, schemes) are fine as they are.

## Verify before building

Recount the direct reaches (44 at review time) and check whether a platform module appeared;
whether `boundaries.test.ts` grew a `window.acorn` rule; and whether `taskBridge`'s folder-picker
probe still gates `capabilities.terminal`.
