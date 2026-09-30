# Native overlay layer for the desktop

Status: product requirements proposal, 2026-10-01. Not implemented. Native composition and input
routing require a prototype before the production architecture is selected.

## Product outcome

Acorn's popovers, tooltips, menus, and modals appear above browser previews and host-owned plugin
webviews. The page remains visible and live behind the overlay. Opening an overlay does not reload,
resize, blank, or replace the page with an image.

This document is a developer handoff. It defines the required experience, architectural boundaries,
delivery gates, and acceptance checks. Implementation starts with a native feasibility prototype;
the specific native composition strategy remains a prototype decision.

## Problem and evidence

The desktop shell places a native child webview over the main SolidJS renderer. Acorn's overlays
are HTML inside the main renderer, so their CSS stacking order cannot put them above that child.
The reported example is the notification popover extending into the preview and being covered at
the preview's upper edge.

`plugins/preview/src/client/PreviewPane.tsx` samples the centre of the preview with
`document.elementFromPoint` every 200 ms. If another element occupies that point, it hides the
native preview. Partial overlap away from the centre escapes detection. Tooltip surfaces use
`pointer-events: none`, so this hit test also misses them. A modal backdrop can trigger suppression,
but the resulting hidden preview does not meet the desired experience.

`packages/client-core/src/host/frames/PluginWebview.tsx` repeats this suppression logic. The feature
must therefore address all host-owned page webviews through shared infrastructure.

