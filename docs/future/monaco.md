# A host-owned document surface

Design notes from the http-migration session (2026-08-11), when measuring Monaco against the plugin
frame contract ended two migrations; extended the same day when the composed-pane question was worked
through and decided. Companion to [terminal.md](./terminal.md) and [remote.md](./remote.md): this is
the concrete instance of the "one host-owned template" conclusion those two reach in the abstract.

Unlike the other files in this folder, this one is **intended to be built**. The decision on the
record is that the seam gets set up for third-party plugins even while the only consumers are
first-party, on the grounds that a contract retrofitted around existing callers is worse than one
designed before them. What that costs, and every decision a developer needs before starting, are
below. The composed-pane question this file originally left open has since been decided —
§ Composed panes.

**Status: steps 1–6 of § Sequence have shipped.** The consolidation, the published language-id
vocabulary, the contract itself with region addressing and the degenerate `document` template, and then
— with `plugins/database`, which is what step 5 said they would land with — the `document-over-frame`
template, the host splitter, the `bridge.document` API, the flush-before-action guarantee,
surface-action delivery and the completions capability. **The acceptance test this document set for
itself passes: database's ⌘Enter runs the query when the plugin no longer owns the editor.** That
plugin's frame bundle is 156 KB against the 7.93 MiB a bundled Monaco measured.

The contract lives in `docs/plugins.md § Document surfaces`; the code is
`node-core/main/pluginManifest.ts` (the `layout` block and the `surfaceAction` verb),
`client-core/src/editor/` (the surface, its theme, its language map, its view state, the chord
resolution and the completion provider), `client-core/plugins/frames/DocumentOverFrame.tsx` (the
composed template) and `client-core/plugins/frames/documentSurfaces.ts` (the trust and confinement
gate). The wire shapes both ends read are `@acorn/protocol/documentSurface.ts`.

**Step 7 — the editor plugin's own move — is all that remains**, and it still waits on its consumer in
the same way: its template shape and the open-document verb land when that move is planned. What came
out differently from the design is recorded against each step below and, in more detail, in
`docs/third-party/README.md § database has moved`. The rest of this document is the design, kept as
written.

The filename is the search term, not the contract name. See § Naming for why the contract must not
say "monaco" anywhere.

## The question

Two panes embed Monaco — `plugins/editor` and `plugins/database` — and both are stuck first-party
because of it. A single-file Monaco frame measures **7.93 MiB against an 8.00 MiB cap** with a stub UI,
and its language-service workers (**14.58 MiB across four emitted chunks**) cannot be served at all: an
`app-plugin://<hash>` origin serves `/client.js` plus the host's `/ui.css` and nothing else, and the
frame CSP has no `worker-src`, so `default-src 'none'` denies workers including `blob:`
(`docs/third-party/editor.md § Monaco in a frame: measured`).

So: should the app own one editor and lend it to plugins, instead of each plugin shipping its own?

**Yes**, and the reason to prefer it is not convenience. The alternative — multi-file plugin origins
plus `worker-src` — is a permanent widening of the sandbox for every plugin, forever, to serve two
first-party panes. A host-owned surface gets the same outcome and widens nothing.

One misconception to retire before reading on, because it keeps coming back: **"put Monaco in a shared
package plugins import" is not an alternative — it is the measured-dead option wearing different
clothes.** For a compiled first-party plugin, importing from `client-core` genuinely shares the
shell's one copy. For a loaded plugin, importing from a shared package means *bundling*: the build
copies Monaco into that plugin's own `client.js`, and the numbers above apply verbatim, per plugin.
There is no runtime sharing across the sandbox boundary. `@acorn/plugin-api/ui` works as a shared
toolkit precisely because its components are cheap to duplicate into every bundle; Monaco is the case
where that stops being true.

## What is already true

*(As of step 1 the table below is history: every row has been consolidated into
`client-core/editor/`. It is kept because the argument for doing it is the argument for the whole
design.)*

Monaco is already a host-owned singleton, and half of this design exists by accident.

`packages/client-core/src/editor/monacoSetup.ts` assigns `self.MonacoEnvironment` once at the renderer
entry, and its comment says why: it used to be imported by both panes, and "two panes racing to set it
was a real bug." One module, one set of workers, two consumers.

