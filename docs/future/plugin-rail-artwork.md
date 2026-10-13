# Dynamic plugin rail presentation and artwork

Date: October 13, 2026. Status: proposed. Baseline: `6017d3233`.

This product requirements document covers two Acorn extensions: live artwork and song information
on a plugin's rail button, and an artwork component for plugin UI. It is for implementers of the
plugin contracts and both clients. A Spotify plugin is the motivating consumer; building that
plugin is separate work.

## Problem and outcome

A person listening to music wants to identify the playing track while working in another Acorn
view. Selecting its album cover should open a Spotify view drawn with Acorn's component kit.
Plugin authors need to supply this information without controlling the shell's DOM or shipping
an iframe for a rail button.

The source contract exposes a static `glyph` and `label`. Its owner is
`packages/protocol/src/plugin/manifest/chromeDescriptors.ts`; registration lives in
`packages/client-core/src/host/chrome/chromeRegister.ts`. The rail projects these fields through
`packages/client-core/src/features/tabs/railSources.ts` and draws
`packages/client-core/src/features/tabs/RailTab.tsx`.

The tree kit exposes icons and a GitHub-specific user avatar, but no general artwork component.
Its public entrypoint is `packages/plugin-api/src/ui/tree.ts`, with the wire vocabulary in
`packages/protocol/src/tree/nodes.ts` and props in `packages/protocol/src/tree/props.ts`.

The required outcomes are:

- A plugin's rail button can display changing artwork and a tooltip while its view is closed.
- Clicking the button opens its source through the normal navigation action.
- The same artwork component works in compiled UI and a loaded plugin's remote tree.
- The shell owns geometry, selection, focus, accessibility, image loading, and failure handling.
- Plugins without these declarations keep their static glyphs and labels.

## Scope

Deliver both extensions for Node-backed loaded plugins, plus the compiled contribution equivalent.
The desktop displays artwork. The terminal client displays the source glyph and text information,
and exposes the artwork component's text fallback without fetching image bytes.

This work excludes Spotify authentication, provider polling, library browsing, audio playback,
playback controls, and Spotify distribution approval. It also excludes dynamic task icons,
footer changes, arbitrary rail components, external image URLs, and device-only dynamic rail data.
Device-only sources retain their static presentation.

## Dynamic rail presentation

Add an optional `railPresentation` declaration to a source. It names a GET route in the declaring
plugin's namespace and a fallback refresh interval using the descriptor refresh rules. The
compiled contribution exposes the same typed result through its host registration seam.
The declaration controls presentation only; it cannot change source identity or navigation.

The proposed response is a bounded object or `null`. Final names must follow the public contract
conventions, but the required information is:

| Field | Meaning and limit |
| --- | --- |
| `artwork` | Optional artwork reference, using the shared contract below. |
| `tooltip.title` | Optional plain text, up to 80 characters. The host keeps the source label visible alongside it. |
| `tooltip.detail` | Optional plain text, up to 1,024 characters. Line breaks are allowed; markup is not. |

An example answer from the future Spotify plugin is:

```json
{
  "artwork": {
    "path": "/v1/p/spotify/artwork/track-cover-42",
    "revision": "track-cover-42",
    "alt": "Album cover for Example album"
  },
  "tooltip": {
    "title": "Example song",
    "detail": "Example artist\nExample album\nPaused"
  }
}
```

These paths describe a proposed plugin, not a route shipped by Acorn. Returning `null` resets the
button to its static presentation. Omitting artwork preserves the glyph while displaying the
tooltip. A malformed answer falls back to static presentation and records a diagnostic.

The following requirements apply:

- Render artwork inside the source button's allocated icon box. Preserve rail position, button
  dimensions, source label, selection, drag behavior, context menu, and visibility preferences.
- Show the same information on hover and keyboard focus. Keep the source label as the stable
  accessible name; expose dynamic details as its description without announcing every track change.