The implemented ownership and security rules are in [Shell](../shell.md#host-owned-webviews),
[Frontend](../frontend.md), and [UI design](../ui-design.md#chrome-and-overlays). This proposal does
not replace those contracts until implementation ships.

## Users and scenarios

- A developer opens the notification inbox while inspecting a running application. Every inbox
  row remains visible and clickable where the popover crosses the preview.
- A developer hovers or focuses a pane control. Its tooltip appears over the preview without
  stealing focus or intercepting mouse input.
- A developer opens a command palette or confirmation dialog. The preview remains visible behind
  the backdrop, and input stays within the modal interaction until dismissal.
- A plugin uses shared kit overlays. Its host-rendered menus and dialogs receive the same layering
  behaviour without plugin-specific native code.

## Scope

The first complete implementation covers these host-rendered surfaces wherever they intersect a
native page webview:

| Surface | Required behaviour |
| --- | --- |
| Tooltips and status legends | Visible above pages; do not activate a window or capture focus; preserve pointer pass-through. |
| Popovers and notification inbox | Visible and interactive; retain anchoring, dismissal, and scrolling behaviour. |
| Menus, context menus, select lists, and pickers | Support keyboard navigation and nested surfaces without premature dismissal. |
| Modals, confirmation dialogs, and palettes | Draw the complete backdrop and content above pages; block background interaction and restore focus on close. |
| Toasts | Preserve kit stacking and input behaviour when overlapping a page. |
| Floating drawers and custom application overlays | Join the same ordering and input policy when they can cover a page. |
| Host-rendered loaded-plugin overlays | Preserve their declared contribution, invocation, trust, and frame boundaries. |

Inventory both kit components and surfaces that draw `.overlay-backdrop` or other custom floating
markup directly. Completion includes migrating those application surfaces that would otherwise
remain below a native page. Full-screen views such as Settings must also remain correctly ordered
when entered from a preview; switching away may retain the normal hide-on-leave lifecycle.

Both browser previews and loaded-plugin native webviews are covered. Native OS menus and dialogs
retain their shell ownership. UI drawn inside a plugin iframe remains confined to that iframe;
this feature does not grant it permission to escape its rectangle. Its host-owned overlay wrapper
is covered by the feature.

The following work is outside this feature:

- Replacing browser previews with iframes or changing preview navigation and storage policy.
- Enabling previews for remote Nodes or changing their network restrictions.
- Persisting overlay state, adding Node routes, or changing the product data model.
- Redesigning the component kit, introducing a second plugin UI API, or changing terminal layout.

## Functional requirements

### Native ordering and appearance

1. Every in-scope surface draws above every visible native page webview it overlaps, including when
   the page is created, navigates, or regains focus after the overlay opens.
2. The preview remains live. Animation, page loading, and media continue under a nonmodal overlay,
   subject to normal OS background behaviour. An overlay does not recreate the page or alter its
   viewport, scroll position, history, form state, or storage.
3. Overlay borders, shadows, rounded corners, and translucent backdrops match the shared kit.
   Transparent areas reveal the underlying page without an opaque rectangular patch.
4. Preserve the kit's documented stacking invariants and the relationship between a parent surface
   and its nested picker or menu. Use one ordering model across HTML and native surfaces.
5. Appearance changes apply to open overlays. Font metrics, theme, style pack, and scaling match
   the main renderer.

### Mouse and keyboard interaction

1. A press on an overlay reaches that overlay exactly once and cannot activate the page below it.
   Transparent shadows and unused native surface area do not form invisible input barriers.
2. Tooltips do not take keyboard focus. Pointer movement and clicks continue to reach their normal
   targets beneath the tooltip, including the preview.
3. Outside presses preserve each component's dismissal contract. Test outside presses in both the
   main renderer and the native page; DOM-only listeners cannot observe both automatically.
   A modal backdrop consumes the press and prevents page interaction. A nonmodal surface follows
   its existing contract for whether an outside press also activates the underlying target.
4. Escape dismisses the top eligible surface once. Nested menus or pickers do not cause their parent
   to close prematurely. Window shortcuts keep their existing precedence.
5. Modal Tab and Shift+Tab navigation stay inside the active modal interaction, including its nested
   surfaces. The background renderer and native page cannot receive keyboard or mouse interaction
   while the modal is active.
6. Dismissal restores focus to the opener or the owning page when appropriate. If the opener was
   disposed, use the normal host focus fallback. Typing, text selection, clipboard shortcuts, and
   input method composition work in overlay fields.
7. Accessible names, roles, focus order, and announcements remain usable with the platform screen
   reader. A native layer must not expose duplicate interactive copies of one overlay.

### Geometry and lifetime

1. Anchor positioning uses window content coordinates with an explicit conversion between logical
   and physical pixels. Scrolling, resizing, pane movement, zoom, and monitor scale changes preserve
   alignment. Screen coordinates are used only where the selected native backend requires them.
2. Position updates respond to layout and overlay lifecycle events. The existing 200 ms centre
   polling is not the authority for overlay visibility or ordering.
3. Opening, closing, and moving an overlay do not expose an intermediate frame in which it appears
   underneath the page. Prepare content and bounds before making a native overlay surface visible.
4. Task, Node, route, and plugin identity changes dispose overlays whose owners disappear. Late
   updates and actions from a disposed owner cannot re-show a surface or reach a replacement owner.
5. Window close, renderer reload, plugin unload, and layer failure release native resources and
   listeners. Repeated use cannot accumulate webviews or input capture regions.

## Architecture and ownership

The logical composition is Acorn content, then host-owned page webviews, then Acorn's floating UI.
The desktop shell owns native composition and input routing. The shared kit owns component
semantics, appearance, anchoring, and dismissal. The application and plugin host own overlay content
and the actions that content can invoke.

Keep kit code host-neutral. It must not import Tauri, name native commands, or import product
features. Connect desktop behaviour through a typed host adapter or platform seam. Preserve kit
component props and plugin contribution contracts wherever possible. The terminal host continues
using its own rendering and interaction implementation.

### Rendering strategy to select in the prototype

The preferred investigation is a reusable, trusted native overlay host above the page views. A
single host per window is desirable if it supports the required input regions and stacking. A
bounded set of native surfaces is acceptable if platform constraints require it; document the
ceiling, reuse policy, and exhaustion behaviour.

A separate webview is a separate document and JavaScript realm. A Solid portal cannot transfer
arbitrary live JSX, callbacks, or context into it. Before choosing a second overlay renderer, prove
how the shared components retain reactivity, local state, nested children, and actions. Copying DOM
markup cannot satisfy interactive overlays.

Evaluate native composition of the main renderer as an alternative if it can preserve the live
component tree while exposing the page beneath it and routing input correctly. Document why the
selected approach meets the requirements on each platform. Neither approach is approved merely
because it draws one demonstration tooltip above a page.

### Data flow and state

Application or plugin data continues through the existing Node API, protocol, custody broker, and
client query cache into the owning UI consumer. Native layering begins at that consumer's overlay
presentation boundary. It introduces no second Node connection, query cache, plugin activation
runtime, or durable store.

The owning UI remains the authority for content and actions. Any additional renderer receives only
the presentation state and permitted events needed for its job. Across a realm or process boundary,
use typed serializable values and stable action identifiers, not callbacks, DOM nodes, or executable
markup supplied by a page.

Define a transient overlay record covering identity, owner scope, generation, logical bounds,
stacking role, modality, input policy, focus restoration target, and lifecycle state. Keep native
handles inside the shell. Reject stale generations and unknown actions. Action results update the
owning state and are reflected back into the presented overlay exactly once.

Opening and closing overlays does not fork form state, refetch business data just to render it,
reset a draft, or remount the application. Local UI state inside overlay children must have an
explicit owner under the chosen rendering strategy.

## Security and compatibility requirements

The overlay host loads trusted Acorn assets. Preview pages and plugin page webviews cannot create,
move, spoof, or send actions to trusted native overlays. Resolve plugin contribution identity through
the existing host registries and brokers.

If a dedicated trusted webview needs Tauri commands, grant only its required commands to its exact
label. Preserve the prohibition on window-wide capability grants. Preview and plugin page webviews
remain unprivileged. Keep navigation restrictions, frame sandboxing, accepted bundle identity,
and per-surface storage isolation intact.

Handle new bridge messages with validation, bounded payloads, and owner-scoped action dispatch. A
plugin unload or trust change invalidates its overlay presentation and outstanding actions.

macOS is the first acceptance platform because the reported workflow runs there. Before production
implementation, enumerate the desktop operating systems and minimum versions this release supports.
For Windows and Linux, record either a tested implementation or an explicit deferred status with
the fallback below. Do not report native layering as complete on an untested platform.

Tauri provides [access to platform webview handles](https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html#method.with_webview).
Its [webview transparency API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html#method.transparent)
requires the `macos-private-api` feature on macOS. The prototype must verify the pinned dependencies,
distribution constraints, and input behaviour before adopting that API. CSS transparency alone
does not establish native pointer pass-through.

## Failure behaviour and performance

If the layer is unavailable or fails, Acorn must remain usable. A centralized fallback may hide an
overlapped native page while the overlay is open, then restore the same page instance on dismissal.
This is degraded behaviour and does not satisfy native-layer acceptance. The fallback must include
partial overlaps and pointer-transparent tooltips; centre-point hit testing is insufficient.

Failure must not leave invisible surfaces intercepting input, display an obsolete overlay after a
task switch, lose a draft, or grant a page additional capabilities. Record a bounded diagnostic
containing backend, overlay role, lifecycle stage, and failure reason. Exclude page contents, form
values, and credentials.

With no overlay open, the overlay infrastructure must not intercept input or introduce recurring
layout polling or business-data requests. Measure opening, repositioning, and closing against the
same fixture with the layer disabled. Report hardware, OS, scale, and renderer configuration.

Proposed acceptance budget: after content and assets are ready, trigger-to-visible latency is at
most 100 ms at the 95th percentile over 50 opens on the declared reference machine. Preserve any
intentional component hover delay separately. After 100 open/close cycles, native surface and
listener counts return to the documented baseline. These are targets, not measurements.

## Delivery gates

### Gate 1 Native feasibility and architecture decision

Build a focused prototype with a live animated page, the notification popover, a passive tooltip,
and a modal containing an editable field and nested picker. Prove stacking, transparency, pointer
routing, focus restoration, keyboard input, and continued page activity on macOS. Include a loaded
plugin page webview and a host-rendered plugin overlay in the evidence.

Deliver a short architecture decision covering rendering strategy, state ownership, input routing,
dependency features, capability grants, platform matrix, resource limits, and fallback. Record
screenshots or video and the results of the interaction checks. Resolve the separate-realm component
problem before expanding the prototype. If no strategy meets these requirements, record the blocker
and a concrete product trade-off for review rather than treating suppression as completion.

### Gate 2 Shared infrastructure and representative integration

Implement native surface lifecycle, geometry, ordering, scoped event routing, and focus/input policy
behind the host seam. Integrate shared overlays without requiring a plugin-specific native API.
Make the centre-point suppression logic subordinate to explicit layer or fallback state so it cannot
hide a correctly composed page when an overlay opens.

Add deterministic tests for owner disposal, stale generations, nested dismissal, command authority,
and seam compatibility. Verify the representative prototype scenarios in the production integration.

### Gate 3 Application migration and acceptance

Complete the overlay inventory and migrate uncovered surfaces. Verify appearance, accessibility,
performance, and all acceptance scenarios on every platform enabled for native layering. Document
deferred platforms and their fallback. Update the owning shell, frontend, UI design, platform seam,
and testing documentation as needed; record shipped behaviour there and retain this proposal only
while acceptance remains open.

## Acceptance scenarios

| ID | Scenario | Pass condition |
| --- | --- | --- |
| A1 | Notification inbox overlaps only the preview's upper edge. | Entire popover is readable; each row is clickable once; animated page remains visible and live. |
| A2 | Passive rail tooltip overlaps a page. | Tooltip is visible; focus stays with the opener; clicks pass through according to tooltip policy. |
| A3 | Modal with translucent backdrop opens over a page. | Backdrop and modal draw above the page; page remains visible; background clicks, keys, and accessibility navigation are blocked. |
| A4 | Picker opens inside a popover or modal. | Picker draws above its parent; selection reaches the owner once; Escape dismisses the eligible top surface first. |
| A5 | Outside press lands in the native page. | Dismissal matches the component contract; the press is neither lost nor duplicated; modal presses do not reach the page. |
| A6 | Overlay text field receives typing, clipboard input, and input method composition. | Text and selection remain correct; shortcuts retain their intended precedence. |
| A7 | Window resizes, pane moves, ancestor scrolls, or monitor scale changes. | Overlay tracks its anchor, shadows remain visible, and visual bounds match input regions. |
| A8 | Page navigation, DevTools, or new page-view creation occurs with an overlay open. | Native ordering remains correct; no page rises over the overlay. |
| A9 | Task or Node switches, plugin unloads, or an owner is disposed during an update. | Old overlay disappears; late messages cannot reopen it or invoke actions against the replacement owner. |
| A10 | Overlay closes after the page has been edited and scrolled. | Page keeps history, scroll, form state, and storage; appropriate focus is restored. |
| A11 | Theme, style pack, zoom, or font settings change with an overlay open. | Overlay matches the main renderer and remeasures its bounds correctly. |
| A12 | Native layer fails or is disabled. | Fallback keeps the UI usable, restores the same page, and leaves no invisible input barrier. |
| A13 | Preview or plugin page attempts to call overlay commands. | Shell refuses the call; only authorized host-origin actions reach the owner. |
| A14 | Repeated overlay cycles, renderer reload, and window close. | Resources return to their documented baseline and no orphaned native surface remains. |
| A15 | Shared kit overlay is emitted by a loaded remote tree; plugin frame is mounted in a host-owned dialog. | Both retain contribution identity, actions, containment, and native ordering without duplicate plugin runtimes. |
| A16 | Command palette, toast, custom confirmation, or floating drawer overlaps a page. | All inventoried host surfaces use the shared layer and preserve their established relative ordering and interaction policy. |

## Verification and handoff evidence

Before handing implementation back, run `pnpm lint`, relevant client-core and preview tests, the
architecture contract tests, and `pnpm --filter @acorn/desktop test`. Use `pnpm test` when running
the complete suite; retain its bounded concurrency.

Verify pixels and native interaction in a real Tauri window. Start an isolated session with
`pnpm dev:agent -- --session native-overlays`, use `pnpm dev:agent:ui -- --session native-overlays snapshot`
after each renderer transition, and capture screenshots. Finish with
`pnpm dev:agent:ui -- --session native-overlays stop`. The driver only controls the main renderer.
Use native computer-use control or manual checks for overlay/page surfaces it cannot reach. DOM
snapshots and mocked webview tests alone cannot demonstrate native stacking or input routing.

Hand off the architecture decision, platform matrix, completed surface inventory, test results,
real-window captures, measured performance/resource results, accessibility results, and documented
deviations. A working tooltip demonstration does not close the interaction or migration gates.

## Verify before building

Paths below identify owners and investigation points, not frozen APIs. Reread them and their tests
before choosing file placement or changing a contract.

- `apps/desktop/src-tauri/src/webviews.rs`: native page creation, bounds, navigation, visibility,
  resource limits, and ordering after DevTools opens.
- `apps/desktop/src/shell/bridge.ts` and `apps/desktop/src-tauri/capabilities/default.json`: bridge
  authority, exact webview labels, and command grants.
- `packages/client-core/src/infra/platform/index.ts`, `contract.ts` in the same folder, and
  `packages/client-core/src/infra/platform/webviewGeometry.ts`: host adapter contracts and coordinate
  conversion. Check contract tests before adding a seam group or member.
- `packages/client-core/src/kit/components/overlays/` and
  `packages/client-core/src/kit/lib/controls/anchor.ts`: arbitrary children, nested surfaces,
  outside-click behaviour, and positioning.
- `packages/client-core/src/kit/keys/` and `packages/client-core/src/kit/tokens/tokenAxes.ts`: focus
  traps, restoration, shortcut precedence, appearance, and stacking invariants.
- `plugins/preview/src/client/PreviewPane.tsx` and
  `packages/client-core/src/host/frames/PluginWebview.tsx`: duplicated suppression and page lifetime.
- `apps/desktop/src/client/App.tsx`, `packages/client-core/src/host/frames/PluginOverlay.tsx`, and
  application-owned overlay markup: the full migration inventory and loaded contribution boundaries.
- Confirm native hit testing, accessibility traversal, input method behaviour, platform support,
  distribution policy, and automation limits against the selected backend before committing to it.