Everything above that line is duplicated, and the duplication is already load-bearing in ways nobody
chose:

| What | Where | Note |
| --- | --- | --- |
| `applyMonacoTheme()` | `EditorPane.tsx` and `DatabasePane.tsx`, verbatim | the database copy is commented *"mirrored here to keep that pane untouched"* |
| A Monaco theme named `app` | both, `defineTheme('app', …)` | the name is **global**. Two plugins write the same global and it works by luck; last writer wins |
| `watchAppearance(applyMonacoTheme)` | both | two subscriptions doing identical work on every theme change |
| extension → language id | `EditorPane.tsx` (`langFor`, falls back to `'plaintext'`) and `client-core/highlight/shiki.ts` (`langFor`, falls back to `'text'`) | two maps, two vocabularies, two fallbacks |

That last row matters more than it looks — see § Naming.

## The constraint that decides the shape

**The plugin frame CSP has `frame-src 'none'`** (`apps/desktop/src/app/main/pluginScheme.ts`). A plugin
frame cannot embed a host editor iframe inside itself. So "host editor nested in a plugin's pane
layout" is unavailable in any form the *plugin* composes. Composition has to be host-side.

This also rules out the tempting version: the host renders Monaco into the shell DOM and positions it
over a hole the frame reports. Two reasons, and the second is fatal.

- Rect updates would ride a `MessagePort` — the bridge is a request/reply channel with a sequence
  counter, not a per-frame geometry stream.
- The host cannot see the frame's **internal** scrolling. The moment a plugin scrolls its own content
  the overlay drifts, and nothing on the host side can know.

We already pay the milder version of this bill for webviews, where the compositing is at least
OS-level: `PluginWebview.tsx` needs a `ResizeObserver`, a window-resize listener, **a 200 ms
`elementFromPoint` occlusion poll**, and a `suppressed` state to keep a host-drawn rectangle honest
about renderer layout. That is the floor for this technique, not the ceiling.

So the shape is the inverse of the intuition: **the host owns the editor surface, and the plugin
supplies the document.**

The restriction has a flip side, and the whole composed-pane answer hangs on it: `frame-src 'none'`
binds the *plugin*, not the host. The host is free to place a host-owned editor and a plugin's iframe
next to each other as siblings in its own DOM. The plugin cannot compose host content; the host can
compose anything. Every question below is really "so who composes, and at what granularity?"

## Why this beats widening the frame contract

Stated plainly because it is the argument that should survive this document:

- **Security.** `worker-src` plus a multi-file plugin origin is a standing grant to every installed
  plugin. A document surface is a grant to none — the editor runs in the shell's realm, which already
  has both.
- **Scale.** Shipped frame bundles: rollbar 84 KB, linear 104 KB, http 604 KB. A Monaco frame is
  7.9 MiB — 15–90× everything we ship. Four plugins bundling it is ~30 MB at four separately-cached
  content-addressed origins.
- **Consistency.** One theme definition, one language map, one save chord, one dirty-state model, one
  "you have unsaved changes" guard — instead of each plugin's approximation of them.
- **DX.** For a third-party author, "declare two routes and a language id" is a much smaller ask than
  "bundle and configure a 7.9 MiB editor correctly." The plugin writes zero editor code and cannot get
  theming, save behaviour or dirty state wrong, because it never owns them.

The two are not mutually exclusive and should not be conflated. A plugin wanting a charting library
with workers still hits the asset wall, and that question stays open on its own merits. A document
surface removes the biggest driver, not the question.

The honest ceiling, named up front so it never surprises anyone: a declarative contract gives plugins
the editor's *features*, not its *API*. No programmatic decorations, no inline widgets, no arbitrary
providers. Anything not expressible as "document + routes + declared capabilities" is off the table —
that is the right trade for the sandbox, and § Language smarts is the rule for how the capability list
grows without breaking it.

## The contract

The plugin declares a surface and the routes behind it; the host draws the whole rectangle. Same
argument every descriptor makes: the data lives on the node, the node is always running, the host
draws the pixels.

What the **plugin** declares (manifest) and serves (its own routes):

