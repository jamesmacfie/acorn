# Remote trees

This page covers the remote-tree render path and how a bundle's worker shares bridges between the
trees it mounts. Read [the tree contract](./tree-contract.md) for the wire format. It's part of the
[plugin reference](../plugins.md).

## Remote trees

A remote tree is the render path to use unless the surface owns its pixels. The bundle runs in a Web
Worker with no DOM and emits a tree: names of the host's own components, with props, as a stream of
mutations. The host mounts its components for those names, so the result has the shell's focus
handling, keyboard model, ARIA, and the reader's style pack. Every loaded plugin acorn ships with a
UI draws this way.

There are two ways to declare a tree, and they differ only in who owns the rectangle:

- A region of a surface this plugin declares names `{ "kind": "remote", "entry": "<name>" }` in its
  `regions`. The panes, reference panels, and settings pages of `http`, `database`, `linear`, and
  `rollbar` draw this way.
- A contribution into another plugin's point is a `contributions.extensions` entry with a `remote`
  key. [Remote points](./remote-points.md) lists the points and the props each one hands over.

An author writes the same code either way. `mountTree({ toolCard: … })` on `/ui/sdk` is the entry
point beside `mountFrame`. It's keyed by name, because one worker serves every tree the bundle
contributes. With a bundler, `@acorn/plugin-api/ui/tree`, published as `acorn-plugin-sdk/remote`,
carries the Solid adapter and the kit as JSX nodes. Without one, `npm create acorn-plugin <name>`
emits a single file that builds the same tree by hand.

Everything that crosses is data. A handler is an id the host mints a closure for. Text is a node,
never a prop. `class`, `style`, and every other way into the host's DOM are dropped, with a row on the
plugin's page. A node name this build doesn't know is omitted. A batch applies whole or not at all,
and a worker that stops answering is ended and removed from every place it contributed. The wire is
`@acorn/protocol/tree/`, the host is `client-core/src/host/tree/`, and the sandbox is in
[the client sandbox](../security/plugin-client-sandbox.md).

A tree isn't the right path for two things. UI that reacts per keystroke, such as a live filter over
a large list, pays a message hop per key and should be a frame. A surface whose pixels are the
product, such as an image editor, is a frame by definition.

## Mounted bridge ownership and SDK compatibility

The worker belongs to one accepted `(pluginId, hash)` pair, and authority belongs to each mounted
tree. The host supplies a separate bridge port and context for every mount: scope, selected item,
document access, focus, and gesture authority belong to that tree. It routes selection and surface
actions to that mount, and stops the worker at once if trust for its pair is revoked. A tree can't
claim another mount's authority by naming its slot.

The `treeSlotBridge: 1` and scoped-bridge handshakes are additive, so the bridge and tree protocol
versions don't change. A capable SDK receives a bridge port on each initial `tree:mount`, and
`TreeRender(bridge, mount)` receives that slot's bridge. Props updates reuse the port. Unmount removes
subscriptions and pending requests, rejects held requests with `unmounted`, closes the port, and
releases the remote root.

The bundle's bootstrap has initial metadata but no privileged API, state, document, or UI services. A
capable SDK's global `connect()` reports `treeBridgeMode: 'bootstrap'`. Use the bridge passed to
`TreeRender` to build services and models.

| SDK and host | Bridge ownership |
| --- | --- |
| Capable SDK and capable host | One bundle worker, one privileged bridge per mounted slot |
| Older SDK and capable host | One slot-bound worker per mounted tree |
| Capable SDK and older host | A usable global bridge with `treeBridgeMode: 'legacy'` and a warning |
| Older SDK and older host | The host's global first-context behavior |

An older SDK can't replace its module-global bridge or prove which tree produced a request or a
gesture. Each older worker therefore mounts one tree, under a fixed plugin and hash, query client,
Node, surface, task or project, permissions, document grant, and opening item. Equivalent concurrent
trees use separate workers, and the last lease ends its worker at once.

Classification promotes the detection worker on the older `connected` acknowledgement or its first
bridge API request. Top-level API work in an older bundle runs once per admitted worker. A retired
detection worker is ended before a replacement uses the surviving metadata.

Capable workers keep warm modules for 30 seconds, with at most 16 idle bundle workers. The host keeps
capability hints for at most 256 plugin and hash identities, and eviction doesn't affect live workers.
Each identity admits at most 512 live or reserved slots. Capable slots share one worker, and up to 512
older trees need 512 workers. The terminal factory settles native termination before it builds a
same-hash replacement.

A composed layout captures its query client's Node before lazy regions mount. It consumes its opening
`plugin:select` once and shares that opening item across its regions. Only an actual document region
grants document access. Withdrawing or replacing the document advances its generation and denies
bridges admitted under the previous one.

These guarantees cover API, cache, document, focus, and teardown. Pane intents still address a task
and pane, and plugin frame channels follow the selected Node. A bundle that embeds an older
remote-root implementation keeps its callback bookkeeping until it's rebuilt.
