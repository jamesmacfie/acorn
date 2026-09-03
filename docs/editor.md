# A host-owned document surface

Design notes from the http-migration session (2026-08-11), when measuring Monaco against the plugin
frame contract ended two migrations; extended the same day when the composed-pane question was worked
through and decided; and rewritten on 2026-08-31, when the engine behind the surface changed and the
file lost the vendor name it should never have carried (it was `editor-monaco.md`). Companion to [tui.md](./tui.md) and [remote.md](./future/remote.md): this is
the concrete instance of the "one host-owned template" conclusion those two reach in the abstract.
It began life in `docs/future/` as a design to build; with steps 1–6 shipped it lives here as the
design record of the document surface, beside the migration record it belongs to.

The decision on the
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

**What is still true, and what is a record.** The contract, the litmus test and the language-smarts
growth rule below are live. The layout vocabulary this file invented is owned by
[docs/panes.md § Layout model](./panes.md#layout-model) now, and the "descriptor vocabulary" refusal
in § The template vocabulary was aimed at a static schema and still holds against one — what it did
not foresee is the remote component tree, which is argued in
[docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels](./plugins.md). The
class names and the frame regions below are how the world looked in 2026-08.

The contract lives in `docs/plugins.md § Document surfaces`; the code is
`node-core/server/plugins/manifest.ts` (the `layout` block and the `surfaceAction` verb),
`client-core/src/features/editor/` (the surface, its theme, its language map, its view state, the chord
resolution and the completion source), `client-core/host/layouts/DocumentSplit.tsx` (the composed
layout) and `client-core/host/frames/layouts.ts` (the trust and confinement
gate). The wire shapes both ends read are `@acorn/protocol/documentSurface.ts`.

**Step 7 — the editor plugin's own move — is all that remains**, and it still waits on its consumer in
the same way: its template shape and the open-document verb land when that move is planned. What came
out differently from the design is recorded against each step below and, in more detail, in
`docs/loaded-plugin-migration.md § database has moved`. The rest of this document is the design, kept as
written.

## The engine is CodeMirror, and that is the point

**Both instances run on CodeMirror 6 since 2026-08-31** — the editor plugin's pane and the host's own
document surface — and `monaco-editor` is out of the tree. Nothing in the contract moved: a plugin
still declares a language id and two routes, the host still draws the whole rectangle, and the
acceptance test still passes. That is the argument for a neutral contract, collected: the engine
underneath it was replaced and no plugin had to know.

What changed, and why:

- **Monaco was 2 to 5 MB of VS Code for a feature set two call sites barely touched** — multiple
  documents, view-state restore, a save chord and one completion provider. CodeMirror is modular and
  MIT, a few hundred kilobytes with the grammars this app actually maps, and it needs no workers at
  all. `monacoSetup.ts`, the file § What is already true calls "half of this design existing by
  accident", is gone rather than rewritten: there is no worker environment to wire.
- **The two shared modules kept their jobs.** `theme.ts` builds the same colours out of the same live
  app tokens, as a CodeMirror extension in a compartment instead of a globally named theme — which
  quietly fixes the last-writer-wins hazard that table below describes, because a compartment is per
  view rather than per process. `language.ts` is the same total map over the same published
  vocabulary, resolving to Lezer grammars instead of Monaco language ids.
- **`languageForPath` is async, and downloads one grammar.** It was seventeen static imports, so a
  pane that opened one file downloaded every language the app knows: the editor's lazy chunk was
  954,915 bytes of which the grammars were nearly all. The map's entries now import their grammar and
  then build a parser from it, `languageForPath(path)` and `languageFor(id)` return a promise, and both
  call sites await it beside the read they already await — `EditorPane.tsx` in the `Promise.all` inside
  `stateFor(path)`, `DocumentSurface.tsx` beside its read route — so no new wait appears on screen. A
  grammar that will not download is an empty extension rather than a throw: no highlighting beats no
  file. The four JavaScript dialects share one package, so opening a `.tsx` file after a `.ts` one
  costs no request. Measured after the split: the chunk is 60,861 bytes and a `.ts` file fetches two
  more chunks, 110,946 bytes ([performance.md](./performance.md) § 2026-09-03).
- **View state stopped being opaque**, which is the one place the design got *better* rather than
  merely equivalent — see § View state below.
- **The `ui/editor` entrypoint survives, and is no longer node-hostile.** It exists to keep the
  grammars out of every other pane's boot graph, which is still true. What is no longer true is the
  reason it sat on the browser-realm list in `packages/plugin-api/src/entrypoints.test.ts`: Monaco
  read `window` at module scope and CodeMirror does not, so a plugin test that wants an editor theme
  can now have one.
- **`PLUGIN_API_MAJOR` went to `9`**, because three published names said Monaco out loud. See
  `docs/plugins.md § The plugin API`.

Everything below this section is the design as it was argued, kept because the argument is what
survives an engine change. Where it says "Monaco", read "the editor the host owns": the measurements
are Monaco's and are the reason the surface exists at all.

The filename is the search term, not the contract name. See § Naming for why the contract must not
name a vendor anywhere.

## The question

Two panes embed Monaco — `plugins/editor` and `plugins/database` — and both are stuck first-party
because of it. A single-file Monaco frame measures **7.93 MiB against an 8.00 MiB cap** with a stub UI,
and its language-service workers (**14.58 MiB across four emitted chunks**) cannot be served at all: an
`app-plugin://<hash>` origin serves `/client.js` plus the host's `/ui.css` and nothing else, and the
frame CSP has no `worker-src`, so `default-src 'none'` denies workers including `blob:`
(`docs/first-party-plugins.md § First-party only by history`, the editor row).

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
`client-core/features/editor/`. It is kept because the argument for doing it is the argument for the whole
design.)*

