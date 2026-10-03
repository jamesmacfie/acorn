# Native overlays

On macOS, the desktop draws host floating UI, such as menus, tooltips, and modals, above the live
native pages that preview and loaded plugins open. Read this page before you add a floating surface
or touch the overlay commands in the shell. The main WKWebView and its Solid tree stay the same.
Native acceptance isn't finished. [The verification record](./testing/native-overlays.md) lists the
checks and the evidence.

## Ownership and composition

Node data flows through the API, protocol, custody broker, and client query cache into the UI that
owns it, as everywhere else. Native layering starts after that, when a page or an overlay draws. It
adds no Node connection, plugin runtime, query cache, durable state, or action channel.

`packages/client-core/src/infra/platform/nativePages.ts` owns the list of what's on screen. Preview
and `PluginWebview` register their live DOM owner with `observeNativePage` and unregister it on
disposal. The adapter watches layout, scrolling, DOM changes, appearance changes, and running
geometry animations. It batches work with `requestAnimationFrame` and sends only geometry that
changed. It doesn't poll, and it fetches no business data.

The macOS shell puts the main WKWebView inside one layer-backed AppKit `NSView` wrapper. While pages
have live DOM owners, the wrapper sits above the native page views. The main renderer turns
transparent, and even-odd CSS paths cut the page rectangles out of the body branches that own them.
Body-level portals keep overlays, shadows, corners, and translucent backdrops in the same renderer.
A Solid portal wrapper gets a paint box while it holds a native page, and disposal restores its
styles. Overlay children keep their context, callbacks, and state.

The shell raises the wrapper after a page shows and after the inspector attaches. An empty snapshot
clears the input regions and lowers the wrapper below the pages. The window owns the wrapper. No
overlay gets its own native view, and the feature adds no privileged webview.

## Geometry and input

Bounds use CSS viewport coordinates. The viewport size crosses the seam with each snapshot and each
page-bounds command. The shell converts CSS pixels to native logical points from the content size and
the backing scale. AppKit converts hit-test points back to CSS coordinates. The platform compositor
owns physical pixels. Nothing uses screen coordinates.

Inside a page rectangle, the wrapper reports no hit unless an interactive host overlay covers the
point. AppKit then sends the event to the native page. Rounded input regions leave out transparent
corners. Passive tooltip regions don't block input, and shadows don't enlarge hit bounds. On a native
mouse-down, the wrapper also tells the main renderer's dismissal listeners, once per native event
number. It never synthesizes a click in the page.

Modal backdrops take input. The shell moves native focus into the main renderer and hides blocked
page views from the native accessibility tree. The host marks background DOM branches `inert` and
`aria-hidden`, and puts their earlier attributes back on close. Anchored portals that a dialog owns
stay usable. On close, the kit restores focus, and the shell can give focus back to a native page if
the page had it before. A plugin page inside its own host dialog leaves that dialog out of its
blocker list. Any other interactive host overlay that covers the page blocks it.

## Presentation authority and lifetime

The optional `rendererLayer.update` platform group takes short-lived snapshots that hold:

- A renderer generation and the CSS viewport size.
- Up to 32 page bounds, each with up to 128 blocking surface IDs.
- Up to 128 host surface records, each with an ID, role, bounds, four corner radii, interaction,
  and modality.

Content, forms, markup, callbacks, page URLs, and business actions don't cross this seam. Native
handles stay in the shell (`apps/desktop/src-tauri/src/overlays.rs`). `overlay_begin` starts a new
renderer epoch and retires the old one on reload. `overlay_update` requires the calling webview
label `main`, the live epoch, valid bounded geometry, unique IDs, and a newer generation. Queued
callbacks check the epoch again. Disposal sends a newer empty snapshot, so a late update can't bring
back stale input regions.

Preview and plugin page webviews have no overlay authority. Capabilities keep their grant to the
`main` webview only. The feature adds no window-wide grant and no trusted origin. Plugin
contributions, frame sandboxing, navigation allowlists, bundle identity, and storage isolation keep
their owners. Iframe UI can't escape its rectangle.

## Surface inventory

`nativePages.ts` finds host overlays by these roots:

| Host UI | Presentation root |
| --- | --- |
| Tooltips and status legends | `.rail-tip`, a body portal in the desktop app |
| Notification inbox and popovers | `.ui-popover` |
| Menus and select lists | `.ui-popover`. Nested dismissal follows the kit's anchored open order. |
| Pickers | `.repo-picker-popover-fixed` |
| Modals, palettes, confirmation, draft, and trust dialogs | `.overlay-backdrop`, body portals |
| Toasts | `.ui-toast`, a body portal. The stack stays pointer-transparent. |
| Kit drawers | `.ui-drawer` |
| Reference panels and loaded-plugin panels | `.integrations-panel-backdrop`, `.integrations-panel` |
| Mentions and custom floating UI | `.mention-popup`, `[data-host-overlay]` |
| Settings | `.settings-view`, a body portal. Leaving the route hides pages as usual. |
| Loaded-plugin host overlays | `PluginOverlay` body portal. The host keeps page and contribution ownership. |

## Platform and failure policy

Only macOS composes natively:

| Platform | Native composition | Compatibility policy |
| --- | --- | --- |
| macOS | AppKit wrapper and transparent WKWebView | Minimum macOS 12.0 in `tauri.conf.json`. Nobody has checked it on 12.0. |
| Windows | Not built | Rectangle-overlap fallback. No native layering. |
| Linux | Not built | Rectangle-overlap fallback. No native layering. |

The Windows and Linux targets keep their release configuration, and this feature sets no minimum OS
for them. The Objective-C dependencies compile only on macOS.

WKWebView transparency needs Tauri's `macos-private-api` feature and `app.macOSPrivateApi`. Acorn
ships its desktop bundle directly. The Mac App Store rejects this configuration, so review it before
you change how the app is distributed.

Set `ACORN_NATIVE_OVERLAYS=0` before launch to use the overlap fallback. Unsupported hosts and a
failed layer use it too. The fallback hides any native page an overlay intersects, including partial
overlaps and passive tooltips, then restores the same page instance on dismissal. The native manager
clears regions before it switches to the fallback. Failure diagnostics name the backend and the
lifecycle stage, and leave out page content, form values, URLs, and credentials. After a layer
failure, the renderer stays on the fallback until it reloads, and the reload tries again.

## The WebDriver patch

The development WebDriver dependency carries a local patch, described in
`apps/desktop/src-tauri/vendor/tauri-plugin-wdio-webdriver/ACORN-PATCH.md`. Tauri's
`webview_windows()` drops `main` from its list after a child webview is created. The patch keeps the
main renderer handle and removes closed windows, so agent control survives a native page opening.
The dependency compiles only with the `agent-automation` feature, which release builds reject.