- Keep selection and annotation markers outside the artwork. An image does not cover or disable
  the source's status information. Preserve the marker legend in the tooltip.
- Missing, corrupt, or failed artwork falls back to the source glyph while keeping valid text.
- Display a host-owned stale or unavailable indication after a failed refresh or Node disconnect.
  Retain the last valid answer only for the same Node and plugin registration.
- Node switches, reloads, disablement, uninstall, and trust rejection cancel preceding requests and
  release their resources. Late answers cannot replace the active registration's presentation.

## Artwork component

Add `Artwork` to the public component and tree APIs. Use one component contract across compiled
rendering, remote tree rendering, and the rail. The component is presentational: the host adapter
resolves an image reference and supplies a local resource; it does not know Spotify or fetch provider
URLs. Its owning feature belongs beside the kit's content components.

The shared image reference contains `path`, `revision`, and `alt`. Paths are bounded to 2,048
characters, revision strings to 128 characters, and alt text to 160 characters. The host binds the
Node and plugin identity from the trusted registration or tree mount; plugin props cannot name a
different Node or plugin. Compiled consumers pass an explicit resource owner through the adapter.

`Artwork` accepts semantic size presets for rail, list thumbnail, and detail artwork, an optional
reference, and a text fallback. The kit defines their dimensions, square aspect ratio, corner radius,
and density behavior. Remote props expose no CSS, numeric dimensions, event handlers, or arbitrary
DOM attributes. Parent buttons and links own interactions.

The component must:

- Fit the complete image inside the square without cropping, distortion, animation, or overlays.
- Reserve its dimensions during loading and failure, so an image cannot shift surrounding layout.
- Provide alt text for informative images and allow the host to suppress duplicate alt text in
  a rail button whose accessible description already identifies the track.
- Render a stable placeholder while loading and the text fallback on absence or failure.
- Handle source replacement without briefly drawing the preceding cover under the next track's
  tooltip. Publish metadata and image identity together; show the placeholder until matching bytes load.
- Support light and dark themes, density settings, and both rendering paths using the kit's tokens.
- Produce legible fallback text in the terminal and reserve no empty graphical box there.

## Data ownership and delivery

The plugin owns provider authentication, account selection, external fetches, polling, and a bounded
cache of its provider state and image bytes. Its routes return metadata or raster bytes, with no
credentials in either answer. Core owns no music records and needs no database migration.