Monaco is already a host-owned singleton, and half of this design exists by accident.

`packages/client-core/src/features/editor/monacoSetup.ts` (deleted with the CodeMirror move, since there
are no workers to wire) assigned `self.MonacoEnvironment` once at the renderer entry, and its comment
said why: it used to be imported by both panes, and "two panes racing to set it was a real bug." One
module, one set of workers, two consumers — which is what made the case that the editor was always a
host singleton.

Everything above that line is duplicated, and the duplication is already load-bearing in ways nobody
chose:

| What | Where | Note |
| --- | --- | --- |
| `applyMonacoTheme()` | `EditorPane.tsx` and `DatabasePane.tsx`, verbatim | the database copy is commented *"mirrored here to keep that pane untouched"* |
| A Monaco theme named `app` | both, `defineTheme('app', …)` | the name is **global**. Two plugins write the same global and it works by luck; last writer wins |
| `watchAppearance(applyMonacoTheme)` | both | two subscriptions doing identical work on every theme change |
| extension → language id | `EditorPane.tsx` (`langFor`, falls back to `'plaintext'`) and `client-core/infra/highlight/shiki.ts` (`langFor`, falls back to `'text'`) | two maps, two vocabularies, two fallbacks |

That last row matters more than it looks — see § Naming.

## The constraint that decides the shape

**The plugin frame CSP has `frame-src 'none'`** (`apps/desktop/src-tauri/src/plugin_scheme.rs`). A plugin
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

### View state

`plugins/editor/src/client/editorViewState.ts` used to store `editor.ICodeEditorViewState` — a Monaco
type, an opaque blob — in a module-level map. That was fine *inside* a plugin and impossible over a
descriptor: the blob cannot cross a contract that does not name a vendor. This section used to be
called "the one type that must go opaque", and the answer it gave was that it stops being the
plugin's at all: scroll and cursor position are host state, keyed by (node, task, uri) and evicted by
the host's own scope-eviction signals.

That half still holds. The other half got better on the move to CodeMirror, which has no such blob:
what both call sites persist is `{ anchor, head, scrollTop }`, declared in
`client-core/features/editor/viewState.ts` and published as `EditorViewState`. So there is no opaque
type left in the design at all — the app owns what it saves, can read it, and clamps it to the
document on restore, which matters because the agent and the human share a worktree and the file may
have moved underneath a stashed offset.

## Naming

