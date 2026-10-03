# Composed panes

This page covers a pane that combines a host-drawn document with a plugin's own region, how the two
talk, and which regions the host draws. Read it before you declare a `document-over-frame` pane. It's
part of [editor](../editor.md).

## Composed panes

A plugin frame's content security policy has `frame-src 'none'`
(`apps/desktop/src-tauri/src/plugin_scheme.rs`), so a plugin can't embed a host editor inside its
own frame. The host can, though: it places a host-owned editor and a plugin's region side by side in
its own DOM. So the host composes the pane, and the plugin supplies the document and the rest.

`document-over-frame`, and its sideways twin `frame-beside-document`, does this. The host splits the
pane, draws its editor in the `document` region, mounts the plugin's tree or frame in the other, and
owns the drag handle between them. To the task layout row it's one pane with one ID. The database pane
is the shipped example: the host draws the SQL editor, and the plugin draws the toolbar and results
below as a remote tree. [Pane layouts](../panes/layout.md#layout-model) owns the layout names and
their projections.

The pattern fits any pane where you write text in a real editor and the pane shows what the text does:
a GraphQL console, a source-and-preview pane, a config editor with live status, or a script over its
output. A plugin that needs one input line uses its own field. The template isn't a text-field
delivery mechanism.

### Which regions the host draws

A region is host-owned only when the sandbox can't serve its content. Common isn't the bar,
impossible is. A list and detail view is common, and a plugin's tree draws one. A document with
language services is impossible in the sandbox, and so is a live terminal. Those get host surfaces,
and nothing else does.

The button bar in a composed pane belongs to the plugin. Database's bar holds a saved-queries picker
with delete chips, a **Save** button that opens a dialog, a **Generate** button shown only when a
model connection exists, and a **Run** button disabled by connection status. That's common, not
impossible, so it's the first row of the plugin's region.

A dialog from a region can only cover that region. For database's two small prompts that's fine. The
`overlay` frame target ([frames](../plugins/frames.md)) is the heavier alternative, for when a cramped
dialog is a real problem.

## Communication between regions

The two regions share no DOM and no JavaScript realm. All traffic goes through the host, over the
bridge (`packages/client-core/src/host/frames/sdk/bridgePort.ts`), in both directions.

### Surface actions

Host to plugin, a surface action runs like this when you press ⌘Enter in the database editor:

1. The chord lands in the host's editor. `DocumentSurface` checks the reserved set, then resolves the
   chord against the same registry a frame's forwarded chords use, and finds `execute`. The shell's
   window dispatcher can't do this, because it refuses scoped bindings while a text field has focus.
2. The host flushes the document to the plugin's write route first. A surface action never runs
   against a stale document.
3. The host delivers the command to the plugin's region with the `surfaceAction` verb.
4. The plugin handles it as it would its own **Run** button click.

A `commands` entry names its verb, and `surfaceAction` names its surface instead of deriving it from
the keybinding, so the command also works from the palette
([palette data](../command-palette-and-shortcuts/palette-data.md#the-surfaceaction-verb)).

### The document API

Plugin to host, the bridge carries a small document API:

| Bridge call | Database uses it for |
| --- | --- |
| `bridge.document.read()` | The **Run** button reads the current SQL. |
| `bridge.document.write(text, { expectedText }?)` | The saved-queries picker and **Generate** put SQL into the editor. |
| `bridge.document.flush()` | Making sure the write route has the latest text before acting. |

`write` with `expectedText` compares the current text first and writes in the same step. A mismatch
rejects with `conflict` and keeps the current draft. Without the option, `write` replaces the text.
Each write uses the 2 MiB UTF-8 limit (`MAX_DOCUMENT_BYTES` in `packages/protocol/src/plugin/bridge.ts`).

The grant is structural. The host passes the document accessor only to a region that sits beside a
host document (`packages/client-core/src/host/frames/register.ts`), and its absence is the permission
check the broker applies. So there's no scope for a manifest to over-ask for. It reaches a `remote`
region and a `frame` region alike.

A multi-document surface would need one more call, "show this URI", which nothing above can do. The
editor plugin's move to the loaded tier needs it ([editor](../editor.md#limits)). Don't add cursor,
selection, or decoration calls until a real plugin can't ship without them, and check
[language smarts](./document-surface.md#language-smarts) first.
