# The client half

This page covers how a loaded plugin's client bundle draws: as a tree of acorn's components, or as a
frame. It's part of [plugin authoring](../plugin-authoring.md). The bridge both use is in
[the bridge](./the-bridge.md).

## The client half

Your client output is one JavaScript file with no unresolved imports. The scaffold inlines the bridge
and the tree protocol, so a tree needs no bundler.

## Two ways to draw

**A tree** is the one to use. Your code runs in a Web Worker with no DOM and emits a tree of acorn's
component names, and the host mounts its own components for them. The result has the shell's focus
behavior, keyboard handling, ARIA, and appearance, and you ship no stylesheet. The loaded plugins
acorn ships, such as `http`, `database`, `linear`, and `rollbar`, draw this way.

**A frame** is an iframe with your own document in it. Use it for a surface that owns its pixels, such
as a canvas, a chart library, or a rich editor. It's DOM-only, gets no focus or key handling from the
host, and keeps a stylesheet of its own. See [the frame path](#the-frame-path).

## Drawing a tree

The repository builder points your JSX preset at the remote adapter, so components compile into
acorn's tree instead of a document. Your config names the entry:

```js
// acorn-plugin.config.mjs
client: { entry: './src/tree/index.tsx' }
```

```tsx
import { mountTree } from '@acorn/plugin-api/ui/sdk'
import { Button, Heading, Stack, Text, solidTree } from '@acorn/plugin-api/ui/tree'

function IssuePane(props: { taskId?: string; bridge: AcornBridge }) {
  return (
    <Stack gap="section">
      <Heading level={1} eyebrow="ENG-4102">Retries never back off</Heading>
      <Text tone="muted">Opened 3d ago</Text>
      <Button onPress={() => void props.bridge.ui.toast('hello')}>Say hello</Button>
    </Stack>
  )
}

mountTree({ pane: solidTree(IssuePane) })
```

An outside bundle imports the same names from `acorn-plugin-sdk` and `acorn-plugin-sdk/remote`.

The manifest says which renderer fills which region. A surface names a `layout` and fills its
`regions`, and `single` is the layout for a surface that's one tree:

```json
{ "target": "pane", "id": "issues", "label": "Issues",
  "layout": "single", "regions": { "body": { "kind": "remote", "entry": "pane" } } }
```

A pane may name any layout ([pane layouts](../panes/layout.md)). A reference panel and a settings page
name `single`. All three must name one, and a surface that wants its own pixels says
`"regions": { "body": "frame" }`.

Four rules follow from the tree being data on a message port, and the host checks each on arrival:

- **Only acorn's components.** An unknown node name draws a labeled placeholder and records a row on
  your plugin's page. `class`, `style`, `innerHTML`, and `ref` never cross.
- **Only acorn's events.** A function survives as a prop only under one of 12 names: `onPress`,
  `onChange`, `onSubmit`, `onSelect`, `onActivate`, `onToggle`, `onOpenChange`, `onExpand`,
  `onDismiss`, `onPick`, `onRemove`, and `onConfirm`. Key, pointer, and paste handlers are dropped,
  because a terminal host has none of them.
- **No element or callback in a prop.** A prop is JSON. `Facts` takes strings, `Picker` takes `items`,
  and a split is a `ListDetail` with `ListColumn` and `DetailColumn` children.
- **Text fields commit, they don't stream.** You get an `Input`, `Textarea`, or `Composer` value on
  blur, on Enter (`onSubmit`), or on submit, never per keystroke.

Your subject comes from the mount props. A pane tree is mounted with `{ taskId, projectId }`, and a
project pane or reference panel with `{ item }`. `bridge.onSelect` and `bridge.onSurfaceAction` reach
you as they reach a frame.

### Asking the host for something

A tree that fills another plugin's slot can't change what it draws or open a rectangle through props.
Two methods on the mount cover both:

```tsx
mountTree({
  // `solidTree` puts `host` on your props beside `bridge`. Both stay the same for the mount's life.
  attachmentPreview: solidTree((props) => (
    <Button onPress={async () => {
      const result = await props.host.openOverlay('editor', { taskId: props.taskId, attachmentId: props.attachment.id })
      if (!result) return                       // dismissed; nothing happened
      await props.host.invoke('replace', { expectedAttachmentId: props.attachment.id, ...result })
    }}>Edit {props.attachment.filename}</Button>
  )),
})
```

Writing the renderer without `solidTree`, `host` is the second argument, `mount.host`.

- `host.invoke(action, payload)` calls an action the owning point declared and the owner bound to that
  slot. Learn the names from the owner's published `actions`. The owner decides, so handle a
  rejection.
- `host.openOverlay(overlayId, input)` presents the one overlay your extension names in `overlay`. It
  must be a frame in your own manifest with `"target": "overlay"`, and naming it opens it, so you don't
  need a command. Inside it, `bridge.context.input` is what you passed, and `bridge.ui.close(result)`
  resolves the call. Every dismissal resolves with `null`.

Three things refuse you. Call `openOverlay` from a press or key handler, because the host honors it
only after a person's action and at most once a second. Keep payloads, inputs, and results under 64 KiB
of JSON, and pass an id instead of bytes. Catch `unsupported_host`: the terminal draws trees but has no
iframe for an overlay ([remote points](../plugins/remote-points.md#asking-the-owner)).

## The frame path

A frame is a host-generated iframe document. The shell serves it from a content-addressed cache on
`app-plugin://<bundle-hash>/`, and the handler (`apps/desktop/src-tauri/src/plugin_scheme.rs`)
answers these paths: `/` and `/index.html`, the generated document; `/ui.css`, the host's shared
stylesheet; `/client.js`, your file; and `/worker.html` and `/worker-host.js`, the host's relay
document for a tree worker.

Everything else answers 404. That's the single-file rule: a second module, a stylesheet, an image, or a
font can't be fetched. Inline them, and the CSP allows `img-src 'self' data:` for images.
`connect-src 'none'` means a frame has no network at all: `fetch`, XHR, WebSocket, `sendBeacon`, and
EventSource all fail. Its only input and output is the `MessagePort` the host transfers in. The
document loads your file as a module script, so any framework works, and plain DOM fits well.

`window.confirm` and `alert` are suppressed, so `confirm()` returns `false`. `navigator.clipboard`
refuses to write. Use the bridge's `ui.copy`, and draw your own confirmation ([frames](../plugins/frames.md)).
