# Workspace icons and optional desktop rail

Date: October 7, 2026

Status: Implemented October 7, 2026. See the [workspace icon reference](../workspaces-and-tasks/workspace-icons.md).

This product requirements document defines workspace icons, their appearance in the desktop
workspace switcher, and an optional workspace rail. Use it to implement and verify the feature.

## Problem and outcome

The desktop workspace switcher identifies workspaces by name. Switching requires opening its
dropdown, and there is no persistent visual identity to help distinguish workspaces at a glance.

Give each workspace an appearance that the desktop shows beside its name in the switcher.
Offer an optional further-left rail for direct switching through workspace icons, similar to Slack's
workspace navigation. Keep its width consistent with Acorn's other rails.

## Scope and decisions

The agreed behavior is:

- Support Acorn's normal icons on a solid background colour or a gradient, and uploaded images.
- Use initials when a workspace has no configured icon.
- Show the icon beside the selected workspace name and beside each dropdown entry, independent
  of whether the workspace rail is enabled.
- Offer **Show workspace rail** in **Settings > Appearance**, off by default.
- Edit a workspace's icon on its workspace settings page. Store it on the owning Node.
- Store rail visibility as a device preference.
- Keep this feature exclusive to the desktop. The terminal client offers neither the workspace
  rail nor icon editing. Workspace changes in the terminal client go through its workspace switcher.

Workspace membership, task ownership, Home scope, and project identity keep their owning contracts.
This feature does not implement project-first navigation or opt-in workspace grouping. If that
separate direction ships first, adapt this navigation to its exposed workspace groups without
introducing a second selection model. Individual project icons require their own product decision.

## Workspace appearance

### Icon on a background

Reuse Acorn's normal icon catalogue and icon picker. Let the person select an icon and choose
either a solid background colour or a gradient. A gradient must have at least two colours.
Show a live preview at both rail and switcher sizes.

Draw the glyph inside a square tile with rounded corners. Keep its foreground legible across the
chosen background in light and dark themes. Background colour describes workspace identity and
must not stand in for the rail's selected state or an operational status.

Persist structured colour and gradient values through a typed contract. Do not accept arbitrary
CSS or derive the workspace's appearance from a project's task colour. Reuse colour controls and
validation where they fit; keep gradient editing limited to what this workspace setting needs.

### Uploaded image

Let the person choose a local image, preview a square crop, and save it as the workspace icon.
Support PNG, JPEG, and WebP inputs. Provide replacement and removal through the same setting.
Use a static raster thumbnail so every desktop draws the same saved crop.

Upload limits: 5 MiB of PNG, JPEG, or WebP input; 16 million decoded pixels; a 128×128 static
PNG thumbnail capped at 128 KiB. The Node permits two concurrent normalizations, with a five-second
processing timeout. Crop coordinates refer to the oriented image and stay within its bounds.
Reject unsupported, corrupt, or oversized inputs with an error beside the control. Validate image
content on the Node rather than trusting the filename or the desktop's checks.

Bound image decoding and normalization. Store only the thumbnail needed for workspace identity;
retaining the original upload is outside this feature. Remote image URLs, animated icons, SVG
uploads, and an image-generation workflow are outside scope.

### Fallback and reset

Derive initials from the workspace's display name and use a theme-compatible fallback tile.
Renaming a workspace updates its fallback. Clearing a configured icon returns to the fallback.

A missing image, failed image fetch, or unsupported stored appearance renders the fallback without
blocking navigation. Preserve a valid configured appearance when its image is temporarily unavailable.
Do not show a broken-image marker or expose an asset identifier as the label.

## Desktop user experience

### Workspace settings

Add an **Icon** setting to the workspace page's **General** section. Offer **Icon and background**
and **Image** choices, previews, and **Reset icon**. Follow the settings save model for immediate
choices; image selection and cropping can use an explicit save action.

Cancelling a file choice or crop leaves the saved icon intact. A failed save keeps the previous
appearance in navigation and shows an actionable error in settings. Preserve a selected draft when
retrying a failed upload. A completed save updates both the switcher and the rail.

Allow configuring the Default workspace's icon. Its name and deletion restrictions still apply.
Changing an icon must not require renaming a workspace or creating another one.

