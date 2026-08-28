# The remote tree: how third-party UI reaches the host's components

Part of [docs/future/layout/](./README.md). A remote tree is what a plugin's sandboxed code emits
instead of pixels: a tree of kit node names with props, streamed as mutations to the host, which
mounts its own components for each node and posts events back. It is the tier between "a list of
facts" (descriptors) and "an iframe" (rectangles), and it is the reason a tool card, a sidebar tab, and
a settings section can come from a plugin acorn has never heard of.

## Two render paths, one API

This was decided with the owner and is settled. First-party plugins render **directly**: their
components produce the same kit nodes and layouts, mounted in the shell's Solid realm with no
serialisation. Third-party plugins render through the **remote root**: their code runs in a Web
Worker and the tree crosses a message port. Both paths produce the same tree, so a `Slot` in a
first-party region can be filled by a third-party subtree and vice versa, and every rule below about
validation and focus applies to the remote path because the direct path is trusted by construction.

An author writes the same code either way:

```tsx
import { Card, Fold, KeyValue, StatusDot, Text } from '@acorn/plugin-api/ui'

export function ToolCard(props: AgentToolRendererProps) {
  return (
    <Card>
      <StatusDot tone={props.tool.status === 'completed' ? 'ok' : 'accent'} />
      <Text emphasis="strong">{props.tool.title}</Text>
      <Fold label="Changed files" defaultOpen={props.defaultOpen} onOpenChange={props.onOpenChange}>
        {props.tool.output.files.map((f) => <Text emphasis="mono">{f.path}</Text>)}
      </Fold>
    </Card>
  )
}
```

The difference is the entry point. A first-party plugin registers the component. A loaded plugin's
bundle calls `mountTree(render)` from `@acorn/plugin-api/ui/sdk`, beside today's `mountFrame`, and
the Solid adapter renders to a remote root instead of a document.

## The wire format

Lives in `@acorn/protocol` beside the frame verbs, so the node can validate a bundle's declared
nodes at install and the client can validate the stream at runtime.

**Nodes.** `{ id, type, props, children }`. `type` is a kit node name. `id` is minted by the
sandbox adapter and stable for the node's life; it is what events and patches address. `props` is a
plain object; text is a `Text` node or a string child, never an attribute.

**Mutations.** A batch per animation frame, in order: `insert(parentId, index, node)`,
`remove(id)`, `patch(id, props)`, `move(id, parentId, index)`, `text(id, value)`. A batch is applied
atomically or dropped whole with a roster-row failure; the host never renders half a batch.

**Events, host to sandbox.** `{ id, event, payload }` where `event` is one of the kit's semantic
events: `onPress`, `onChange` (commit), `onSubmit`, `onSelect`, `onActivate`, `onToggle`,
`onOpenChange`, `onExpand`, `onDismiss`, `onPick`, `onRemove`. Never a raw key or pointer event.
Payloads are the kit's, not the plugin's: an `onSelect` carries the item key, an `onChange` carries the
committed value.

**Lifecycle.** `mount(slotId, props)` and `unmount(slotId)` from host to sandbox, so one worker
serves many trees (a tool card per call, a section per tray) and knows which is which.

## Validation, every message

The host is the only thing between a stranger's code and the shell's DOM, so every message is
checked before it does anything.