- the document's identity and how to fetch it — a `uri`, a route that reads it, a route that writes it
- a `languageId` from a host-published vocabulary
- whether it is editable or read-only
- **its own actions with chords** — see below, this is not optional
- optionally, capability routes (completions today — § Language smarts)
- optionally, a route that lists the documents the surface can open

What the **host** owns, and the plugin therefore cannot get wrong:

- the editor instance, its theme, its appearance-change subscription, its workers
- dirty state, autosave debounce, the save chord, the unsaved-changes guard
- view state (scroll and cursor) across tab swaps and remounts, and its eviction on task archive or
  node switch
- the reserved chord set, which can never be claimed

**Plugin actions inside the editor are a hard requirement, not a nice-to-have.** Today
`DatabasePane.tsx` binds `⌘Enter` into the Monaco instance to run the query, and `EditorPane.tsx` binds
`⌘S` to flush a save. Under a host-owned surface, `⌘S` becomes the host's and `⌘Enter` has to remain
the plugin's. The manifest already has `commands` and `keybindings` with a `when: 'surface'` scope and
a reserved set that cannot be claimed — so the carrier exists and the surface-scoped form is the right
one to reuse. A design that forgets this produces a database pane whose Execute chord silently stops
working, which is exactly the class of regression the http move kept finding.

### View state is the one type that must go opaque

`plugins/editor/src/client/editorViewState.ts` currently stores
`editor.ICodeEditorViewState` — a Monaco type — in a module-level map. That is fine *inside* a plugin
and impossible over a descriptor: the blob cannot cross a contract that does not name Monaco.

The answer is that it stops being the plugin's at all. Scroll and cursor position are host state, keyed
by (node, task, uri), evicted by the host's own scope-eviction signals. The plugin never sees it, which
is both cleaner and one less thing for a frame to persist.

## Naming

The contract must not say "monaco", and the TUI is the weaker half of the argument.

- **`formFactor: ['desktop' | 'mobile']` is already in the manifest schema**, and `remote.md` already
  commits to a mobile shell rendering the same contributions in a different layout. The neutrality is
  justified by a form factor already on the record, not by a speculative terminal client.
- **The name crosses a trust boundary.** Everything a plugin declares is parsed from disk by the host
  and bound to host-owned meaning. A vendor name in that vocabulary is a vendor name in the wire
  format, permanently.
- **There are already two implementations in this repo.** Diff rows highlight with **shiki**
  (`client-core/highlight/shiki.ts`); the editor and database panes edit with **Monaco**. They are not
  interchangeable — shiki is a read-only highlighter — but a read-only document view backed by shiki is
  a real second implementation of the same contract, available today and much smaller. So this is not
  an interface with one implementation, which is the usual and correct objection to a neutral name.

**Use LSP's vocabulary rather than inventing one**: `textDocument`, `uri`, `languageId`, `dirty`. It is
the established vendor-neutral spelling for exactly this, so a terminal or mobile implementation has a
map to follow instead of a guess, and the language-id vocabulary has an obvious canonical source. It
also pays off twice: when the surface grows language smarts, LSP already has the request shapes —
§ Language smarts.

Avoid the word `editor` in the contribution name specifically: `editor` is already a plugin id, and
`EDITOR` is a route capability inside that plugin. A third meaning would be one string with three
owners.

**The trap:** do not build an abstraction *layer* inside the shell. One implementation behind an
internal interface is over-building, and the neutral name does not require one. The shell should call
Monaco directly and bluntly; only the plugin-facing name and contract stay neutral. Neutral contract,
un-neutral implementation — and when shiki backs the read-only variant, that is a branch in one host
module, not a strategy pattern.

## Composed panes: decided

A host-owned document surface most cleanly replaces **"the pane IS an editor"**. That is
`plugins/editor`: a file tree, a tab bar, one reused editor instance. Even there, honesty requires a
caveat this document originally glossed over: the plugin cannot contribute a tree and tabs *around* a
host surface, because composing around host content is exactly what `frame-src 'none'` forbids. So
editor's real shape is also a template — `frame-beside-document`, or host-drawn tabs fed by the
surface's document-list route — which is one more reason region addressing ships from day one rather
than as a database-only afterthought.