The contract must not say "monaco", and the TUI is the weaker half of the argument.

- **`formFactor: ['desktop' | 'mobile']` is already in the manifest schema**, and `remote.md` already
  commits to a mobile shell rendering the same contributions in a different layout. The neutrality is
  justified by a form factor already on the record, not by a speculative terminal client.
- **The name crosses a trust boundary.** Everything a plugin declares is parsed from disk by the host
  and bound to host-owned meaning. A vendor name in that vocabulary is a vendor name in the wire
  format, permanently.
- **There are already two implementations in this repo.** Diff rows highlight with **shiki**
  (`client-core/infra/highlight/shiki.ts`); the editor and database panes edit with **Monaco**. They are not
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
its editor directly and bluntly; only the plugin-facing name and contract stay neutral. Neutral
contract, un-neutral implementation — and when shiki backs the read-only variant, that is a branch in
one host module, not a strategy pattern.

The 2026-08-31 engine swap is the evidence this was the right call rather than a guess. Two files
changed shape, no interface had to be honoured, and no plugin noticed — which is what "neutral
contract, un-neutral implementation" buys, and it is exactly what an abstraction layer would have
charged for up front and then not delivered.

## Composed panes: decided

A host-owned document surface most cleanly replaces **"the pane IS an editor"**. That is
`plugins/editor`: a file tree, a tab bar, one reused editor instance. Even there, honesty requires a
caveat this document originally glossed over: the plugin cannot contribute a tree and tabs *around* a
host surface, because composing around host content is exactly what `frame-src 'none'` forbids. So
editor's real shape is also a template — `frame-beside-document`, or host-drawn tabs fed by the
surface's document-list route — which is one more reason region addressing ships from day one rather
than as a database-only afterthought.

It does **not** replace **"an editor is one resizable region inside my pane"**, and in 2026-08 that
was `plugins/database`. Its Monaco host was a `.db-editor-host` div, inside `.db-editor` at a
user-draggable pixel height (an `editorH()` signal with a `.db-split` pointer handle), inside
`.db-main`, beside `.db-sidebar`, above `.db-result` and its virtualized grid. The editor was a region
in a layout the plugin composed and the user resized — and the plugin could not compose a host surface
into it. Every one of those classes is gone: the layout is the host's now and the plugin ships no
stylesheet. The problem they describe is what this section decided.

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
where the rest of the record already points — the terminal client's own design reached "one host-owned list/detail
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

## The template vocabulary, and document-over-frame concretely