### Workspace switcher

Keep the workspace name visible in the closed switcher, with its icon immediately beside it.
Show the same icon beside each dropdown row. Keep filtering, active-row indication, project counts,
Node labels, and the **Add project** action.

Use a shared workspace appearance renderer for the selected value, dropdown rows, settings preview,
and rail. These places differ in size, not in which appearance they resolve.

### Optional workspace rail

When **Show workspace rail** is enabled, place the rail before the source/task rail in the desktop
shell body. Both start below the top bar. Use the shared `--tabrail-w` width token and rail control
geometry, so all style packs preserve the relationship between rails and pane headers.

Show workspace tiles vertically, with an explicit selected indicator outside the icon artwork.
Keep hover, focus, and selected states distinguishable when two workspaces share the same icon.
Each tile's tooltip and accessible name identify its workspace.

Use the switcher's workspace roster and ordering. For multiple Nodes, retain Node grouping and
identify the Node in tooltips and accessible names. Key entries by Node and workspace identity.
Preserve the switcher's empty-workspace eligibility and fleet availability behavior.

Clicking a tile invokes the same workspace selection operation as the dropdown. It must switch the
Node before resolving the destination and restore the workspace's remembered view through the
shell's normal transition. Do not maintain independent rail selection or view memory.

Allow the rail to scroll when its tiles exceed the window height. Keep the selected workspace
reachable and reveal it when selection changes through another navigation control. Use Acorn's
rail keyboard and focus conventions, with names and selected state exposed to assistive technology.

Turning the setting on or off changes layout without resetting the workspace, task, panes, or
terminal. The dropdown remains available with the rail enabled. This feature adds no drag ordering,
workspace badges, creation button, or replacement plugin slot.

### Layout and terminal client

Account for the combined width of both left rails in the terminal drawer's normal and maximized
positions. The drawer must not cover either rail. Check pane sizing, footer geometry, collapse
controls, overlays, and native pane webviews after the workspace rail changes width allocation.

Settings remains a full-window layer. The workspace rail does not become a settings navigation rail.

The terminal client ignores workspace appearance metadata and does not fetch icon images. Do not
add the rail setting or icon controls to its UI or configuration help. Its workspace switcher
continues to use workspace names and its established switching behavior.

## Architecture and ownership

Read the owning contracts before building:

- [Workspaces and tasks](../workspaces-and-tasks.md) owns workspace identity and change events.
- [Scope rules](../state-ownership/scope-rules.md) separates Node data from device preferences.
- [Shell hierarchy](../ui-design/shell-hierarchy.md) owns rail geometry and chrome composition.
- [Icons](../ui-design/icons.md) owns glyph resolution and the icon catalogue.
- [Settings pages](../frontend/settings-pages.md) owns the save model.
- [Backup and retention](../data-layer/backup-and-retention.md) owns durable backup contents.

The workspace appearance belongs to core. Plugins do not own its storage or workspace selection.
Keep the appearance renderer presentational, with data supplied by its feature owner.

### Data model and storage

Extend the workspace contract with an optional, versionable appearance value. Represent the
configured modes as a discriminated union: icon with solid background, icon with gradient background,
or image reference. Absence means fallback. Validate glyph names, colours, gradients, and image
references at the API boundary. An appearance-only patch must not require a name change.

Migrate workspace data additively. Workspaces without appearance metadata remain valid, and clients
that ignore the additional metadata must still list and select them. Preserve identifiers, ordering,
projects, and workspace-owned data. Missing metadata from a Node reads as fallback.

Uploaded icons are durable workspace data. Keep their bytes on the owning Node and include them
in backup and restore. The ordinary blob cache is excluded from backups, so an unbacked cache entry
cannot be the only copy. Prefer bounded thumbnail storage in core's database if it fits the storage
contracts; any separate asset store must explicitly integrate with backups and retention.

Use immutable or revisioned image references so replacement cannot leave another client displaying
stale bytes. Complete image storage before committing its workspace reference. A failed replacement
must preserve the previous reference. Release unreferenced uploads and replaced or deleted images
without removing bytes still referenced by another workspace.

### Data flow and contracts