It does **not** replace **"an editor is one resizable region inside my pane"**, and that is
`plugins/database`. Its Monaco host is `.db-editor-host`, inside `.db-editor` at a user-draggable
pixel height (`editorH()`, with a `.db-split` pointer handle), inside `.db-main`, beside
`.db-sidebar`, above `.db-result` and its virtualized grid. The editor is a region in a layout the
plugin composes and the user resizes — and the plugin cannot compose a host surface into it.

Three candidates were on the table:

1. **A host-owned pane template.** The host owns a small fixed vocabulary of layouts — "document above
   results" — fed by plugin declarations. The host splits the pane rectangle, draws its editor in one
   region, mounts the plugin's frame in the other, and owns the drag handle between them. Keeps the
   one-pane mental model and the in-pane keyboard coupling; widens the sandbox not at all; and any
   future "query something, see results" plugin gets the template for free. The cost is host work (a
   new layout concept in the shell) and the named risk: a fixed template becomes a layout language one
   field at a time.
2. **Two surfaces side by side.** A task layout is already a flat ordered row of panes, so database
   contributes a document surface pane and a results frame pane and the user places them. Cheapest,
   most honest to the existing model — and it breaks the thing users actually have in their heads. A
   database tool is *one thing*; here it is two panes that can be reordered apart or closed
   independently ("what happens when the results pane is closed and someone hits ⌘Enter?" has no good
   answer). The keystroke-to-result path also crosses the plugin's node half and the invalidation ping
   — a latency and complexity tax on something that used to be a function call. It would make the
   flagship demo of the composed-pane class feel *worse* than its first-party version, which is a bad
   advertisement for the whole tier.
3. **Accept the narrower scope.** Serve editor-shaped panes only; database stays compiled; widen the
   frame contract later if a composed pane must go third-party. Zero design risk now — but it fails
   the goal directly (a third-party database/query tool is arguably the *more* likely ask than a full
   text editor), and its escape hatch is exactly the sandbox-widening this design exists to avoid,
   deferred to be decided under pressure from a specific plugin, which is the worst time.

**The decision is option 1, shipped lazily: region addressing is baked into the contract from day
one, and the first release carries exactly one degenerate template — a single document filling the
pane. `document-over-frame` lands when database actually moves.** That gets option 3's sequencing
(surface first, learn from the editor-shaped consumer) without option 3's one-way door, and it is
where the rest of the record already points — `terminal.md` reached "one host-owned list/detail
template fed by plugin routes, never a per-plugin layout language" independently, and the entire
descriptor philosophy in these docs is the same move at different scales: the host draws the pixels,
the plugin supplies the data.

### Why the addressing decision cannot be deferred

If the contract ships whole-pane-addressed, a declaration means "this *pane* is a document surface."
Under templates, a declaration means "this *region of a template* is a document surface." Those are
different manifest shapes with different meanings, and bolting regions onto a shipped whole-pane form
changes what every existing declaration means underneath third-party plugins we no longer control.
Shipping the region-capable form from day one — even while the only template is the degenerate one —
costs almost nothing and keeps the door open. This is the one-way door in this design; everything
else is reversible.

## The template vocabulary

The litmus test, which is the whole guardrail in one sentence: **a region is host-owned only when the
sandbox cannot serve its content. Common is not the bar; impossible is.**

Master/detail — rollbar, linear, http, docker — is *common*. Every one of those plugins already draws
its sidebar-plus-detail itself, inside its own frame, with ordinary CSS; an iframe can do flexbox, and
a master/detail layout is a hundred lines of the plugin's own code. If those should look consistent
across plugins, the delivery vehicle is a component in `@acorn/plugin-api/ui` that plugins bundle —
the diff-toolkit precedent — not a host-drawn region. The moment the host renders a plugin's list
*from data*, someone has to design and eternally version a descriptor vocabulary for rows, icons,
badges, grouping, selection, empty states and context menus: a widget toolkit in the wire format,
built to replace something plugins already do fine. That request will recur; the answer stays no.

A document with language-service workers is *impossible* in the sandbox (measured, top of this file).
A live terminal would be too (`terminal.md`). Those earn host surfaces; nothing else does.

