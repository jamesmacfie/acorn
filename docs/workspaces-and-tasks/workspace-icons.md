# Workspace icons

Workspace appearance belongs to the owning Node. The desktop shows it beside the selected workspace
name and in switcher rows when the workspace rail is hidden, or in the optional workspace rail
when it is shown. Configure it under a workspace's
**General > Icon** setting, including for Default. Resetting an icon restores initials derived from
the workspace name. Missing metadata, unsupported versions, and unavailable images also show initials.

## Appearance and saves

Choose a glyph from Acorn's icon picker and a solid colour or gradient. Colour controls accept the
same presets and six-digit hex values as project colours. Gradients contain two to four colours and
an integer angle from 0 to 360 degrees; the editor offers two colour stops at 135 degrees. A dark
backing keeps the glyph legible across backgrounds and themes.

Glyph and background changes save immediately. The settings preview holds a failed draft for retry;
navigation keeps the saved appearance. Image choices open a square crop with zoom and horizontal
and vertical position controls. **Save image** uploads and saves the crop. **Cancel** leaves the
saved icon intact. Failed uploads keep the crop and file for retry.

The version 1 `WorkspaceAppearance` contract in
`packages/protocol/src/appearance/workspaceAppearance.ts` is a discriminated union:

- `icon`, with a catalogue glyph and either a solid or gradient background.
- `image`, with the SHA-256 identity of a normalized thumbnail.

`Workspace.appearance` and the public top-bar workspace data carry optional metadata only. Absence
means initials. The Node validates catalogue membership during an icon write. The icon census
generates its name list from the renderer's Lucide dependency.

Switcher tiles are 18 pixels square and centered within the caption. Rail tiles follow the pane
header size, capped at 28 pixels. Settings previews use these same sizes.

## Images and limits

The Node accepts PNG, JPEG, and WebP content, regardless of filename or declared MIME type. It
rejects animated, unsupported, corrupt, and oversized images. Limits are:

| Limit | Value |
| --- | --- |
| Upload | 5 MiB |
| Decoded input | 16 million pixels |
| Concurrent normalizations | Two; a further request returns an error for retry |
| Processing timeout | Five seconds |
| Stored thumbnail | 128×128 static PNG, at most 128 KiB |

Sharp normalizes orientation, applies the square crop, resizes, and discards input metadata. The
original upload is discarded. Crop `size` is a fraction of the oriented image's shorter side;
`x` and `y` position the square from 0 to 1 within the remaining horizontal and vertical space.

`POST /v1/core/workspaces/:id/icon-image` accepts multipart `image` bytes and a JSON `crop` field
with `{ x, y, size }`. It answers `{ appearance }`. The Node completes normalization before a
transaction inserts the thumbnail into `workspace_icon_images` and updates the workspace reference.
A failed replacement leaves the saved reference intact. Replaced, reset, and deleted images are
removed once no workspace references them. Identical normalized images can share bytes.

`GET /v1/core/workspaces/icon-images/:imageId` returns `image/png`. Both routes require a paired
device, like the other workspace routes. `PATCH /v1/core/workspaces/:id` accepts `appearance` without
`name`, including `null` to reset. Invalid metadata and missing image references return 400.

Thumbnails are durable bytes in `core.sqlite`, so [backup and restore](../data-layer/backup-and-retention.md)
includes them. The ordinary blob cache holds no required copy.

## Transport and refresh

Successful appearance changes publish `workspace:changed`. Each paired desktop invalidates the
owning Node's workspace cache, including for an inactive Node, and fleet queries refresh the roster.
The shared tile is presentational; its feature owner fetches image bytes through the authenticated
broker and supplies a local object URL. A Node route is never used as the image's renderer URL.

Consumers share reads by Node and immutable image identity. Replacing an image or changing Nodes
releases the preceding resource; late responses cannot replace the active image. The last consumer
releases its object URL. Failed reads leave the stored appearance intact and show initials.

## Optional desktop rail

**Settings > Appearance > Show workspace rail** is off by default. The device preference
`workspace_rail` projects to the desktop's `acorn.json` field `workspaceRail`. It follows the device
across Node changes. The terminal client offers no icon controls or rail option and fetches no images.

In separate mode, the control says **Show project rail**, and the rail uses the paired project
workspaces. The empty-project screen hides both left rails while keeping Settings and Node switching
available.

Showing the rail hides the workspace dropdown in the top bar; hiding the rail restores it. The
public top-bar field `workspacePickerVisible` carries this choice to replacement providers. Hosts
that omit the field retain the dropdown.

The rail sits before the source/task rail below the top bar. It uses `--tabrail-w` and `RailTab`
geometry, with a selection marker outside the artwork. It shares the switcher's roster, ordering,
Node grouping, empty-workspace eligibility, and selection verb. Cross-Node selection changes the
Node before navigation, then the shell restores the workspace's remembered view.

The rail uses the kit's roving focus, arrow navigation, and type-ahead conventions. Labels and
tooltips include the Node name in a fleet. Its scroller reveals the selected tile when selection
changes. The shell publishes `--left-rails-w` on the document root so body portals inherit it;
this allocation keeps normal and maximized terminal drawers clear
of both rails. Toggling the preference changes layout without replacing the task or its panes.