Use one data flow for both desktop navigation controls:

1. Workspace settings sends a validated appearance change or image upload through the Node broker.
2. Core saves the appearance and any durable image, then publishes `workspace:changed`.
3. The owning Node's workspace queries and fleet roster refresh their metadata.
4. The shell supplies that metadata to the switcher and workspace rail.
5. Image consumers fetch bytes through the broker and resolve them for desktop display.
6. Both navigation controls invoke the shared workspace selection operation.

Keep image bytes out of workspace list responses, preference blobs, and replacement top-bar data.
Extend the public top-bar data contract with optional appearance metadata so offered top bars can
draw the same identity. Keep that contract serializable and compatible with providers that omit icons.

Images must load through the authenticated Node transport, including for inactive Nodes in the fleet.
A Node API route cannot be used directly as an image `src` under the renderer's app origin.
Reuse broker upload and byte-read operations, cache by Node and immutable image identity, and dispose
local image resources when they are replaced or their consumer is released. Avoid a separate polling
loop, duplicate reads for every tile, or an image request on each render.

Register rail visibility as a desktop device preference with one reader and writer. Integrate it
with the desktop's device configuration convention without teaching the TUI to offer the feature.
Rail visibility must not depend on the active Node or the workspace being edited.

## Implementation sequence

Implement and verify these slices in order:

1. Add the typed appearance contract, additive migration, validation, durable image storage,
   backup behavior, mutation operations, and workspace change propagation.
2. Add the shared appearance renderer and workspace settings editor, including image crop,
   failed-save behavior, replacement, removal, and fallback.
3. Supply appearance metadata through the public top-bar contract and render it in both switcher
   positions. Verify multiple Nodes and replacement top bars.
4. Add the desktop preference and workspace rail, reusing selection and restore behavior. Adjust
   shared layout geometry and verify desktop and terminal client acceptance.

Starting points include these owners. Verify their location and contracts in the implementation checkout:

| Concern | Owner to inspect |
| --- | --- |
| Workspace tables and routes | `packages/node-core/src/server/db/schema.ts`, `packages/node-core/src/server/routes/projects/workspaces.ts` |
| Workspace wire types | `packages/protocol/src/transport/api/projects.ts` |
| Settings and mutations | `packages/client-core/src/features/settings/WorkspaceSettings.tsx`, `packages/client-core/src/features/workspaces/workspaceMutations.ts` |
| Fleet switching and restore | `packages/client-core/src/features/workspaces/fleetWorkspaces.ts`, `packages/client-core/src/features/workspaces/workspaceViewTransition.ts` |
| Change propagation | `packages/client-core/src/features/workspaces/watchWorkspaceChanges.ts` |
| Top bar and public data | `packages/client-core/src/host/chrome/Topbar.tsx`, `packages/protocol/src/chrome/surfaces.ts` |
| Picker and rail controls | `packages/client-core/src/kit/components/inputs/Picker.tsx`, `packages/client-core/src/features/tabs/RailTab.tsx` |
| Desktop composition and drawer offsets | `apps/desktop/src/client/App.tsx`, `packages/client-core/src/infra/styles/overlays.css` |
| Device preferences | `packages/client-core/src/infra/persistence/devicePrefs.ts`, `packages/client-core/src/features/settings/AppearanceSettings.tsx` |
| Upload and image reads | `packages/client-core/src/infra/node/apiClient.ts` |
| Terminal settings projection | `apps/tui/src/chrome/settingsPages.tsx` |

## Acceptance and verification

The implementation is complete when these observable behaviors pass:

- A workspace can save an icon with a solid background, an icon with a gradient, or an uploaded
  image. Replacement, reset, crop cancellation, and failed-save recovery work.
- The selected switcher label and each dropdown entry show the same workspace appearance with the
  rail off and on. Names, filtering, active indication, and Node identification remain usable.
- The rail is off by default, follows the device after relaunch, and does not follow Node switches.
  Enabling or disabling it preserves the active task and mounted pane state.
- Both left rails use the same width across style packs. Tiles remain distinguishable in light and
  dark themes, and keyboard users can identify and activate them without relying on colour.