- `type` is in the kit and is `full` or `reduced` on this host (`NODE_SUPPORT` in
  [04-kit.md](./04-kit.md)). Anything else renders the labelled placeholder ("part of *plugin* this
  version of acorn cannot draw") and records a roster row. This is the forward-compatibility rule
  `docs/plugins.md` already has, applied to nodes.
- `props` validate against that node's schema: role enums only, no `class`, no `style`, no `on*`
  function (handlers are ids the host maps back, never functions). A failing prop is dropped, the
  node still renders, the roster row says which prop.
- Text is set with `textContent`. `Markdown` goes through the transcript markdown policy the agents
  pane already uses (`client-core/src/ui/markdown.ts`). A `Button` carries a handler id, never a URL
  or a command id; navigation is `bridge.ui.openUrl` as today.
- Size caps: a batch is bounded in bytes and node count, and a tree is bounded in depth and total
  nodes, with the same shape of limit the state channel has (1 MiB per value). Past the cap the
  batch is dropped and recorded.
- Rate: batches are coalesced per frame on the host side; a sandbox that floods is throttled, not
  trusted.

## The sandbox: one worker per bundle

Decided with the owner: a **Web Worker**, not the hidden iframe. One worker per plugin bundle,
started when the first of its trees mounts and stopped when the last unmounts plus a grace period.

What the worker has: the plugin's bundle, the Solid remote adapter, the bridge. What it does not
have: a DOM, `fetch`, `importScripts` after boot, or any handle to another plugin's worker. The bridge
is today's `MessageChannel` bridge with the transport swapped from iframe to worker; the choke points
stay exactly where they are: `client-core/src/plugins/frames/sdk.ts` (the plugin-side surface),
`frames/broker.ts` (the host-side dispatcher), `frames/verbs.ts` (the one list both sides compile
against), `frames/scopes.ts` (what a bundle may reach, by manifest). API calls go through the bridge
and are scoped by `permissions.api` as today; state is `state.get`/`state.set` as today; the plugin's
own live channel is `events.on` as today.

Trust is unchanged. The bundle hash is what the device accepts, the prompt is the same prompt, and a
withheld bundle mounts nothing. A worker is the same bytes with a different host.

Failure containment: a worker that throws during `mount` renders the placeholder for that slot; a
worker that stops answering is terminated and every tree it served shows the placeholder; a batch
that fails validation is recorded and dropped. None of it reaches the owner's tree.

## Slots are nodes

Once an owner draws through the tree, an extension point is a node in it:

```tsx
<Slot point="attachment" mode="replace" key={selected?.mime}>
  <AttachmentChip file={selected} />
</Slot>
```

The host resolves the point (`agents:attachment`), finds the contributors, arbitrates by `mode` and
`key` ([03-extension-kinds.md](./03-extension-kinds.md)), asks each winning contributor's worker to
`mount` into the slot, and grafts the resulting subtree at the node. The owner's children are the
default, drawn when nobody matches. Neither side sees the other's nodes; the graft is a host
operation on two trees that are both data.

Provenance is stamped: a grafted subtree renders inside a host frame that names the contributing
plugin, the same way `pane.footer` groups do.

## Inputs, state, and the message hop

Every interaction in a remote tree is a message hop. A click or toggle is a few milliseconds and
fine. Per-keystroke UI is not, so:

- `Input`, `Textarea`, `Composer` are **host-owned and uncontrolled**. The host holds the live value
  and sends `onChange` on commit (blur, Enter, or a debounce the kit fixes), never per key.
- Anything that must react per keystroke (a live filter over a large list, a query editor with
  completions) is a rectangle or a host-owned document region, and the kit says so in the node's
  docs.

State lives in the sandbox and sandboxes die on unmount. Nothing about a tree is persisted. On
remount the plugin re-renders from its own state or its routes, and anything worth keeping went
through `state.set`. This is the contract frames already have and the one the events design insists
on (state, not deltas).

## Rectangles remain

`Rectangle kind="pty" | "webview" | "frame"` is a kit node whose contents the host does not draw.
`frame` is today's iframe path in full: `app-plugin://<hash>`, `plugin_scheme.rs`'s CSP,
`PluginFrame.tsx`, `claimsKeys`. It survives for surfaces that own pixels (an image editor, a chart
library, a rich editor) and is priced honestly as DOM-only. Monaco stays host-owned behind
`document-over-frame` and is not a plugin rectangle.

## The SDK

- `mountTree(render: (bridge, root) => void)` on `@acorn/plugin-api/ui/sdk` and published through
  `acorn-plugin-sdk`. `root` is the remote root; `bridge` is the same `AcornBridge`.
- The Solid adapter: a small remote-dom-style DOM shim the Solid runtime renders into, translating
  element creation and property sets into node inserts and prop patches. Vanilla DOM code against
  the shim works too; the kit is the constraint, not the framework.
- `create-acorn-plugin` emits a tree plugin by default from phase 9; the frame template remains
  behind a flag for rectangle plugins.

## Tests

- Protocol: every kit node has a props schema; a fuzz over the mutation stream never produces an
  unhandled exception in the host renderer; a batch over the cap is dropped whole.
- Host renderer, in the jsdom `hosts` tier: a fixed tree renders to the expected kit components;
  a `patch` re-renders only the patched node; `move` preserves focus and collection state.
- Worker: a bundle that throws on `mount` yields the placeholder and a roster row; a worker
  terminated mid-batch leaves the owner's tree intact; two trees from one bundle share a worker.
- Slot: a `replace` slot with no match draws the default child; with two matches draws the user's
  pick; provenance frame names the contributor.
- The changes tool card, moved first, renders identically through the direct path and through a
  worker in a test that mounts both and diffs the DOM.

## Doors left open

- The wire format names nothing about the DOM. A terminal host applies the same mutations to a cell
  buffer.
- Events are semantic (`onPress`), never keys, so a terminal host maps its keys to the same events.
- The worker is one sandbox implementation behind a small interface; a terminal host uses a Node
  worker thread against the same interface.
