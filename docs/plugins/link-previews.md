# Link previews

This page covers `core:link-preview`, the point that lets a plugin draw a preview of an HTTPS link in
rendered content. It's part of the [plugin reference](../plugins.md), beside
[remote points](./remote-points.md).

## Link previews

`core:link-preview` draws a preview of an HTTPS link in rendered content: Markdown, provider HTML such
as a pull request body, and kit `Link` nodes in plugin trees. Declare a contributor with its sites:

```json
{ "id": "docs-preview", "point": "core:link-preview", "label": "Documentation",
  "matches": ["https://docs.example.com/*"], "remote": "docsPreview" }
```

The key is the URL as `URL` parses it. The host is lowercased, and the path, query, and fragment stay
as written. A URL longer than 4,096 characters, or one carrying a user name or password, gets no
preview. `ref` is `{ kind, id }` when an in-app link recognizer already claimed the URL, such as
`{ kind: 'linear.issue', id: 'ENG-1' }`. The scope is the task or project of the link's content.

Read your data from your own Node route with the URL, and check the allowed hosts, redirects,
response size, and timeout there. The host fetches nothing. With no contributor, or while two are tied,
it draws the link's text, the URL, and **Open**. A tree that fails falls back to the same thing.

On the desktop, a preview opens after the pointer rests on a link for 350 ms and closes 150 ms after it
leaves both the link and the preview. One preview is open at a time. Moving to another link your
contributor matches is a props update, so your tree stays mounted. Abort the read for the previous
URL, and drop a late answer for it. Right-click a link, or press Shift+F10 on it, for **Preview**,
**Open link**, and **Copy link**. **Preview** there moves focus into the preview, and Escape gives it
back. The terminal has no hover. Pressing a link inside a pane there offers **Preview** in a dialog.

A content owner opts its region in with `createLinkPreviewBoundary`, from
`packages/client-core/src/host/linkPreview/linkPreview.ts`. It returns event handlers to spread on the
element that already holds the content. Task panes and the shell's project region have one.

## Limits

- A preview is a tree of kit nodes, not a page. Plugin frames can't show an outside website, and
  core adds no network permission for a preview.
- The link menu is the host's. A plugin can't add rows to it.
- Overlays and reference panels have no boundary, so links in them get no preview.
- Focus alone opens nothing. Tabbing through a reply would otherwise open a preview at every link, so
  the keyboard asks through the link menu.
