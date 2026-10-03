# The tree contract

This page is the wire format between a remote tree's sandbox and the host. Read it when you change
`packages/protocol/src/tree/` or write a host. It's part of the [plugin reference](../plugins.md).

## The tree contract

The contract is one list both ends compile against, and neither end may use the other's copy. Nothing
in it names the DOM, so a terminal renderer applies the same mutations to cells.

The terminal client, `acorn` in a terminal ([tui](../tui.md)), is a second host. It applies these
mutations to cells in `apps/tui/src/plugins/TreeHost.tsx`. The store, the whole-batch check, the prop
sanitizer, and the place a handler id becomes a closure are in
`packages/client-core/src/host/tree/treeState.ts`, which both hosts import. Each host owns its table
of components, its failure boundary, and when a batch flushes. The sandbox is a Web Worker under a
CSP on the desktop and a `node:worker_threads` thread under `--permission` in the terminal, with the
same two ports and handshake ([the client sandbox](../security/plugin-client-sandbox.md)).

A host's table maps a kit node name to a component or to a loader
(`packages/client-core/src/host/tree/components.ts`, `apps/tui/src/kit/components.tsx`). Heavy names,
such as the diff viewer, `Markdown`, `Timeline`, and `ModelBackendPicker`, are loaders, so the table
doesn't pull every component into one chunk (`packages/client-core/src/host/tree/kitEntry.ts`). Each
root draws under a `Suspense` with a `null` fallback, so a tree that names a heavy node draws nothing
for one frame, then draws it.

### Nodes

A node is `{ id, type, props, children }`:

- `type` is a kit node name.
- `id` is minted by the sandbox adapter and stays stable for the node's life. Events and patches
  address it.
- `props` is a plain object. A prop can't hold more UI. A shell component may accept a JSX slot such
  as `Tabs.actions`, but a tree spells that as a child or sibling node.
- Text is its own node, `#text`, never an attribute.

The sandbox copies JSON data out of framework proxies before posting, leaves out `undefined` fields,
and drops a prop holding a function, a cycle, or a class instance. The host validates props one at a
time and draws the node without the ones it refused, so a kit node reads its props defensively.

### Mutations

There are five mutation kinds, sent in a coalesced batch: `insert(parent, index, node)`, `remove(id)`,
`patch(id, props)`, `move(id, parent, index)`, and `text(id, value)`. `parent: null` addresses the
slot's root. A batch applies atomically or is dropped whole, with a row on the plugin's page.

The host checks a batch by simulating it against a copy of the parent map and a child index, so each
operation is judged against the tree the earlier operations left. A `remove` takes its subtree out of
the projection by walking down the index, so a batch costs its own operations, not the whole tree.
On September 3, 2026, emptying a tree at the 5,000-node cap took 71 ms this way, against 1.1 seconds
for the earlier scan of every node.

After simulating, the host walks the final tree once to check every node's depth. Unknown nodes and
cycles refuse the whole batch. A batch may deepen descendants for a moment before moving them again,
because rendering sees only the validated final state.

### Events

The host sends 12 events to the sandbox: `onPress`, `onChange` (the committed value), `onSubmit`,
`onSelect`, `onActivate`, `onToggle`, `onOpenChange`, `onExpand`, `onDismiss`, `onPick`, `onRemove`,
and `onConfirm`. There's no key or pointer event, because a terminal host has neither and maps its own
keys onto these names. A prop named in the list carries a handler id. Any other prop whose name starts
with `on` is dropped.

### Lifecycle

The host sends `tree:mount(slot, entry, props)` and `tree:unmount(slot)`. The sandbox sends
`tree:ready`, `tree:batch`, and `tree:failed`, plus a ping. One worker serves many trees, so every
message names its slot. A second `tree:mount` for a mounted slot is a props update.

### Asking the host

One message expects an answer: `tree:host-request(slot, id, op, name, payload)`, answered with
`tree:host-reply(slot, id, ok, body | error)`. There are two operations. `owner.invoke` calls an action
the point's owner declared, and `overlay.open` presents this contribution's companion overlay
([asking the owner](./remote-points.md#asking-the-owner)). `id` is the sandbox's own sequence. A
payload or reply over 64 KiB is refused, eight may be outstanding per slot, and an owner has 10
seconds to answer. The failure answer is a code and a sentence, never a host stack.

The request rides the tree channel, because its slot is the host's authority for the extension
point. The host binds the request to the channel and slot that mounted it, so plugin code supplies no
authority id. The host checks the slot generation before admitting and publishing a result, so a
retired slot's result can't reach another slot that reused its id.

### Validation and limits

The host validates every message:

- `type` must be a node this build knows and can draw on this host. Anything else is omitted.
- A prop value is a handler id or plain JSON, limited to 16 levels, 10,000 values, and 1 MiB of
  characters. `class`, `className`, `style`, `classList`, and nested host handles such as `item` and
  `drag` are refused. A role prop carrying a raw color is refused. A failing prop is dropped, and the
  row says which.
- Text is set as text. `Markdown` goes through the shell's markdown policy. An `href` prop accepts an
  explicit HTTPS URL only, and the kit checks every rendered anchor again.

`TREE_LIMITS` in `packages/protocol/src/tree/messages.ts` holds the caps: 1 MiB and 4,000 mutations
per batch, 5,000 live nodes and 64 levels per tree, 65,536 characters per text node, and 512 live or
reserved slots per bundle. The host checks message depth and size before parsing and measures batch
bytes itself.

The pending queue has the same 4,000-mutation and 1 MiB limits. Overflow clears the queue, cancels its
flush, records one refusal, and fails that mounted tree, which then needs a remount. Batches coalesce
per animation frame on the desktop and per timer turn in the terminal. A hidden desktop window flushes
on a zero-delay timer, and a visible one falls back to a 100 ms timer if its frame stalls.

The version travels in the handshake as `TREE_PROTOCOL_VERSION`, and a mismatch leaves the
contribution empty. `packages/protocol/src/tree/nodes.ts` carries the node names, the events, and the
role enums as plain constants with no Zod, because it's bundled into plugins. `messages.ts` holds the
schemas the host parses with. A client-core test fails when the kit and these lists disagree.