Both sections folded into [docs/panes.md § Layout model](./panes.md#layout-model), which owns the
layout names, their regions, and each one's narrow and terminal projection. What survives from here is
the litmus test, because it is what keeps that list short:

**A region is host-owned only when the sandbox cannot serve its content. Common is not the bar;
impossible is.**

Master/detail, which rollbar, linear, http and docker all draw, is *common*: an iframe can do flexbox,
and each of those plugins already draws its own. The moment the host renders a plugin's list *from
data*, someone has to design and eternally version a descriptor vocabulary for rows, icons, badges,
grouping, selection, empty states and context menus. A document with language-service workers is
*impossible* in the sandbox, measured at the top of this file, and a live terminal would be too
(`docs/tui.md`). Those earn host surfaces; nothing else does.

The other thing worth keeping is why the button bar in a composed pane is the plugin's. Database's bar
holds a searchable saved-queries picker with per-row delete chips, a Save button that opens a modal, a
Generate button visible only when a model connection exists, and an Execute button disabled on
connection status. A host-drawn action-bar descriptor sounds cheap until it needs all of that. The bar
is common, not impossible, so it is the first row of the plugin's own region.

Modals are the one honest compromise. A frame confined to one region can only overlay that region. For
database's two small prompts that is acceptable. The escape hatch is the `overlay` frame target
(`docs/plugins.md` § Frame contribution kind), which is heavier, because anything it decides travels
through the plugin's state or its node half. Take it when a cramped modal is a real problem, not
pre-emptively.

## Communication between regions

The two regions share no DOM and no JavaScript realm — the editor is in the shell, the frame is in a
sandboxed iframe. All traffic goes through the host over the bridge that already exists (the
`MessagePort` request/reply channel in `client-core/src/host/frames/sdk.ts`), in two directions.
The host→frame push direction is also already established — `onSelect`, `events.on`, the webview
listeners — so nothing below invents a channel; it adds message kinds to one.

**Host → frame: surface actions.** The ⌘Enter walk-through:

1. The chord lands in the host's editor. The host checks the reserved set, then the surface-scoped
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
— design the contract knowing the slot exists; do not build
it for database, which is single-document. Beyond that, resist anything more — cursor position,
selection, decorations — until a real plugin cannot ship without it, and weigh any such request
against § Language smarts first, because the LSP-shaped route is usually the better home.

## The manifest shape

Extending the `frames` contribution that already exists. Database's declaration becomes roughly:

```js
frames: [{
  target: 'pane', id: 'database', label: 'Database', glyph: 'database',
  layout: 'document-over-frame',             // fixed host vocabulary
  regions: {
    document: {
      kind: 'document',
      languageId: 'sql',                     // host-published vocabulary
      read:  '/v2/p/database/tasks/:taskId/scratch',
      write: '/v2/p/database/tasks/:taskId/scratch',
      completions: {                         // optional — § Language smarts
        route: '/v2/p/database/tasks/:taskId/completions',
        triggerCharacters: ['.'],
      },
    },
    // As designed in 2026-08. When database actually moved, this region became
    // `{ kind: 'remote', entry: 'results' }` — a tree of the host's own components rather than the
    // plugin's own iframe. `'frame'` is still legal and is what a region that owns its pixels says.
    frame: 'frame',
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
constructing an editor and all its options, the theme application, the ⌘Enter binding, the `editorH`
signal and the splitter's pointer handlers. The plugin author never sees the editor library, never
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

Two operational notes: on remote nodes the route call crosses the network, but the editor calls the
source once per completion session and filters client-side as the user types, and the schema
snapshot is already cached node-side, so it is one lookup per trigger, not per keystroke. And the
node-side schema cache needs invalidating on reconnect and after DDL runs through the pane — stale
columns in a popup is a small bug but a visible one.

**The growth rule, which this first capability sets as precedent: capabilities grow as LSP-shaped
request/response routes — position and text in, standard items out — never as "run my code inside the
editor."** Hover and diagnostics can follow the same shape when a real consumer needs them. Custom
widgets, decorations and inline UI cannot, and the answer to those requests stays no. The test for
any proposed addition is "is this an LSP method". As long as every addition passes it, the contract
grows without becoming an editor library's API in a trench coat.

## One round trip to text

Shipped 2026-09-03. Opening the editor pane on a task used to be three steps in a row: read the
task's checkout path, mount the CodeMirror rectangle that path gated, then read the file. Only two of
those are requests, and the second never depended on the first — the file the reader left open is
remembered in the pane's own state — so the pane now issues both in the same tick and the text lands
after one round trip. At 50 ms of latency a request, on a remembered file, first text moved from 222 ms
to 174 ms, and the slope across two latencies says two serial requests became one
([performance.md](./performance.md) § 2026-09-03 — phase 8).

**The checkout path is a query, not a call.** It is read through the query cache under
`['editor', 'root', taskId]` with a one-minute freshness window, so reopening the pane on a task the
reader was just in issues no request for it at all, and the task rail warms the same key when the
pointer settles on a row (`docs/panes.md` § Contributions). A path already in the cache paints the
rectangle in the same tick. An *absent* one never does: "this task has no checkout yet" is the one
answer that changes underneath the window, so it is always awaited.

**The open documents belong to the task, not to the mount.** Each open file's `EditorState` — its
text, its undo history, its grammar — is held in the pane's model
(`client-core/host/registries/panes/paneModels.ts`, `docs/panes.md` § Layout model), which the host
builds once per (pane, task) and disposes when another task asks for that pane or the task is evicted.
The pane used to clear the pool in its own cleanup, so closing the pane and opening it again threw away
every unsaved edit's undo history and re-read every file. It now costs no requests at all.

Closing the pane still flushes a pending autosave, and that write finishes its own bookkeeping even
though the mount that started it is gone — otherwise the file came back marked dirty against content
already on disk.

A pooled state carries extensions that close over the mount that built them — the update listener that
derives dirty, the save chord — so a state built by an earlier mount is reconfigured before it goes on
screen. CodeMirror keeps the value of a state field that is present in both configurations, which is
what makes the document and its undo history survive; the closures pointing at a destroyed view do not.

## Editing in your own editor

Shipped 2026-08-31. Some people have spent fifteen years
in vim and are not going to stop for a pane. The editor pane's file view can hold their editor
instead of CodeMirror: one device preference, `editor_mode`, and when it says `terminal` the pane
mounts a PTY rectangle over `$EDITOR <file>` (then `$VISUAL`, then `vi`) in the task's worktree.
Graphical is the default and stays it.

**On the terminal client this is the whole handoff.** The design for that host planned a suspend: release
the terminal, run `$EDITOR`, resume, redraw. Nothing needed building. The PTY is on the node and the
`pty` rectangle draws it in cells, so the same preference gives a reader vim inside the terminal they
were already in, and the pane refetches the file when it exits exactly as it does here. What the
terminal client does not have is the graphical side: with the preference off it draws the box and a line
saying the file opens there.

**The PTY is throwaway.** Its own short-lived channel on the one authenticated socket
(`editor:pty:*`, `plugins/editor/src/shared/editorPty.ts`), a client-minted id, and a spawn that dies
with the panel — no terminal-plugin session row, no tmux binding, no drawer tab. A
`create({ command })` session would have worked and would have bought all three. The channel spawns
through a login shell, like the terminal plugin's own command override, because `$EDITOR` is set in a
shell profile, may carry flags, and PATH is where nvm puts things. The file reaches the shell as `$1`
rather than interpolated into the command line, and the path is confined to the worktree by the same
`resolveInRoot` every editor route uses.

**Exit is the save signal, and the only one.** The pane does no dirty tracking in terminal mode: the
editor in the PTY owns the buffer. When the process exits, the pane drops what it had cached for that
file and the graphical view reads it back off disk — the same refresh reload-on-focus performs. A
non-zero exit says so in an `Alert` instead of pretending a save happened. Leaving mid-edit, by
flipping the preference back or switching tabs, drops the cache the same way, because whatever is on
disk now is the truth and the pane never guessed at it.

**Two doors left open.** The TUI sharing this preference key, so a person's choice follows them
between hosts; and attaching to a still-running editor process instead of spawning a second one. The
ephemeral channel dying with the panel is what makes the simple thing correct first.

## What this does not fix

- **The editor plugin still cannot move, but this is now its ONLY blocker.** Its other two are
  resolved: `overlay` is a frame target opened by the `openOverlay`
  verb, and `persistedState` is decided as no-manifest-form-ever, with the frame's
  `state.get`/`state.set` as the tier's store. Porting ⌘P itself additionally needs the
  open-document slot noted in § Communication between regions.
- **Database has moved** (`docs/loaded-plugin-migration.md § database has moved`), which is what turned the rest of this
  document from a design into a contract. What it did NOT settle is the result-grid measurement: rows
  cross the bridge as structured-clone payloads, and 50k of them is a different proposition than an
  in-realm query cache. Nothing headless in this repo can take that measurement.
- **The asset/CSP finding survives**, as above. A plugin wanting some *other* worker-backed library
  still has no path, and that stays a deliberate no until a real case forces the question.

## Sequence

1. ~~Consolidate what already exists.~~ **Done.** `applyMonacoTheme` and the global `app` theme name
   are `client-core/features/editor/theme.ts` (with a watcher, since both call sites always wanted the
   apply-then-subscribe pair), reached by the two compiled panes through a new
   `@acorn/plugin-api/ui/editor` entrypoint — its own barrel rather than more lines on `ui/host`,
   because `monaco-editor` reads `window.location` at module scope and docker's archive concern
   imports `ui/host` eagerly. The mirrored-code comment, the last-writer-wins global and the second
   language vocabulary are gone.
2. ~~Answer the composed-pane question.~~ **Answered** — § Composed panes: templates, region-addressed
   from day one, degenerate `document` template first.
3. ~~Publish the language-id vocabulary.~~ **Done.** `@acorn/protocol/languageIds.ts`, LSP spellings,
   the union of the two extension maps, one fallback. The per-engine maps sit beside their engines —
   `client-core/features/editor/language.ts` for the editor, `client-core/infra/highlight/shiki.ts` for shiki, each total
   over the vocabulary so a new id fails `tsc` until someone says what that engine does with it.
4. ~~Build the contract.~~ **Done.** `layout` and `regions` on a `pane` surface, with a document
   region carrying `{ languageId, read, write? }`, host-owned dirty state, autosave, ⌘S, flush-on-unmount and view
   state, with a missing `write` meaning read-only. Two things came out differently from the sketch
   above, and both are smaller: **surface actions needed no new manifest field** — `keybindings` with
   `when: 'surface'` already carries them, and their DELIVERY is step 5's — and a document surface
   turned out to be gated like a descriptor rather than like a frame, since no plugin bytes execute in
   that pane, so it registers with no client bundle and no trust prompt. The read-only shiki variant
   was NOT built: it is still a branch in one host module when a consumer wants it, and Monaco was
   already there.
5. ~~Add `document-over-frame` when database moves.~~ **Done**, with that move
   (`docs/loaded-plugin-migration.md § database has moved`). The acceptance test passes: `⌘Enter` runs the query when the plugin
   no longer owns the editor. Three things came out differently from the sketch above.
   **Surface actions needed a new VERB after all** — step 4 was right that the chord rides the existing
   `keybindings` carrier, but a `commands` entry still has to say what it does, and "deliver this to my
   own frame" was not in the closed set. `surfaceAction` names its surface rather than deriving it from
   the keybinding, which keeps the command reachable from the palette too.
   **The chord cannot be resolved by the shell's window dispatcher**: that one refuses scoped bindings
   while a typing target has focus, and the editor's content area is one. `DocumentSurface` resolves it
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
   frame target; `persistedState` deliberately has no manifest form),
   so this design is the last thing between editor and the loaded tier. Planning that move settles
   the two questions reserved above: its template shape (`frame-beside-document` vs host-drawn tabs)
   and the open-document verb.
8. ~~Change the engine.~~ **Done** on 2026-08-31, out of order and on its own. Both instances run CodeMirror 6, `monaco-editor` is
   out of both `package.json`s, `monacoSetup.ts` is deleted, and the editor pane's root is kit layout
   rather than a raw `<section>`. Two things came out differently from that phase's sketch.
   **The pane's close-tab chord did not need an element after all**: `onClosePaneWithin` grew a
   sibling, `onClosePaneWhen`, that takes a predicate, and the pane answers it with the host's own
   `focusedPane(taskId)` — so nothing had to mint a `<div>` to hold a ref.
   **Completions got simpler rather than merely different.** Monaco's providers register per language
   and are global, so the surface had to filter every request down to its own model; CodeMirror hangs
   a source off the state, so a second document pane in the same language cannot be offered another
   plugin's items and there is nothing to filter.

9. ~~Let a person edit in their own editor.~~ **Done** on 2026-08-31, also out of order — §
   Editing in your own editor. It waited on step 8
   only because the preference it adds chooses between two editors and one of them was being
   replaced.

## Related

- `docs/first-party-plugins.md § First-party only by history` — the measurement that started this,
  in the editor row. The editor brief that held the rest was every open item this design and the layout
  programme answered, and it went at layout phase 9. Find it with
  `git log --follow -- docs/third-party/editor.md`.
- `docs/loaded-plugin-migration.md § database has moved` — the outcome record of steps 5 and 6: that
  plugin's move built `document-over-frame`, and the findings from doing so live there.
- `docs/tui.md` — the terminal host that reached the same "one host-owned template" conclusion.
- `docs/future/remote.md` — `formFactor`, and why descriptors render on other shells for free.
- `docs/plugins.md` — the frame contract, the CSP, and what a frame can and cannot do.
