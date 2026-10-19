# Rail presentation and artwork

This page covers live artwork and words on a rail source's button, and how the host reads and checks
a plugin's pictures for that button and for the `Artwork` component. It's part of the [plugin
reference](../plugins.md), beside [descriptors](./descriptors.md).

## Rail presentation

A source can put live artwork and words on its rail button with `railPresentation`, such as the
cover and title of the song that's playing. It names a GET route in the plugin's own namespace and an
optional `refresh` with the [descriptor refresh rules](./freshness.md):

```json
{ "railPresentation": { "data": "/v1/p/music/now-playing", "refresh": 60 } }
```

The route answers `PluginRailPresentation` from `@acorn/protocol/api.ts`, or `null` for the static
glyph and label:

```json
{
  "artwork": { "path": "/v1/p/music/art/cover-42", "revision": "cover-42", "alt": "Album cover" },
  "tooltip": { "title": "Example song", "detail": "Example artist\nExample album" }
}
```

The `acme-tracker` example answers one, with its picture, in
`examples/plugins/acme-tracker/server/routes.js`.

`tooltip.title` takes up to 80 characters and `tooltip.detail` up to 1,024. Both are plain text, and
line breaks in `detail` are kept. Leave out `artwork` to keep the glyph and still show the words. The
client reads at most 32 KiB. An answer it can't parse, or one whose artwork path is outside the
plugin's routes, draws the static button and logs the plugin and the field, never the words.

The declaration changes only what the button shows. Its place on the rail, its label, its click,
drag, context menu, markers, and visibility setting stay as they are. The label stays the button's
accessible name. The tooltip draws the label, then the title and the detail, then the marker legend,
and a screen reader gets the words as the button's description, which isn't announced when it
changes.

The host reads the route while the button is drawn, whatever source is open, and reads nothing for a
hidden button. No plugin frame or tree worker is involved. Freshness is the rest of the chrome's: the
declared `refresh`, `ctx.events.status()`, and the plugin's own channel. When a read fails, or the
Node goes offline, the button keeps the last answer and the legend says it isn't updating. The
answer is cached per Node, plugin, source, and registration, so a plugin update, reload, or trust
change starts from nothing. Because a Node switch remounts the shell, Node A's answer never draws
under Node B.

The desktop draws the artwork in the glyph's place with `Artwork`'s `rail` preset, and the glyph
stands in while the picture loads or when it fails. The terminal draws the title after the source's
name in **Menu**, and the menu key lists every line of the words. It never reads the artwork.

A compiled source returns the same information from `createRailPresentation` on
`SourceContribution`, which the host calls once per drawn button inside that button's reactive owner
(`packages/client-core/src/host/registries/sources/sources.ts`). The loaded version is
`packages/client-core/src/host/chrome/railPresentation.ts`. The desktop button is drawn in
`packages/client-core/src/features/tabs/TabRail.tsx`, and the terminal row in
`apps/tui/src/chrome/Rail.tsx`.

## Artwork bytes

An artwork reference is `{ path, revision, alt }` (`@acorn/protocol/artwork.ts`). `path` is a GET
route on the plugin's Node half, up to 2,048 characters. `revision` names the bytes, up to 128
characters, and `alt` says what they show, up to 160. Clients share one read for each Node, plugin,
path, and revision, so a path must always answer the same bytes. Give a changed picture a new path
and a new revision. A route that answers whichever cover is playing at request time doesn't work.

The host binds the Node and plugin from the registration or tree mount that drew the reference. The
reference can't name either. The client resolves the path, then refuses it unless it stays in the
plugin's `/v1/p/<id>/` namespace with no other origin, credentials, fragment, or backslash
(`ownedPluginPath` in `packages/client-core/src/host/chrome/ownership.ts`). It reads the bytes
through the authenticated broker and never puts a Node address or a provider URL in an image element.

The answer must be a static PNG, JPEG, or WebP picture of at most 5 MiB and 16 million pixels, the
workspace image ceilings. The client checks the format and size from the bytes, refuses an animated
PNG or WebP and a content type that disagrees with the bytes, and decodes the picture before it makes
a local object URL (`packages/client-core/src/host/artwork/`). A window reads at most four pictures at
once and holds at most 32 MiB of them. Past that, a picture draws its fallback until a release makes
room. The last consumer to leave revokes the object URL. A failure logs the plugin and a category,
such as `type` or `animated`, once per read, and raises no toast.

The plugin owns everything before its route: provider sign-in, polling, and a bounded cache of
provider state and image bytes. Its Node network permission covers the provider downloads. The host
stores no presentation or object URL in preferences.