The names:

- **`document`** — the whole pane is one document surface. The degenerate template: the simplest
  possible exercise of the contract, and the shape of any single-document pane (a read-only viewer, a
  scratch document).
- **`document-over-frame`** — a document surface above the plugin's frame, host-owned splitter
  between them. Database's shape.
- **`frame-beside-document`** — the plugin's frame beside a document surface. The editor plugin's
  likely shape (tree and tabs cannot wrap *around* a host surface — § Composed panes), pinned down
  when that move is planned rather than now.
- No `layout` block at all — a plain frame, exactly what http declares today. Existing plugins are
  untouched.

Why each word survives scrutiny: `document` is the LSP word, vendor-neutral, and does not promise
Monaco (the shiki-backed read-only variant is still a document). `frame` looks like it leaks an
implementation detail until you notice it is already the manifest's established word for "the region
the plugin draws" — `frames:` is the contribution key in every `acorn-plugin.config.mjs`. The
template names are composed entirely of words the manifest already defines. The alternatives are
worse: `results` presumes query-shape (a markdown preview is not results); `content` and `panel` are
mush.

`over` encoding geometry in the name is a feature, *for a fixed enum*. Each name describes exactly one
arrangement, bluntly. The trap would be orientation as a field (`template: 'document+frame',
orientation: 'vertical'`) — a field implies the other values exist, and that is the first knob of the
layout language. A name implies nothing beyond itself: when `document-beside-frame` earns its
existence via a real consumer, it is a new enum entry, not a new axis. Role names (`console`,
`playground`, `repl`) were considered and rejected — they invite interpretation ("my pane is also a
console, can it have two inputs?"), while geometry names keep the contract blunt at a trust boundary:
you get exactly this arrangement, or you draw your own frame.

The generative rule, so future entries stay in the family: `<host surface>` optionally arranged
`<over|beside>` `frame`, where host-surface names come from the surface vocabulary itself. If
`terminal.md` ever proceeds, `terminal-over-frame` reuses the region addressing, the bridge flow and
the manifest shape with a different surface in the host slot. `document-over-frame` is the first
instance of the pattern, not its ceiling.

## document-over-frame, concretely

```
┌──────────────────────────────────┐
│ host document surface (sql)      │  host: Monaco, theme, workers, dirty state, ⌘S, view state
├──────────────────────────────────┤  host: the drag handle
│ [picker] [Save] [Generate] [Run] │  plugin frame starts here
│ results grid                     │
└──────────────────────────────────┘
```

**The buttons live in the plugin's frame, and the reason is instructive.** Look at what database's
button bar actually contains today (`DatabasePane.tsx`, `.db-editor-bar`): a "⌘↵ to run" hint, a
*searchable saved-queries picker* with per-row delete chips, a Save button that opens
`SaveQueryModal`, a Generate button that is *conditionally visible* (only when a model connection
exists) and opens `GenerateSqlModal`, and an Execute button with a disabled state tied to connection
status. That is the layout-language trap in miniature: a host-rendered "action bar" descriptor
sounds cheap until it needs "searchable picker with per-row delete affordances", "visible when the
plugin has a model connection" and "opens this modal". The bar is common, not impossible, so it is
the plugin's — the first row of its frame region. The visible delta from today is that the bar moves
from above the splitter to below it.

**Modals are the one honest compromise.** Today they overlay the whole pane; a frame confined to the
bottom region can only overlay the bottom region. For database's two small prompts that is
acceptable, and it is the recommendation. The escape hatch already exists if it ever grates: the
`overlay` frame target (`docs/plugins.md` § Frame contribution kind — same bundle, another surface,
opened by the `openOverlay` verb, host-drawn backdrop and dismiss). Moving a prompt there is heavier
than an in-region modal — the overlay is a separate surface, so anything it decides travels through
the plugin's state or its node half — so take it only when the cramped modal is a real problem, not
pre-emptively.

## Communication between regions

The two regions share no DOM and no JavaScript realm — the editor is in the shell, the frame is in a
sandboxed iframe. All traffic goes through the host over the bridge that already exists (the
`MessagePort` request/reply channel in `client-core/src/plugins/frames/sdk.ts`), in two directions.
The host→frame push direction is also already established — `onSelect`, `events.on`, the webview
listeners — so nothing below invents a channel; it adds message kinds to one.

**Host → frame: surface actions.** The ⌘Enter walk-through:

1. The chord lands in the host's Monaco. The host checks the reserved set, then the surface-scoped
   actions the pane's plugin declared. It finds `execute`.
2. **The host flushes the document first** — writes the current buffer to the plugin's declared write
   route. This is a contract guarantee, not an implementation detail: *a surface action never fires
   against a stale document.* Without it, every plugin independently rediscovers the "ran the previous
   version of my query" bug.
3. The host delivers the command to the frame as a bridge event.
4. The frame handles it exactly as it would its own Run button click: calls its own node route, gets
   rows, renders the grid. The frame does not know or care whether the trigger was the chord or the
   button.

**Frame → host: a small document API on the bridge.** The frame sometimes needs to touch the document
it shares the pane with. Today's code says exactly which operations, because each maps to a line in
`DatabasePane.tsx`:

| Bridge call | Proven consumer |
| --- | --- |
| `bridge.document.read()` | Execute button needs the current SQL (today `editor.getValue()`) |
| `bridge.document.write(text)` | the saved-queries picker loads a query into the editor (today `editor.setValue(q.sql)`); Generate inserts the model's SQL the same way |
| `bridge.document.flush()` | "make sure my write route has the latest before I act on it" |

Three methods, each with a proven consumer. That is the entire new bridge surface for database's
move. One fourth method is already known to be coming, found while porting the ⌘P palette's
surroundings: a **multi-document** surface needs "show this uri" — a picker or tab strip selects a
file, and nothing in read/write/flush can point the host's editor at a different document
(`openPane` carries no payload). Whether that lands as `bridge.document.open(uri)` or as host-drawn
tabs fed by the surface's document-list route is part of editor's template question
(`docs/third-party/editor.md` § Sequence) — design the contract knowing the slot exists; do not build
it for database, which is single-document. Beyond that, resist anything more — cursor position,
selection, decorations — until a real plugin cannot ship without it, and weigh any such request
against § Language smarts first, because the LSP-shaped route is usually the better home.

## The manifest shape

Extending the `frames` contribution that already exists. Database's declaration becomes roughly:

```js
frames: [{
  target: 'pane', id: 'database', label: 'Database', glyph: 'database',
  layout: {
    template: 'document-over-frame',        // fixed host vocabulary
    document: {
      languageId: 'sql',                     // host-published vocabulary
      read:  '/v2/p/database/tasks/:taskId/scratch',
      write: '/v2/p/database/tasks/:taskId/scratch',
      completions: {                         // optional — § Language smarts
        route: '/v2/p/database/tasks/:taskId/completions',
        triggerCharacters: ['.'],
      },
    },
  },
}],
commands: [{ id: 'execute', title: 'Database: run query', palette: false }],
// Surface actions ride the existing keybindings carrier — step 4 found no new manifest
// field was needed. `when: 'surface'` requires naming the surface.
keybindings: [{ command: 'execute', defaultChord: 'meta+enter', when: 'surface', surface: 'database' }],
```

For a third-party author building "query tool over results", the entire job is: declare the block
above; implement two node routes that read and write a scratch document keyed by task; in the frame,
handle the `execute` event, call your own query route, render results, and use
`bridge.document.read()` behind your own Run button.

What database's client *deletes* in the move, which is the DX argument in one list:
`monaco.editor.create` and all its options, the theme application, the `addCommand(⌘Enter)` binding,
the `editorH` signal and the splitter's pointer handlers. The plugin author never sees Monaco, never
ships a byte of it, and gets the host's theme, save semantics and dirty-state handling without being
able to get them wrong.

## Who else uses this

`document-over-frame` is a genre, not a one-off: **the user composes text in a real editor, and the
pane shows what that text does.**

- **GraphQL console** — query with schema-aware completions above, response below. This is GraphiQL,
  one of the most-cloned developer tools in existence, and a completely natural third-party plugin.
  Arguably a stronger advertisement for the template than database itself.
- **Source → live preview** — markdown, mermaid or SVG above; the plugin renders the preview below.
- **Config editing with real language services** — a compose-file or CI-config editor with YAML
  diagnostics above, container or pipeline status below.
- **Expression → filtered view** — a jq playground; a log-query pane over docker/log lines.
- **Scratch runners** — a script over its output, against the task's worktree.
- **Prompt authoring** — a template with variables above, a test-run of the agent below. Given what
  this app is, this one may arrive first.

The read-only shiki-backed variant gets consumers too: a generated migration or rendered template in
a proper highlighted viewer above the plugin's apply/status controls.

The honest bar for using the template: the plugin wants a *real* editor — completions, diagnostics,
multiline editing, the host's save semantics. A plugin that needs one input line keeps using its own
input inside its frame; the template is not a text-field delivery mechanism.

## Language smarts: completions, and the growth rule

Table/column autocomplete for database is the obvious first ask, and it is cheap — for a reason worth
recording: **SQL is not one of Monaco's language-service workers.** The 14.58 MiB of workers cover
TypeScript, JSON, CSS and HTML; for SQL, Monaco ships tokenization only, and completions are a
provider you register yourself. So there is no worker to deliver and no language service to proxy —
every path, frame-bundled Monaco included, would have had to write this exact logic. The host-owned
surface loses nothing here. And the data already exists: the database plugin introspects the
connected database today (the sidebar lists tables; the AI generate feature feeds a schema to the
model), per driver, dialect-aware, on its node half.

The contract already borrowed LSP's vocabulary, and completions are literally
`textDocument/completion`, so the capability grows the way everything else in this design works — the
plugin declares a route, the host calls it (shape in § The manifest shape). Flow: the user types `.`
or hits ⌘Space → the host's one generic provider POSTs `{ text, position }` to the declared route →
the plugin's node half decides context (after `FROM`/`JOIN` → tables; after `alias.` → that table's
columns; otherwise keywords) and returns items in a small subset of LSP's `CompletionItem` —
`{ label, kind, insertText, detail }` — which the host maps onto Monaco items.

