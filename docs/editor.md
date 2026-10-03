# Editor

acorn has one text editor, owned by the host and built on CodeMirror 6. The editor plugin's pane uses
it to edit worktree files, and the host lends it to any plugin as a document surface. Read this page
to find what the host editor does, what it lends to plugins, and its limits.

The host code is in `packages/client-core/src/features/editor/`: the surface, its theme, its language
map, its view state, chord resolution, and the completion source. The wire shapes are in
`packages/protocol/src/content/documentSurface.ts`, the manifest's `layout` block and `surfaceAction`
verb are parsed in `packages/node-core/src/server/plugins/manifest.ts`, and the composed layout is
`packages/client-core/src/host/layouts/DocumentSplit.tsx`. The editor plugin is `plugins/editor`.

## The shared surface

The editor pane and the host's document surface share one theme and one language map:

- `theme.ts` builds the editor's colors from the live app tokens, as a CodeMirror extension in a
  compartment, so each view has its own theme. It defines one `HighlightStyle` per appearance from
  the GitHub light and dark colors in `packages/client-core/src/infra/highlight/shiki.ts`, so a file
  reads the same in an editor pane, a diff, and an agent's Markdown fence. `theme.test.tsx` fails if
  CodeMirror's bundled styles get registered ahead of it.
- `language.ts` is a total map over the published language-ID vocabulary
  (`packages/protocol/src/content/languageIds.ts`), resolving each ID to a Lezer grammar. A new ID
  fails `tsc` until someone says what the engine does with it. Shiki's map in `shiki.ts` is total
  over the same vocabulary.
- `languageForPath(path)` and `languageFor(id)` return a promise and download one grammar, beside
  the file read the caller already awaits. A grammar that won't download becomes an empty extension,
  so the file still opens without highlighting. The four JavaScript dialects share one package.
- Above 256 Ki characters (`MAX_HIGHLIGHT_CHARACTERS`), both the pane and host document surfaces
  leave out the grammar, so a generated or minified file can't block the main thread while
  CodeMirror builds its syntax tree. One `editor.syntax.skipped` sample records the size. A normal
  document whose grammar throws is retried as plain text.
- A selection inside one line is drawn. The current-line background stands down while the selection
  layer has anything in it. The selection uses the accent at 34%, and other copies of the selected
  word (`.cm-selectionMatch`) use it at 16%.

`@acorn/plugin-api/ui/editor` is a separate entrypoint for compiled panes, so the grammars stay out of
every other pane's boot graph. CodeMirror reads no browser global at module scope, so a plugin test
can import it under Node.

## Pages

<a id="the-contract"></a>
<a id="view-state"></a>
<a id="naming"></a>
<a id="language-smarts-completions-and-the-growth-rule"></a>
<a id="a-code-box-that-is-not-a-document"></a>
<a id="the-manifest-shape"></a>

[The document surface](./editor/document-surface.md) covers the contract a plugin declares, what the
host owns, view state, the language-ID vocabulary, completions and the rule for adding capabilities,
and the embedded editor for a code box.

<a id="composed-panes-decided"></a>
<a id="communication-between-regions"></a>
<a id="the-template-vocabulary-and-document-over-frame-concretely"></a>

[Composed panes](./editor/composed-panes.md) covers `document-over-frame`, which regions the host
draws, surface actions, and the document API on the bridge.

<a id="image-previews-in-the-editor-pane"></a>
<a id="file-tree-viewport-and-freshness"></a>
<a id="graphical-admission"></a>
<a id="one-round-trip-to-text"></a>
<a id="text-loads-and-deferred-presentation"></a>
<a id="editing-in-your-own-editor"></a>
<a id="from-the-command-palette"></a>

[The editor pane](./editor/editor-pane.md) covers the editor plugin's pane: opening files, image
previews, the file tree, reloading on focus, editing in `$EDITOR`, and its palette commands.

<a id="find-in-files"></a>

[Find in files](./editor/find-in-files.md) covers the ripgrep search behind the editor's search panel.

<a id="line-provenance-markers"></a>

[Line markers](./editor/line-markers.md) covers the bars that mark pull request and uncommitted lines.

<a id="save-acknowledgements-and-recovery"></a>
<a id="host-document-export-and-guarded-replacement"></a>

[Saving and recovery](./editor/save-and-recovery.md) covers write ownership, save acknowledgements,
dirty-text recovery, and exporting an oversized host document.

## Limits

- The editor plugin is still compiled, not loaded. Its Node half owns the `editor:pty:*` WebSocket
  channel for `$EDITOR` mode, its client half registers a persisted open-file list that has no
  manifest form, and its pane has a file tree and many open documents, while the declarative
  `document` region describes one. Moving it waits for a multi-document contract and a persisted-state
  descriptor, or a decision to keep those first-party. Don't copy CodeMirror into a loaded bundle to
  make the move look done. `pnpm --filter @acorn/node measure:editor-bundle` measures the pane as one
  file: 1,271,605 bytes raw on September 11, 2026, under the 8 MiB limit.
- A plugin that wants another library with workers still has no way to ship one. Frames can't load
  workers ([frames](./plugins/frames.md)).
- The database pane's result grid sends rows across the bridge as structured-clone payloads. Nobody
  has measured 50,000 rows there.

## Why the host owns the editor

<a id="the-question"></a>
<a id="what-is-already-true"></a>
<a id="the-constraint-that-decides-the-shape"></a>
<a id="why-this-beats-widening-the-frame-contract"></a>
<a id="what-this-does-not-fix"></a>
<a id="sequence"></a>

A loaded plugin's frame is one file at an `app-plugin://<hash>` origin, and its content security
policy has no `worker-src`. In August 2026, a single-file Monaco frame measured 7.93 MiB against the
8 MiB limit with a stub UI, and its language-service workers, 14.58 MiB, couldn't be served at all
([first-party plugins](./first-party-plugins.md) § First-party only by history). Allowing workers and
multi-file origins would widen the sandbox for every plugin to serve two panes. A host-owned surface
widens nothing: the editor runs in the shell, and the plugin declares a language ID and two routes.
It also means one theme, one save chord, and one dirty-state model, which no plugin can get wrong.

## Why CodeMirror

<a id="the-engine-is-codemirror-and-that-is-the-point"></a>

Both instances moved from Monaco to CodeMirror 6 on August 31, 2026, and no plugin had to change,
because the contract names no vendor. Monaco was 2 to 5 MB of VS Code for a feature set the two
callers barely used: several documents, view-state restore, a save chord, and one completion
provider. CodeMirror is modular, needs no workers, and with the grammars acorn maps is a few hundred
kilobytes. On September 3, 2026, the editor's lazy chunk measured 60,861 bytes, and opening a `.ts`
file fetched two more chunks, 110,946 bytes.
