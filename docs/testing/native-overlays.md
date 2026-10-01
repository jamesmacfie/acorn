# Native overlay verification

[Native overlays](../native-overlays.md) owns the implementation contract. This checklist preserves
the acceptance requirements from the deleted proposal. Automated checks cover geometry, authority,
lifetime, fallback, and kit semantics. They do not prove native pixels, event dispatch, or VoiceOver.

## Graphical procedure

Start `pnpm dev:agent -- --session native-overlays` on a graphical macOS host. Configure a local
preview with an animated page, a click counter, an editable draft, and scrollable content. Use the
main-renderer driver after each transition:

```sh
pnpm dev:agent:ui -- --session native-overlays snapshot
pnpm dev:agent:ui -- --session native-overlays click <ref>
pnpm dev:agent:ui -- --session native-overlays screenshot main.png
pnpm dev:agent:ui -- --session native-overlays stop
```

The driver screenshot captures only the main WKWebView. Use native computer-use or manual capture
for composited page pixels and native page input. A DOM snapshot is insufficient evidence for those
checks. Repeat with `ACORN_NATIVE_OVERLAYS=0` for the fallback and performance baseline.

## Acceptance checks

| ID | Scenario and required result |
| --- | --- |
| A1 | Inbox overlaps only the page's upper edge: all rows draw and act once; page animation continues. |
| A2 | Passive tooltip overlaps the page: visible tooltip, unchanged focus, pointer pass-through. |
| A3 | Modal backdrop draws above a visible page: background mouse, keyboard, and accessibility navigation are blocked. |
| A4 | Nested picker/menu: correct stacking, one selection action, Escape closes the top interaction first. |
| A5 | Outside press on a native page: dismissal follows the kit contract; original press is delivered once; modal presses stay blocked. |
| A6 | Overlay field: typing, selection, clipboard shortcuts, and input method composition retain text and shortcut precedence. |
| A7 | Resize, pane movement, ancestor scroll, and monitor scale changes: visual and input bounds stay aligned. |
| A8 | Navigation, DevTools, and page creation while an overlay is open: page cannot rise above host UI. |
| A9 | Task/Node switch, plugin unload, or owner disposal during updates: no obsolete regions, actions, or overlays reach a replacement owner. |
| A10 | Close after editing and scrolling the page: history, scroll, draft, storage, and appropriate focus survive. |
| A11 | Theme, style pack, zoom, and font changes: same appearance as the main renderer and aligned geometry. |
| A12 | Disabled/failed layer: overlap fallback keeps host controls usable and restores the same page without stale regions. |
| A13 | Preview/plugin page invokes overlay commands: shell rejects authority; exact main label remains the only caller. |
| A14 | Cycles, reload, close: no accumulated native wrappers, listeners, or orphaned views. |
| A15 | Loaded remote-tree overlay and plugin page in a host dialog: contribution identity, actions, containment, and ordering survive without another runtime. |
| A16 | Palette, toast, custom confirmation, drawer: entire inventory preserves kit relative stacking and interaction policy. |

Also verify border radii, shadows, backdrop translucency, nested portal focus order, and VoiceOver
names and announcements without duplicate interactive copies. Check focus restoration when the
opener has been disposed. Run the scenarios on every platform enabled for native composition.

## Performance and resource gate

Record hardware, OS, backing scale, viewport, renderer configuration, and layer-enabled/disabled
results. After content and assets are ready, measure 50 opens: target p95 trigger-to-visible latency
is at most 100 ms. Exclude intentional tooltip hover delay and report it separately. Measure
repositioning and closing too. Confirm no extra business-data requests.

After 100 open/close cycles, page view count stays constant and wrapper count stays at one per
window after initialization. With no DOM page owners, observers, event subscriptions, scheduled
frames, and input regions return to zero. Window close releases the native wrapper. Compare both
preview and loaded-plugin fixtures, including unload and renderer reload during pending updates.

## Implementation verification record

The 2026-10-01 worktree run built the macOS shell and opened a live local preview in the real Tauri
window. The main driver remained connected after native child creation and opened the inbox. The
local fixture continued sending activity ticks. A native capture exposed a blank renderer caused
by the wrapper lacking a Core Animation layer; a subsequent capture showed the original renderer
after enabling layer backing. These observations do not close A1–A16.

Native computer-use calls repeatedly stalled, including an interrupted app-selection call. No
composited inbox/page capture or reliable native input sequence completed. Native pixel acceptance,
page click counts, VoiceOver, clipboard/IME, loaded-plugin interaction, minimum-OS behavior,
multi-monitor scaling, 50-open latency, and 100-cycle native resource measurements remain unverified.
Windows and Linux native composition are explicitly deferred and use the overlap fallback.

| Automated verification | Result |
| --- | --- |
| Workspace lint | 37 packages passed; final affected-package type checks passed. |
| Client platform and kit checks | 78 tests passed; final listener-lifetime checks passed. |
| Preview | 11 tests passed. |
| Architecture and documentation paths | 74 tests passed with one worker after parallel deadline failures. |
| Desktop renderer build | Passed. |
| Rust shell | 58 tests passed; agent-automation configuration also passed cargo check. |
| Desktop Vitest | 136 of 137 passed. Node-start timing remained over its bound in an isolated rerun. |

The desktop command completed staging and building, then failed its Node-start performance check.
The final isolated boot run measured 3,497 ms against a 1,500 ms bound. That test starts the staged
helper and Node service without the Rust shell or renderer; this feature changes neither boot source.
The threshold remains unchanged. The desktop suite is not fully green, despite an earlier full run
passing. Development commands reported Node v24.11.0 below the declared engine floor; the staged
boot fixture used the pinned Node v24.21.0.

Run these automated checks before handoff:

```sh
pnpm lint
pnpm --filter @acorn/client-core exec vitest run src/infra/platform src/kit/components/overlays src/kit/keys src/kit/lib/controls
pnpm --filter @acorn/plugin-preview test
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop test
```

The client tests cover partial/passive overlap, cutout unions, portal restoration, late owner
completion, fallback region release, modal DOM isolation, and nested Escape. Rust tests cover
bounded geometry, input policy, exact main authority, renderer epochs, and stale generations.
Keep graphical checks open until actual native evidence is recorded; passing these tests is not
native acceptance.