The boundary decision baked into that flow: **the plugin does the context detection, not the host.**
The host never learns SQL — it stays a dumb proxy from "completion requested at this position" to
"here are items". Dialect knowledge stays inside the plugin where the introspection lives, and the
host provider is generic enough that a GraphQL console or a YAML config plugin uses the identical
mechanism with zero host changes.

Two operational notes: on remote nodes the route call crosses the network, but Monaco calls the
provider once per completion session and filters client-side as the user types, and the schema
snapshot is already cached node-side, so it is one lookup per trigger, not per keystroke. And the
node-side schema cache needs invalidating on reconnect and after DDL runs through the pane — stale
columns in a popup is a small bug but a visible one.

**The growth rule, which this first capability sets as precedent: capabilities grow as LSP-shaped
request/response routes — position and text in, standard items out — never as "run my code inside the
editor."** Hover and diagnostics can follow the same shape when a real consumer needs them. Custom
widgets, decorations and inline UI cannot, and the answer to those requests stays no. The test for
any proposed addition is "is this an LSP method". As long as every addition passes it, the contract
grows without becoming Monaco's API in a trench coat.

## What this does not fix

- **The editor plugin still cannot move, but this is now its ONLY blocker.** Its other two are
  resolved (`docs/third-party/editor.md`): `overlay` is a frame target opened by the `openOverlay`
  verb, and `persistedState` is decided as no-manifest-form-ever, with the frame's
  `state.get`/`state.set` as the tier's store. Porting ⌘P itself additionally needs the
  open-document slot noted in § Communication between regions.
