# Document surfaces and webviews

This page covers the two host-drawn surfaces a loaded plugin can declare without drawing them: a text
document the host's editor draws, and an external web page in a shell-owned webview. It's part of the
[plugin reference](../plugins.md).

## Document surfaces

A `pane` surface names a `layout` and fills its `regions`. A region is a host-drawn document, a
remote tree, or `"frame"`, the plugin's own iframe. [Pane layouts](../panes/layout.md) lists every
layout and its regions. Two matter for documents: `single`, where the whole pane is one document, and
`document-over-frame`, where a document sits above the plugin's own region with a host-owned drag
handle between them.

```json
{
  "contributions": {
    "frames": [{
      "target": "pane", "id": "scratch", "label": "Scratch", "glyph": "file-text",
      "layout": "single",
      "regions": {
        "body": {
          "kind": "document",
          "languageId": "sql",
          "read": "/v1/p/board/tasks/:taskId/scratch",
          "write": "/v1/p/board/tasks/:taskId/scratch"
        }
      }
    }]
  }
}
```

`read` answers `GET` with `{ text }`, and `write` receives `PUT { text }`. The host does the rest: the
editor, its theme, its workers, the dirty state, autosave, ⌘S, the flush before unmount, and the
scroll and cursor position across remounts. Leave out `write` for a read-only document. `languageId`
comes from a published vocabulary (`@acorn/protocol/languageIds.ts`), so an unknown one is a parse
error. Only `:taskId` and `:projectId` are substituted into a route, and both routes are confined to
the plugin's own namespace at parse time and again on the device.

A document region doesn't expose editor internals. A pane with no `frame` or tree region runs no
plugin code on the device, so it's gated like a descriptor: it needs no client bundle and no trust
prompt. A composed pane that also has a frame or tree region needs an accepted bundle, like any other
frame.

[The document surface](../editor/document-surface.md) owns the contract, the view state, and
[language smarts](../editor/document-surface.md#language-smarts), such as completion routes.
[Composed panes](../editor/composed-panes.md) owns `document-over-frame`, the document API a frame
uses, and surface actions.

<a id="document-over-frame"></a>
<a id="language-smarts"></a>

## Webviews

A webview is a host-drawn pane backed by a shell-owned child webview:

```json
{
  "target": "webview",
  "id": "docs",
  "label": "Docs",
  "url": "https://docs.example.com/",
  "hosts": ["docs.example.com", "*.example.com"]
}
```

A surface declares exactly one literal `url` or a plugin-owned `urlSource`, plus a non-empty `hosts`
allowlist. `urlSource` replaces `url` when the start URL is dynamic. It must be inside the plugin's
own `/v1/p/<id>/` namespace, answers `{ "url": "..." }`, and receives task and project ids as query
parameters when present.

HTTPS is required except for `localhost`, `127.0.0.1`, and `::1`. The renderer's broker validates a
requested navigation, and the shell enforces the same list on direct navigation and redirects. The
page has an isolated ephemeral partition, no preload, no CDP, no devtools, no tunnel credentials, and
no script or message bridge. A webview needs a client bundle. The plugin's sandboxed client frame
controls only `navigate`, `back`, `forward`, and `reload`, and it can't read the page or type into
it. [Host-owned webviews](../shell/webviews.md) covers the shell side.

The trust prompt lists webview hosts separately from the networkless UI scopes, because a remote page
has live network access.
