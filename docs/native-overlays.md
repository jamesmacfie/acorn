# Native overlays

The desktop composes host floating UI above live native preview and loaded-plugin pages on macOS.
The implementation preserves the original main WKWebView and Solid tree. Full native acceptance
remains open; [the verification record](./testing/native-overlays.md) lists the checks and evidence.

## Ownership and composition

Node data still flows through the API, protocol, custody broker, and client query cache into its
owning UI. Native layering begins after that flow reaches a page or overlay consumer. It adds no
Node connection, plugin activation runtime, query cache, durable state, or action dispatch channel.

`infra/platform/nativePages.ts` owns the shared presentation inventory. Preview and `PluginWebview`
register their live DOM owner with `observeNativePage` and unregister it on disposal. The adapter
observes layout, scrolling, DOM changes, appearance changes, and active geometry animations. It
coalesces work with requestAnimationFrame and sends only changed geometry. There is no 200 ms
centre-point polling or business-data fetch for layering.

The macOS shell places the original WKWebView inside one layer-backed AppKit NSView wrapper.
The wrapper sits above native page siblings while pages have live DOM owners. The main renderer
becomes transparent, and even-odd CSS paths remove the union of page rectangles from their owning
body branches. Body-level portals keep overlays, shadows, corners, and translucent backdrops in
the same renderer. Solid portal wrappers receive a paint box while they contain a native page;
disposal restores their original styles. Overlay children keep their context, callbacks, and state.

The shell raises the wrapper after page show and inspector attachment. An empty presentation clears
input regions and lowers the wrapper below pages. The window owns the wrapper's native lifetime;
there is no native view allocated for each overlay and no additional privileged webview.

## Geometry and input

Presentation bounds use CSS viewport coordinates. The viewport dimensions cross the seam with each
snapshot and page-bounds command. The shell converts CSS pixels to native logical points using the
content dimensions and backing scale. AppKit converts hit-test coordinates back to CSS coordinates.
Physical pixels remain the platform compositor's responsibility. Screen coordinates are unused.

Inside a page rectangle, the wrapper returns no hit when no interactive host overlay covers that
point. AppKit then sends the original event to the native page. Rounded input regions exclude
transparent corners; passive tooltip regions do not block input. Shadows do not enlarge hit bounds.
For native mouse-down events, the wrapper separately notifies main-renderer dismissal listeners,
deduplicated by the native event number. This notification never synthesizes a click in the page.

Modal backdrops consume input. The shell moves native focus into the original renderer and hides
blocked page views from the native accessibility tree. The host marks background DOM branches inert
and aria-hidden, preserving their previous attributes. Dialog-owned anchored portals remain allowed.
On modal close, kit focus restoration runs; the shell can restore a live native page responder when
the page owned the previous focus. A plugin page inside its own host dialog excludes that dialog
from its blocker list. All other covering interactive host overlays can block the page.

## Presentation authority and lifetime

The optional `rendererLayer.update` platform group accepts transient presentation snapshots:

- A renderer generation and CSS viewport dimensions.
- Up to 32 page bounds, each with its blocking surface IDs.
- Up to 128 host surface records with an ID, role, bounds, four corner radii, interaction, and modality.

Content, forms, executable markup, callbacks, page URLs, and business actions do not cross this seam.
Native handles remain inside the shell. `overlay_begin` creates a renderer epoch and invalidates the
previous realm on reload. `overlay_update` requires the exact calling webview label `main`, the live
epoch, valid bounded geometry, unique IDs, and a newer generation. Queued callbacks recheck epochs.
Owner disposal sends a newer empty snapshot, so a late update cannot restore obsolete input regions.

Preview and plugin page webviews have no overlay authority. Capabilities retain their exact main
webview grant; this feature adds no window-wide grant or new trusted origin. Plugin contributions,
frame sandboxing, navigation allowlists, accepted bundle identity, and storage isolation retain
their existing owners. Iframe UI does not escape its rectangle.

## Surface inventory

| Host UI | Presentation root |
| --- | --- |
| Tooltips and status legends | `.rail-tip`, body portal in the desktop app |
| Notification inbox and popovers | `.ui-popover` |
| Menus and select lists | `.ui-popover`; nested dismissal uses the kit's anchored open order |
| Pickers | `.repo-picker-popover-fixed` |
| Modals, palettes, confirmation, draft and trust dialogs | `.overlay-backdrop`, body portals |
| Toasts | `.ui-toast`, body portal; stack remains pointer-transparent |
| Kit drawers | `.ui-drawer` |
| Reference panels and loaded-plugin panels | `.integrations-panel-backdrop`, `.integrations-panel` |
| Mentions and custom floating UI | `.mention-popup`, `[data-host-overlay]` |
| Settings | `.settings-view`, body portal; route leave still hides pages normally |
| Loaded-plugin host overlays | `PluginOverlay` body portal; page and contribution ownership stay in the host |

## Platform and failure policy

| Platform | Native composition | Compatibility policy |
| --- | --- | --- |
| macOS | AppKit wrapper and transparent WKWebView | Configured minimum macOS 12.0; runtime acceptance on the minimum OS remains unverified. |
| Windows | Deferred | Central rectangle-overlap suppression; no claim of native layering acceptance. |
| Linux | Deferred | Central rectangle-overlap suppression; no claim of native layering acceptance. |

The Windows and Linux build targets retain their existing release configuration. This change adds
no minimum OS guarantee for them. The Objective-C dependencies compile only on macOS.

WKWebView transparency requires Tauri's `macos-private-api` feature and `app.macOSPrivateApi`.
Acorn distributes its desktop bundle directly. This configuration is unsuitable for Mac App Store
submission and must be reviewed before changing distribution channels.

Set `ACORN_NATIVE_OVERLAYS=0` before launch to select the degraded overlap fallback. Unsupported
hosts and a failed layer use the same fallback. It hides an intersected native page, including
partial overlaps and passive tooltips, then restores the same page instance after dismissal.
The native manager clears regions before switching to fallback. Failure diagnostics contain backend
and lifecycle stage without page content, form values, URLs, or credentials. A layer failure stays
in fallback for the renderer lifetime; reload retries initialization.

The development WebDriver dependency has a documented local patch under
`apps/desktop/src-tauri/vendor/tauri-plugin-wdio-webdriver/ACORN-PATCH.md`. Tauri's
`webview_windows()` projection stops including main after child creation. The patch retains the
original main renderer handle and removes closed windows, so agent control survives native page
creation. The dependency compiles only with `agent-automation`, which release builds reject.