- **Database has moved** (`docs/third-party/README.md § database has moved`), which is what turned the rest of this
  document from a design into a contract. What it did NOT settle is the result-grid measurement: rows
  cross the bridge as structured-clone payloads, and 50k of them is a different proposition than an
  in-realm query cache. Nothing headless in this repo can take that measurement.
- **The asset/CSP finding survives**, as above. A plugin wanting some *other* worker-backed library
  still has no path, and that stays a deliberate no until a real case forces the question.

## Sequence

1. ~~Consolidate what already exists.~~ **Done.** `applyMonacoTheme` and the global `app` theme name
   are `client-core/editor/theme.ts` (with `watchMonacoTheme`, since both call sites always wanted the
   apply-then-subscribe pair), reached by the two compiled panes through a new
   `@acorn/plugin-api/ui/editor` entrypoint — its own barrel rather than more lines on `ui/host`,
   because `monaco-editor` reads `window.location` at module scope and docker's archive concern
   imports `ui/host` eagerly. The mirrored-code comment, the last-writer-wins global and the second
   language vocabulary are gone.
2. ~~Answer the composed-pane question.~~ **Answered** — § Composed panes: templates, region-addressed
   from day one, degenerate `document` template first.
3. ~~Publish the language-id vocabulary.~~ **Done.** `@acorn/protocol/languageIds.ts`, LSP spellings,
   the union of the two extension maps, one fallback. The per-engine maps sit beside their engines —
   `client-core/editor/language.ts` for Monaco, `client-core/highlight/shiki.ts` for shiki, each total
   over the vocabulary so a new id fails `tsc` until someone says what that engine does with it.