The client owns disposable presentation state and image resources. Follow the authenticated binary
broker and local object URL pattern described in [workspace images](../workspaces-and-tasks/workspace-icons.md#transport-and-refresh).
Read `packages/client-core/src/features/workspaces/workspaceImageResources.ts` before introducing a
resource loader. Extract reusable mechanics only where both consumers need them; keep workspace
appearance and persistence in their feature owner.

The intended data flow is:

```text
Provider -> plugin cache -> plugin metadata and artwork routes -> authenticated Node broker
         -> client validation and resource cache -> rail button and Artwork components
```

The host reads rail presentation whenever its source button is visible, regardless of the selected
source or whether a plugin tree is mounted. Reuse [descriptor freshness](../plugins/freshness.md):
declared refresh has the 30-second floor, status invalidates after actions, and the plugin's own
live channel invalidates when provider state changes. Add no timer per rail component and do not
lower the shared chrome interval for music. Provider polling stays in the plugin's Node half.

Deduplicate metadata reads by Node, plugin, and source. Deduplicate artwork reads by Node, plugin,
path, and revision. A reference must address immutable bytes, including in its route path or query;
changed bytes require a changed revision and address. A route returning whichever cover is playing
at request time cannot satisfy this contract. Allow at most four concurrent artwork reads per window
and 32 MiB of encoded resident bytes. If active consumers exhaust the budget, show their fallback
until capacity is available. Release object URLs when their last consumer leaves. Hidden source
buttons create no artwork reads, and a closed plugin view retains no tree worker solely to update
its rail button.

## Trust, limits, and compatibility

Use the declaring plugin's authenticated routes, route gates, and trust lifecycle. Artwork paths
must remain in its namespace after URL parsing and normalization. Reject foreign namespaces,
external origins, traversal, credentials, fragments, and redirects outside the permitted route.
Do not place a Node route or provider URL directly in an image element. Do not widen renderer or
worker network policy; the plugin's declared Node network permission owns external downloads.

Accept static PNG, JPEG, and WebP only. Reject SVG, animation, unsupported formats, and corrupt
content. Use the workspace image ceilings as upper bounds: 5 MiB encoded and 16 million decoded
pixels. Check actual content and dimensions before publishing a local resource, not MIME alone.
Bound metadata responses to 32 KiB. Logs identify the plugin and failure category without recording
image bodies, tooltip contents, tokens, or full URLs. Failed images produce no repeated toast.

Extend manifest parsing, roster validation, chrome reads, tree prop validation, and both host node
tables together. Declare `Artwork` in a plugin's required kit nodes so an unsupported host reports
an unsupported contribution. Hosts unaware of `railPresentation` keep the static source glyph.
Apply the repository's plugin API and mixed-build policy; no alternate version negotiation scheme
belongs in this feature. Persist neither presentation metadata nor object URLs in preferences.

## Acceptance and delivery

Use a throwaway loaded plugin with two raster covers and a controllable metadata route. The fixture
needs no Spotify account, credentials, or public network. Acceptance requires:

1. With another source open, change the fixture's title and cover and publish its live event. The
   visible rail updates without mounting the fixture's UI. Clicking still opens the same source.
2. Open a tree containing list and detail artwork. Its cover matches the rail; shared consumers
   issue one binary read for the same resource identity and release it after the last consumer leaves.
3. Cover loading, missing bytes, invalid MIME, oversized content, corrupt images, and `null` metadata
   preserve button geometry and show the specified fallback. No outgoing request reaches a foreign origin.
4. Delay Node A's answer, switch to Node B, and release A's answer. A's metadata and bytes cannot
   appear under B. Repeat across a plugin update, disablement, and trust revocation.
5. Disconnect and reconnect the Node. The tooltip identifies retained information as stale, and a
   successful read clears that indication. Image completion races cannot mix track and cover identities.
6. In desktop keyboard navigation, the tooltip exposes song information, the accessible name keeps
   identifying the source, and selection and annotation legends remain usable. Check both themes and densities.
7. In the terminal client, song details and artwork fallback text remain readable, navigation works,
   and instrumentation records no binary artwork requests.

Implement artwork validation and resource ownership first, then publish `Artwork` across the kit and
both hosts, then add the rail presentation contract and lifecycle. Keep data parsing and resource
ownership out of the rail composition root. Verify observable failures and lifetime races with focused
tests; verify theme, geometry, tooltips, and keyboard behavior in real desktop and terminal sessions.

Run `pnpm lint`, package suites for every touched package and consumer, and
`pnpm --filter @acorn/arch-tests test`. Follow [focused agent runs](../testing.md#focused-agent-runs)
for exact scopes. Record real-host evidence under `docs/testing/` when implementation ships.

Update [contribution kinds](../contribution-kinds.md), [source descriptors](../plugins/descriptors.md),
[freshness](../plugins/freshness.md), [the tree contract](../plugins/tree-contract.md),
[UI design](../ui-design.md), [terminal plugins](../tui/plugins.md), and
[client sandbox security](../security/plugin-client-sandbox.md) as their contracts change. Publish an
authoring example and actionable validation errors. Remove this proposal when the owning references
describe the delivered behavior.

## Why

Dynamic presentation is data the shell draws, so a rail button needs no plugin frame or worker.
Artwork is useful inside plugin UI and shell chrome, so both paths share its contract and lifetime
rules. Reusing Acorn's broker preserves Node identity and credential ownership while avoiding
arbitrary network requests from the person's renderer. These two extensions enable the Spotify
design without putting music behavior in the shell.
