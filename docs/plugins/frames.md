# Frames

[Back to plugins](../plugins.md)

## Frames

A pane, reference panel, settings page, project importer, or full-screen overlay picker that the
plugin draws itself. A `pane` declares a `scope` of `task` (the default, and what a pane has always meant: a
rectangle in a task's layout) or `project`, in which case it is drawn beside its own rail Source's
list at `/p/:projectId` with no task involved. A project-scoped pane must declare a `routes` entry
addressing it and a source whose `onSelect` navigates to it — those are its address and its only
mount site, and a manifest missing either is rejected rather than shipping a surface that can never
appear. Each renders in an iframe on `app-plugin://<bundle-hash>`, a scheme the shell serves
from its content-addressed cache with `connect-src 'none'`: the frame has no network, no
`window.acorn`, and no reach into the shell. Its only I/O is one `MessagePort`, where every call
is checked against the manifest's declared scopes by an allowlist naming each path and method
(`packages/client-core/src/host/frames/`, `scopes.ts` is the choke point). The host pins which
Node the frame talks to; the frame cannot name one. A `refPanel` frame is one of the two surfaces whose
surrounding chrome the host draws rather than the plugin (`overlay` is the other): an iframe cannot
`Portal` out of the box its consumer placed it in, and the bridge's close verb does not reach a
reference panel — it is granted to importers and overlays only — so the manifest adapter
supplies the drawer and its dismiss control while the frame supplies the body. It is also the one
surface no plugin *mounts*: the shell holds which ref is open and draws it in one place
(`client-core/host/registries/panes/refPanels.ts` + `refPanelHost.tsx`), so any surface that renders content can
call `openRefPanel({ providerId, displayId })` and get any provider's panel. One at a time, on
purpose — a stack of reference panels is a navigation history, which is what panes and routes are for
— and `openRefPanel` returns `false` rather than opening an empty overlay when that provider has no
panel installed on this device. A panel's props name its subject `target`, never `ref`: `ref` is a
reserved JSX attribute that Solid compiles into a DOM setter, so a props member of that name silently
arrives as a function instead of data. `tools/arch/boundaries.test.ts` holds the line, because
TypeScript cannot — Solid declares `ref` on `IntrinsicAttributes`.

A frame's boot is one call. `mountFrame({ styles }, (bridge, root) => …)` on `/ui/sdk` injects the
plugin's inlined stylesheet, makes the root element, mounts the frame-side tooltip listener (a frame
has its own document, so the shell's delegated singleton cannot see it and every `data-tip` inside
is otherwise inert), waits for the bridge, and paints an alert banner on the root if the handshake
never lands. It takes a render CALLBACK rather than a component so the entrypoint stays
framework-free: the four first-party frames happen to use Solid, the sandbox allows anything.

A frame has to say hello. The SDK posts one `connected` message the moment `connect()` resolves, and
the host starts a deadline when it transfers the port: a frame that never sends anything is replaced by
a labelled "This plugin’s UI failed to start" placeholder instead of staying a blank rectangle, which
is what a bundle throwing at module scope used to render. Any message counts as the acknowledgement, so
a bundle built before the ack existed clears the deadline as soon as it calls the bridge; a purely
static frame from such a bundle needs rebuilding. A surface the device could not register at all —
usually a contribution id something else already owns — is skipped so the rest of the plugin still
works, and reported in the attention inbox rather than only in the console.

**A loaded plugin's ids sit inside its own namespace.** Contribution ids are un-namespaced by design:
`pr`, `changes` and `terminal.drawer` double as persisted layout keys and chord targets, so they cannot
carry an arbitrary prefix. Plugin-versus-plugin collisions fail loudly, which is fine. The one that
did not was a collision with a *future core id*: core adds a pane called `notes`, an installed plugin
already registered one, and core loses a first-come race against a package the owner installed.
Nothing announced it.

So a loaded plugin's pane, source and slot ids have to equal its plugin id or start with `<id>-` or
`<id>.`, and one that does not is bound to `<pluginId>.<id>`. What counts as inside is the shape the
first-party packages already use — `database`, `http-requests`, `linear-issue` — which is why this
cost nothing to introduce: every id that has ever shipped already passes, so no saved layout moves and
there is no alias map. Commands were already qualified as `plugin.<pluginId>.<commandId>`.

The binding happens once, where the device reads the roster row
(`packages/client-core/src/host/plugins/contributionIds.ts`), rewriting the declaration and every reference
to it — `action.pane`, `action.surface`, `action.overlay`, `routes[].surface`, `contentLinks[].pane`.
Doing it at each registration site would be the same change made in eleven places and wrong in
whichever one got missed. Compiled plugins are untouched: they are the app, and an id they collide
with core on is a duplicate registration that fails in `pnpm test`.