4. ~~Build the contract.~~ **Done.** `layout: { template: 'document', document: { languageId, read,
   write? } }` on a `pane` surface, host-owned dirty state, autosave, ⌘S, flush-on-unmount and view
   state, with a missing `write` meaning read-only. Two things came out differently from the sketch
   above, and both are smaller: **surface actions needed no new manifest field** — `keybindings` with
   `when: 'surface'` already carries them, and their DELIVERY is step 5's — and a document surface
   turned out to be gated like a descriptor rather than like a frame, since no plugin bytes execute in
   that pane, so it registers with no client bundle and no trust prompt. The read-only shiki variant
   was NOT built: it is still a branch in one host module when a consumer wants it, and Monaco was
   already there.
5. ~~Add `document-over-frame` when database moves.~~ **Done**, with that move
   (`docs/third-party/README.md § database has moved`). The acceptance test passes: `⌘Enter` runs the query when the plugin
   no longer owns the editor. Three things came out differently from the sketch above.
   **Surface actions needed a new VERB after all** — step 4 was right that the chord rides the existing
   `keybindings` carrier, but a `commands` entry still has to say what it does, and "deliver this to my
   own frame" was not in the closed set. `surfaceAction` names its surface rather than deriving it from
   the keybinding, which keeps the command reachable from the palette too.
   **The chord cannot be resolved by the shell's window dispatcher**: that one refuses scoped bindings
   while a typing target has focus, and Monaco's input area is one. `DocumentSurface` resolves it
   against the same registry a frame's forwarded chords go through, then flushes, then runs.
   **The bridge document API is gated structurally** — `services.document` is present only for a frame
   that has a document beside it — so there is no scope for a manifest to over-ask for.
6. ~~Add the completions capability behind the growth rule.~~ **Done**, with database's table/column
   completions as the first consumer. It came in exactly as designed: one generic host provider, a
   POSTed `{ text, position }`, a small subset of `CompletionItem` back, and every judgement about SQL
   on the plugin's node half. The kinds are LSP's names rather than its magic numbers, because this wire
   is read by plugin authors and not by an LSP client. The node-side schema cache invalidates on
   connect, on disconnect, and after any statement whose command was not a plain read or write.
7. **Then the editor move itself.** Its other two blockers have since been resolved (`overlay` is a
   frame target; `persistedState` deliberately has no manifest form — `docs/third-party/editor.md`),
   so this design is the last thing between editor and the loaded tier. Planning that move settles
   the two questions reserved above: its template shape (`frame-beside-document` vs host-drawn tabs)
   and the open-document verb.

## Related

- `docs/third-party/editor.md` — the measurement that started this, and editor's other two blockers.
- `docs/third-party/README.md § database has moved` — the outcome record of steps 5 and 6: that
  plugin's move built `document-over-frame`, and the findings from doing so live there.
- `docs/future/terminal.md` — the tier-1 "one host-owned template" conclusion this instantiates.
- `docs/future/remote.md` — `formFactor`, and why descriptors render on other shells for free.
- `docs/plugins.md` — the frame contract, the CSP, and what a frame can and cannot do.
