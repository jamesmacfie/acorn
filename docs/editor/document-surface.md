# The document surface

This page covers the document surface the host lends to plugins: what a plugin declares, what the
host owns, view state, naming, completions, and the embedded editor for a code box. Read it before you
give a plugin an editor. It's part of [editor](../editor.md). The manifest contract is in
[plugins](../plugins.md) § Document surfaces.

## The contract

A plugin declares a document region and the routes behind it, and the host draws the whole
rectangle. The plugin declares in its manifest, and serves from its own routes:

- The document's identity: a route that reads it and, optionally, a route that writes it. A missing
  `write` means read-only.
- A `languageId` from the host's published vocabulary.
- Its own actions and their chords, as `commands` and `keybindings` with `when: 'surface'`.
- Optionally, capability routes. Completions are the one capability.

The host owns, so the plugin can't get them wrong:

- The editor instance, its theme, and its appearance subscription.
- Find and replace ([find in a file](../editor.md#find-in-a-file)). A replacement is an edit like
  any other, so it autosaves and undoes like one.
- Dirty state, autosave, the save chord (`⌘S`), the unsaved-changes guard, and the flush when the
  surface unmounts ([saving and recovery](./save-and-recovery.md)).
- View state across tab switches and remounts, and evicting it when a task is archived or the Node
  changes.
- The reserved chord set, which a plugin can't claim.

A region whose kind is `document` runs none of the plugin's code, so the host gates it like a
descriptor: no client bundle and no trust prompt
([pane contributions](../panes/contributions.md#regions-a-loaded-plugin-declares)).

The surface gives plugins the editor's features, not its API. There are no programmatic decorations,
inline widgets, or arbitrary providers. Anything that isn't a document, routes, and declared
capabilities is out of scope, and [language smarts](#language-smarts) is the rule for adding a
capability.

### The manifest shape

The database plugin's declaration is the worked example (`plugins/database/acorn-plugin.config.mjs`):

```js
frames: [{
  target: 'pane', id: 'database', label: 'Database', glyph: 'database',
  layout: 'document-over-frame',
  regions: {
    document: {
      kind: 'document',
      languageId: 'sql',
      read:  '/v1/p/database/tasks/:taskId/scratch',
      write: '/v1/p/database/tasks/:taskId/scratch',
      completions: { route: '/v1/p/database/tasks/:taskId/completions', triggerCharacters: ['.'] },
    },
    frame: { kind: 'remote', entry: 'panel' },
  },
}],
keybindings: [{ command: 'execute', defaultChord: 'meta+enter', when: 'surface', surface: 'database' }],
```

The `execute` command uses the `surfaceAction` verb, which delivers it to the plugin's own region
([composed panes](./composed-panes.md#communication-between-regions)).

## View state

Both the editor pane and the document surface save `{ anchor, head, scrollTop }`, declared in
`packages/client-core/src/features/editor/viewState.ts` and published as `EditorViewState`. The host
keys it by Node, task, and URI and evicts it on its own scope signals. Because the app owns the shape,
it clamps the saved position to the document on restore. That matters because the agent and the
person share a worktree, and the file can change under a saved offset.

## Naming

The contract uses LSP's vocabulary: `textDocument`, `uri`, `languageId`, and `dirty`. It names no
editor vendor, because everything a plugin declares is parsed by the host and becomes part of the wire
format. LSP is the established vendor-neutral spelling, so another host has a map to follow, and the
language-ID vocabulary has a canonical source in `packages/protocol/src/content/languageIds.ts`.

The contribution name avoids the word `editor`, because `editor` is already a plugin ID and a route
capability inside that plugin.

The neutral name doesn't mean an abstraction layer. The shell calls CodeMirror directly. Only the
plugin-facing contract is neutral. When the engine changed from Monaco to CodeMirror, two files
changed shape and no plugin noticed.

## Language smarts

Completions are the first capability, with database's table and column completions as the consumer
(`plugins/database/src/server/completions.ts`). The flow:

1. You type a trigger character, such as `.`, or press ⌘Space.
2. The host's one generic provider sends `{ text, position }` to the declared route.
3. The plugin's Node half decides the context, for example tables after `FROM` and a table's columns
   after `alias.`, and returns items in a small subset of LSP's `CompletionItem`:
   `{ label, kind, insertText, detail }`. The kinds are LSP's names, not its numbers.
4. The host maps the items onto CodeMirror's.

The plugin detects context and the host never learns SQL, so a GraphQL or YAML plugin can use the same
mechanism with no host change. The host calls the route once per completion session and filters on
the device as you type. Database's schema cache invalidates on connect, on disconnect, and after any
statement that wasn't a plain read or write. CodeMirror attaches the completion source to one editor
state, so a second document pane in the same language never gets another plugin's items.

Capabilities grow as LSP-shaped request and response routes, position and text in and standard items
out, never as code running inside the editor. Custom widgets, decorations, and inline UI can't. To
judge a proposed capability, ask whether it's an LSP method.

### Hover and diagnostics

A region may add `hover: { route }` and `diagnostics: { route }`. Editor's files have no plugin of
their own, so a plugin offers them by language with `contributions.documentServices`:
`{ id, label, languageId, hover?, diagnostics? }`. Database's SQL hover is the region consumer. The
loaded fixture in `apps/node/test/__fixtures__/json-diagnostics` is the file-language one. The wire
types are in `packages/protocol/src/content/documentSurface.ts`:

- Hover POSTs `{ text, position, revision }` and takes `{ revision, contents, range? }` or `null`.
  `contents` is `{ kind: 'plaintext' | 'markdown', value }`, at most 64 KiB, and Markdown is drawn
  sanitized with images as placeholders.
- Diagnostics POSTs `{ text, revision }` and takes `{ revision, items }`, 200 items kept. An item is
  `{ range, severity, message, code?, source? }`, with LSP's four severities spelled as names.

Positions are the completion convention: one-based lines and columns, columns in UTF-16 units, and
an exclusive end. That's a subset of LSP's vocabulary, not LSP's zero-based coordinates. `text` is the
live buffer, saved or not, and `revision` is the owner's edit counter. The host drops an answer for
another revision, an answer that arrives after an edit, and an item whose range falls outside the
text. A buffer over 1 MiB isn't sent, and the owner says why.

A region's document goes only to its own routes, so a database scratch never reaches another
plugin's SQL provider. For a file, the host picks one provider per language and service on the Node
in view. One provider serves on its own. With two, neither runs until the person picks one under
**Settings > Advanced > Extension points > Language services**. The pick is a Node preference,
`document_services`. A pick for a plugin that's gone means no provider, never the runner-up.

On the desktop, hover draws a tooltip credited to the plugin, and diagnostics draw underlines and
the lint panel (⌘⇧M), asked again 500 ms after the last edit. An empty or failed answer clears that
provider's marks and nothing else. The owner code is `features/editor/languageServices.ts` and
`host/registries/panes/documentServices.ts` in client-core. The terminal has no pointer, so a
document region offers **Inspect position**, which asks about the caret, and **Diagnostics**.
Editor there offers **Diagnostics** on the file as saved, because the person edits in `$EDITOR`.
Diagnostics are read-only: no fixes, commands, or language-server processes.

Another plugin can act on text a person selects in the document, through the `content.selection`
menu. The surface hands the row the selected text of the live buffer, saved or not, with its range
and the buffer's edit counter, and refuses the row after an edit. Never the whole document. Editor's
pane does the same. See [context menus](../plugins/menus-and-markers.md#context-menus).

## A code box that is not a document

Some fields hold code that the plugin already has, with the plugin's own buttons below. The
Workflows JSON tab is the example, with **Apply**, **Format**, and **Revert** beside it
([workflow authoring](../workflows/authoring.md)). There's no read
route, write route, autosave, or view state. The plugin still can't import CodeMirror or the theme
itself, because a host that can't draw them would carry them.

`@acorn/plugin-api/ui/editor` exports `mountEmbeddedEditor(element, { doc, languageId, readOnly,
onChange })` for this. It returns `read`, `write`, and `destroy`, and the caller keeps the text. The
element comes from a `Rectangle kind="editor"`, the same box the document surface uses, so getting the
keys in and out works the same. The grammar arrives after the first paint. The box has the shared
find panel, and a replacement reaches `onChange` like typing does.

The terminal client aliases that entrypoint (`apps/tui/src/kit/editor.ts`), so there
`mountEmbeddedEditor` does nothing and the rectangle keeps what it drew for cells. Workflows draws a
plain textarea there under `Only hosts={['tui']}`.
