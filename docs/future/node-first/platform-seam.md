# The platform seam: one door to the desktop

From the node-first session (2026-08-15). **Shipped 2026-08-15.** `docs/future/remote.md` named
"everything that touches `window.acorn` goes behind one narrow interface" as the load-bearing
preparation for a web client, and claimed it was reflected in the shipped system. It was not: **the
seam existed as a TypeScript type, not as a boundary.** It is a boundary now. This file is kept as the
record of what was wrong and what the fix decided, not as work to do.

## What was there

- `client-core/src/capabilities.ts` typed the `window.acorn` global and exported a getter — and then
  fifteen modules reached the global directly, three of them bypassing even the getter
  (`lib/onClosePaneWithin.ts`, `plugins/preview/src/client/PreviewPane.tsx`,
  `plugins/terminal/src/client/terminalClient.ts`). Exactly one module applied the intended rule —
  `plugins/host.ts`, whose header states it. The rule was written; it was applied to one of fifteen.
- **No arch rule guarded it.** `boundaries.test.ts` banned static `electron` imports outside the
  desktop app and said nothing about `window.acorn`.
- The type leaked the wrong direction: `capabilities.ts` baked Electron-main concepts (trust decision
  shapes, per-device ack records) into the contract every client module saw.

## What shipped

1. **One platform module** — `packages/client-core/src/platform/index.ts`. A handful of narrow,
   capability-shaped, individually nullable groups: `nodeTransport`, `fleetBridge`, `pluginCustody`,
   `desktopExtras`, `recoveryActions`, `previewViews`, `pluginWebviews`, plus two plain probes
   (`canPickFolder`/`pickFolder`, `canPairNodes`). Grouped by capability, not one god object, so a web
   implementation says "no desktop extras" by omission instead of by stubbing. `acornGlobal()` is
   module-private; the Electron preload is the only implementation, and it was reshaped to match the
   groups so the accessors are projections rather than translations.

   Within a group the discriminator is one member and the rest degrade individually — the same
   additive-forever tolerance the wire contract runs on. A host one version behind loses the method it
   is missing, not the whole capability.

2. **A ratchet, same shape as the electron-import ban.** `boundaries.test.ts` § "the platform seam is
   the only door to the host" fails any non-test file outside `platform/` that reads `window.acorn`.
   Comments are stripped, tests are exempt permanently (a test that stubs the host is exercising the
   implementation), and the baseline is **empty** — every reach was mechanical and there were only
   fifteen, so there was nothing worth leaving to migrate later.

3. **The probe that lied is split.** `capabilities.terminal` meant "the preload exposes a native folder
   picker", and that gated the entire terminal drawer, agents, run targets and workflows — surfaces
   that are pure HTTP+WS. It now reads the **node's plugin roster** (`disabledNodePlugins()`), which is
   the question it was always pretending to ask, and the picker moved to the seam as `pickFolder()`.
   Consequences, all of them wanted:
   - `taskBridge()` and `terminalApi()` no longer return `null` — nothing about them was host-shaped —
     and roughly thirty dead `if (!api)` guards went with the null.
   - A desktop whose node has the terminal plugin disabled now correctly hides those surfaces. It did
     not before.
   - `/v2/core/tasks/:id/archive` is served through the node's `TASK_SESSIONS` bridge, which the
     terminal plugin fills, so the guarded-teardown-vs-plain-flip branch in `TabRail`/`TaskView` is now
     gated on the right thing rather than accidentally right.

## Recorded for the web client, not built

Two facts the survey pinned, carried in `remote.md`:

- **The WS bearer rides the upgrade header** (`nodeBroker.ts`, `wsHub.ts`) — a browser cannot set
  headers on a WebSocket. The node needs a second auth carrier (subprotocol/query token/cookie) when
  web happens. Additive; fits inside the version-skew rules.
- **`nodeFetch` buffers whole responses** because streaming cannot cross IPC. `NodeTransport` is a
  per-implementation type, so a web transport may stream; the desktop one keeps buffering.

The genuinely Electron-only surfaces — the browser-preview pane, plugin `webview` panes, the CDP-driven
agent browser tools — are `WebContentsView` machinery and stay desktop extras behind the seam. A web
client omits them; nothing else notices.

## Known leftover, deliberately not swept

`requires: 'desktop'` is still worn by several surfaces that are not desktop-specific (the notes pane,
the changes pane, the workflows settings page, the file palette) — the same class of mistake as the
terminal probe, one layer up. It is not dangerous the way the terminal probe was: `desktop` is an
honest question honestly answered, it is merely being asked about the wrong things. Fix each as it is
touched, by deleting the `requires` rather than by inventing a capability for it.

## Not proposed

- Not building the `WebBroker`, web pairing, web token custody, or node-served shell —
  `docs/future/remote.md` owns all of that, unscheduled.
- Not abstracting Electron main's internals. The seam is the *renderer's* view of the platform; main's
  files (broker, stores, schemes) are fine as they are.