The bridge's `api` surface is five verbs — `get`, `post`, `put`, `patch`, `del` — matching
`PluginBridgeApiRequest.method` exactly. That last part is the rule rather than a coincidence: a method
missing from the SDK facade is a method no plugin can reach, however permissive the scope table
underneath, and `put` was missing for exactly that reason until http (whose own updates take a
full-replacement body) could not call its own routes from its own frame. `frames/verbs.ts` is what
makes that class of bug a compile error now: it derives the wire union, the author-facing surface
(`sdk.ts`) and the host-facing surface (`PluginFrame.tsx`, through `FrameServices`) from one verb list,
with two `Covers<>` assertions that fail the build the moment a verb lands on the wire without a row on
either surface, or gains a surface row the wire does not carry.

Three verbs are named in that file as asking nothing of the services bag: `cancel`, which makes the
broker drop its own record of an in-flight request, `connected`, which is the frame's evidence that
it evaluated, and `telemetry`, which the broker emits through the emitter it already holds for its
own histograms ([telemetry.md](../telemetry.md) § A frame's own records). A record is not an effect
on the shell, so routing it through `FrameServices` would mean threading an implementation through
`PluginFrame.tsx` and the worker path to buy nothing.

### Binary bridge calls

Those five verbs stringify and parse everything. For a route whose body is bytes — an image, a PDF, an
archive — that costs a third more on the wire as base64, two copies in memory, and a decode at each
end, for content the host was already carrying as bytes. So there are two more:

```ts
const { bytes, type, filename } = await bridge.api.getBytes('/v2/p/image-markup/files/a1')
await bridge.api.postBytes('/v2/p/image-markup/files', { bytes, type: 'image/png', filename: 'a.png' })
```

A separate wire kind, `api.bytes`, rather than a flag on the JSON one, so a JSON call can never
acquire byte semantics by getting a field wrong. What the two share is the one thing that matters:
`allowApi` decides the path before either handler looks at a body. Your own `/v2/p/<id>/` namespace is
reachable and another plugin's is refused, byte call or not, and a 12 MiB POST at somebody else's
namespace is denied without being read. The desktop end-to-end suite pins that by spying at the broker.

GET and POST only, capped at 12 MiB either way: above the agents store's 10 MiB attachment limit, low
enough to be an explicit memory bound. No streaming — the desktop broker fully buffers a node response
already, so a chunked API here would be a shape with no transport under it.

`type` and `filename` are advisory in both directions. Whatever receives the bytes decides what they
really are; the agents attachment store, for one, re-sniffs magic bytes and re-normalizes the name.

Almost none of this was new transport. `infra/node/apiClient.ts` has carried a `Uint8Array` body from
the broker since it was written; the only reason a frame could not reach it was that `frameServices`
hard-coded JSON in both directions.

Two browser affordances a frame does NOT have, both worth knowing before writing one. `window.confirm`
and `alert` are suppressed: the iframe is sandboxed `allow-scripts allow-same-origin` and deliberately
not `allow-modals`, so `confirm()` returns false and a guarded action silently does nothing. And
`navigator.clipboard` refuses to write, because the frame's document is not the focused one from the
shell's point of view — `bridge.ui.copy` exists for that, and a confirmation is the frame's own UI to
draw (two clicks, an inline undo, whatever fits) rather than a host verb.

A link inside a frame's own rendered content reaches the shell through `bridge.ui.openUrl(url)`,
because the anchor itself cannot go anywhere: the iframe has no `allow-popups` and the shell pins every
subframe to its own origin. The frame passes a URL and learns nothing back. The host validates the
scheme at the boundary — `https` only, the same policy a manifest's `openUrl` descriptor verb is held
to (`@acorn/protocol/externalUrl.ts`), so `file:`, `javascript:`, `data:` and the frame's own
`app-plugin://` origin are all refused. A navigation must also be a person's act: the verb is honoured
only while the frame itself holds focus — which a real click or keypress inside its document gives it —
and at most once per second, so background code cannot move the reader and a hostile frame cannot spam
the browser. A frame using `openLinkOnClick` satisfies both for free. Then the host runs the same
content-link ladder every shell surface
runs: in-app when a recogniser claims the URL, the owner's browser otherwise. *Which* in-app
presentation is inferred from the calling surface, not asked of the frame: a link clicked inside a
reference panel swaps that panel's subject, and one inside a pane opens the pane. The SDK's
`openLinkOnClick(bridge, event)` is the delegated anchor handler on top of it, so a frame does not
hand-roll the plumbing; unlike the shell's equivalent it takes modified clicks too, because in a frame
there is no browser default for cmd-click to preserve.


## Remote trees

The second render path, and the one to reach for unless the surface genuinely owns
its pixels. The bundle runs in a Web Worker with no DOM and emits a *tree*: names of the host's own
components, with props, as a stream of mutations. The host mounts its components for those names, so
the result has the shell's focus handling, keyboard model, ARIA and the reader's style pack, none of
which an iframe can borrow. Every loaded plugin acorn ships draws this way.

Two ways to declare one, and they differ only in who owns the rectangle. A **region** of a surface
this plugin declares names `{ "kind": "remote", "entry": "<name>" }` in its `regions` — that is how
the panes, reference panels and settings pages of `http`, `database`, `linear` and `rollbar` draw. A
**contribution into somebody else's point** is a `contributions.extensions` entry with a `remote` key,
which declares which host surface it fills and what it matches. The agents pane opens three:
`agents:tool-card`, keyed by the tool name a harness reports; `agents:attachment`, keyed by an
attachment's media type; and `agents:composer-actions`, which stacks up to four contributors in the
composer's action bar. The Changes pane opens `changes:push-actions` under its branch bar. § Cooperative
extension points has the full list with the props each one hands over.

An author writes the same code either way. `mountTree({ toolCard: … })` on `/ui/sdk` is the entry point
beside `mountFrame`, keyed by name because one worker serves every tree the bundle contributes and the
host has to say which. With a bundler, `@acorn/plugin-api/ui/tree` (published as
`acorn-plugin-sdk/remote`) carries the Solid adapter and the kit as nodes you write in JSX; without
one, `npm create acorn-plugin <name> -- --remote` emits a single file that builds the same tree by
hand.

What crosses is data, all the way down. A handler is an id the host mints a closure for, never a
function; text is a node, never a prop; `class`, `style` and every other door into the host's DOM are
dropped with a row on the plugin's page; a node name this build does not know draws a labelled
placeholder, which is the forward-compatibility rule above applied to drawing. A batch applies whole or
not at all, and a worker that stops answering is terminated with a placeholder in every tree it served.
The wire is `@acorn/protocol/tree/`, the host is `client-core/src/host/tree/`, and
`docs/shell.md § The plugin worker` has the sandbox.

Two things a tree is not for. Anything that must react per keystroke — a live filter over a large list,
a query editor with completions — is a message hop per key and should be a frame. And a surface whose
pixels are the product, an image editor or a charting library, is a frame by definition.

## Document surfaces

A pane whose editor the **host** draws, with the plugin supplying only the
document. A `pane` surface names a `layout` and fills its `regions`, and a region is a host-drawn
document, a remote tree, or `"frame"`, the plugin's own bundle in an iframe. `docs/panes.md` § Layout
model lists every layout and its regions; the two that matter here are `single`, where the whole pane is one
text document, and `document-over-frame`, where that document sits above the plugin's own region
with a host-owned drag handle between them. That lower region is a tree in every shipped case; the
region keeps the name its layout gave it.

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
          "read": "/v2/p/board/tasks/:taskId/scratch",
          "write": "/v2/p/board/tasks/:taskId/scratch"
        }
      }
    }]
  }
}
```

That is the entire job: `read` answers `GET → { text }`, `write` receives `PUT { text }`, and the
host does the rest — the editor instance, its theme, its workers, the dirty model, the autosave
debounce, ⌘S, the flush before unmount, and the scroll/cursor position across remounts (keyed by
node, scope and document, and evicted when a task or workspace is). Omitting `write` is a real mode
rather than a degenerate one: the surface is read-only, which is what a rendered template or a
generated migration wants. `languageId` comes from a published vocabulary
(`@acorn/protocol/languageIds.ts`, LSP's spellings) so an unknown one is a parse error rather than a
document that silently renders as plain text; the host maps it onto whichever engine draws it. Only
`:taskId` and `:projectId` are substituted into a route — those are the two values the host holds —
and both routes are confined to the plugin's own namespace at parse time and again on the device.

The host owns the document editor and maps text onto its desktop or terminal implementation.
A document region does not expose editor internals to the plugin. Use remote trees for shared UI,
collections for host-owned record views, and frames for browser-specific rendering.
For editor behavior, see [Editor](../editor.md). For collection contracts, see
[Dashboards](../dashboards.md).

Because a pane with no `frame` region runs no plugin code on the device, it is gated like a **descriptor**
rather than like a frame: no bytes execute, so there is nothing for a bytes-hash trust prompt to be
about, and a plugin that ships only document surfaces needs no client bundle at all. The ceiling is
the honest one — a declarative contract gives a plugin the editor's *features*, not its *API*. No
decorations, no inline widgets, no arbitrary providers. Capabilities grow only as LSP-shaped
request/response routes (completions first, when a consumer needs them), never as "run my code
inside the editor".

`layout` is region-addressed rather than whole-pane-addressed, and that was decided before there were
layouts to address: a whole-pane declaration would have meant something different once a second
arrangement arrived, and changing that later would change what already-published manifests mean.
`frame-beside-document` exists and lands with its consumer, the editor plugin. The design record is
`docs/editor.md`, and `docs/panes.md § Layout model` owns the layout set.

### `document-over-frame`

```
┌──────────────────────────────────┐
│ host document surface (sql)      │  host: the editor, theme, workers, dirty state, ⌘S, view state
├──────────────────────────────────┤  host: the drag handle
│ [picker] [Save] [Generate] [Run] │  the plugin's frame starts here
│ results grid                     │
└──────────────────────────────────┘
```

The host composes this, and the plugin could not: the frame CSP has `frame-src 'none'`, so a plugin
can never embed host content inside its own layout. That restriction binds the plugin and not the
host, which is the whole shape of the design — the host places its editor and the plugin's iframe as
siblings in its own DOM.

A composed pane runs plugin code in half its rectangle, so unlike a wholly host-drawn one it needs an
accepted bytes hash and a client bundle exactly like any other frame. It is not a cheaper way to run
untrusted code.

What is deliberately *not* a region: the button bar. `plugins/database`'s bar holds a searchable
saved-query picker with per-row delete chips, a Generate button visible only when a model connection
exists, and an Execute button disabled on connection status. A host-drawn "action bar" descriptor
sounds cheap until it needs all three. The bar is common, not impossible, so it is the plugin's — the
first row of its own frame region. Modals are the one honest compromise: a frame confined to the
bottom region can only overlay the bottom region, and the escape hatch if that grates is the
`overlay` frame target rather than a widened template.

**Two regions, no shared realm.** The editor is in the shell and the frame is a sandboxed iframe, so
everything between them goes through the host, in two directions:

- **Frame → host: `bridge.document`.** `read()` is the current text including keystrokes the autosave
  has not written yet; `write(text)` goes through the model, so it joins the undo stack and schedules
  the same autosave typing would; `flush()` writes anything pending to the plugin's own write route.
  Three methods, each with a proven consumer. There is deliberately nothing about the EDITOR — no
  cursor, no selection, no decorations — because those are host state or LSP-shaped routes. The verb
  is gated structurally rather than by a declared scope: a frame either has a document beside it or it
  does not, and which one is a fact about the manifest the host already read.
- **Host → frame: surface actions.** A chord like `⌘Enter` is pressed with focus inside the host's
  editor, where the frame has no keyboard at all. A `commands` entry declares
  `{ "verb": "surfaceAction", "surface": "<pane id>" }` and a `keybindings` entry with
  `when: "surface"` binds the chord. The host resolves it, **flushes the document**, then posts the
  command id over the frame's bridge, where `acorn.onSurfaceAction` receives it. The flush is a
  contract guarantee, not an implementation detail: without it every plugin independently rediscovers
  "it ran the previous version of my query". A frame handles the command exactly as it would its own
  button click, and is not told which gesture produced it.

### Language smarts

A document region may declare `completions: { route, triggerCharacters }`. The host POSTs
`{ text, position }` (1-based line and column) and renders the `{ label, kind, insertText, detail }`
items that come back. **The host never learns the language**: context detection is the plugin's, on
its node half, where the schema knowledge already lives — which is exactly what lets a SQL console, a
GraphQL console and a YAML config plugin share one host provider with no host change.

The growth rule this sets as precedent: **capabilities grow as LSP-shaped request/response routes —
position and text in, standard items out — never as "run my code inside the editor".** Hover and
diagnostics can follow the same shape when a real consumer needs them. Custom widgets, decorations
and inline UI cannot, and the test for any proposed addition is "is this an LSP method". The wire
shapes are `@acorn/protocol/documentSurface.ts`; the kinds are LSP's names rather than its magic
numbers, because this wire is read by plugin authors and not by an LSP client.

## Webviews

A host-drawn pane backed by a shell-owned child webview. A surface declares exactly one literal `url`
or plugin-owned `urlSource` plus a non-empty `hosts` allowlist. HTTPS is required except for
`localhost`, `127.0.0.1`, and `::1`; the renderer broker validates requested navigation and the shell
enforces the same list on direct navigation and redirects. The page has an
isolated ephemeral partition, no preload, no CDP, no devtools, no tunnel credentials, and no script
or message bridge. The plugin's sandboxed client frame remains the controller for only
`navigate`, `back`, `forward`, and `reload`; it cannot read the page or type into it.