- Rail and dropdown switching select the same workspace and restore its remembered task or source.
  Cross-Node selection resolves against the destination Node, including duplicate workspace names.
- A long workspace roster scrolls without clipping the selected tile. Rail collapse, narrow windows,
  the terminal drawer, maximized terminal, and native pane webviews respect the combined rail width.
- Saving an icon refreshes paired desktop clients and fleet entries. Image replacement shows the
  saved revision, and late fetches cannot overwrite a replacement or another Node's icon.
- Missing or unavailable image bytes show initials without breaking selection. Workspace lists
  remain usable while images load, and do not carry the uploaded image bodies.
- Images survive relaunch and backup/restore. Deleting a workspace or replacing its image leaves
  no permanent orphan upload and preserves any image still referenced elsewhere.
- Invalid appearance values and unsupported, corrupt, or oversized image uploads fail at the Node
  boundary without changing the saved icon. Workspaces without metadata remain readable.
- The TUI has no workspace rail, icon editor, rail option, or icon image fetches. Workspace changes
  continue through its workspace switcher, including after desktop icon edits.

Add focused behavior tests for persistence, validation, failed replacement, change propagation,
cross-Node selection, image freshness, preference scope, and backup coverage. Reuse workspace restore
tests where they already prove navigation. Avoid tests that only restate component structure.

Run `pnpm lint`, the full suites for touched packages and their consumers, and
`pnpm --filter @acorn/arch-tests test`. Use the [desktop agent driver](../local-development/agent-drivers.md)
to inspect screenshots of both switcher states, both icon types, the enabled rail, and terminal drawer
geometry. Use the terminal driver to verify workspace switching and the absence of desktop controls.
Stop both sessions after verification.

Update the owning workspace, shell hierarchy, settings, state ownership, API, and backup documentation
when the behavior ships. Replace the explicit no-icon statement in the workspace reference at that
point. Keep this proposal's implementation evidence separate from shipped reference behavior.

## Verify before building

Confirm these assumptions against the implementation checkout:

- Recheck workspace navigation, fleet event invalidation, remembered-view restoration, and empty
  workspace eligibility before sharing them between the two desktop controls.
- Inspect icon, colour, picker, settings save, tooltip, and rail components before adding controls.
- Trace the appearance through database, route, protocol, broker, client cache, public chrome data,
  and desktop renderers. Confirm that the TUI ignores it without loading image machinery.
- Check broker request limits, renderer image policy, available image processing facilities, and
  thumbnail resource lifetimes before choosing the image format and numeric admission limits.
- Verify durable image storage against backup/restore and deletion paths, including partial uploads.
- Recheck device preference and configuration ownership, all rail-dependent layout offsets, and
  replacement top-bar compatibility.

Paths in this proposal are starting points. Preserve these requirements if the owning modules move.

## Implementation evidence — October 7, 2026

Implemented behavior is documented in [Workspace icons](../workspaces-and-tasks/workspace-icons.md).

- Route tests cover solid and gradient metadata, normalized PNG/JPEG/WebP crops, invalid inputs,
  failed replacement, shared image retention, reset, deletion, and durable backup bytes.
- Client tests cover inactive-Node workspace events, image sharing and disposal, late reads,
  fallback, device configuration, and the shared fleet refresh race found in desktop verification.
- The packaged startup test saves a catalogue glyph and uploads and reads a normalized image
  through the staged helper, including its native image decoder.
- Desktop driver checks cover icon saves, crop cancellation, failed upload and retry, reset,
  switcher and rail agreement, relaunch, keyboard activation, remembered-task restoration, and a
  33-workspace scroller. Toggling the rail preserves the task, pane, and running terminal DOM.
  All four style packs keep equal rail widths; normal and maximized drawers respect both rails,
  including an 800-pixel window. Light and dark screenshots were inspected.
- The terminal driver retains named workspace switching and offers no desktop icon or rail controls.
  Cross-Node identity and switching use automated coverage; a second live Node and native child
  webview interaction were not exercised by the drivers.

The full test run encounters existing fixture failures in the Node route inventory, frame route
inventory, CSS shadow ratchet, and desktop plugin registry expectations. The added feature tests
pass. Architecture, lint, migration checks, packaged startup, and Rust tests pass independently.
