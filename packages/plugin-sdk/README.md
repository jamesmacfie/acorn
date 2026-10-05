# acorn-plugin-sdk

The sandbox bridge for [acorn](https://github.com/jamesmacfie/acorn) plugin frames and trees.

An acorn plugin's UI runs in a sandbox with no host DOM or direct network access. The host transfers
one `MessagePort` for its I/O, and this package provides the bridge over that port.

```sh
npm install acorn-plugin-sdk
```

For a browser frame, import the root package:

```js
import { mountFrame, openLinkOnClick } from 'acorn-plugin-sdk'
import styles from './my-pane.css?inline'

mountFrame({ styles }, async (bridge, root) => {
  const { text } = await bridge.api.get(`/v1/p/my-plugin/greeting?taskId=${bridge.context.taskId}`)
  root.textContent = text
  root.addEventListener('click', (event) => openLinkOnClick(bridge, event))
})
```

`mountFrame` is the boot sequence every frame repeats — inject your stylesheet, make a root element,
mount the tooltip listener, connect, render, and draw the failure if the handshake never lands. It
takes a render callback rather than a component, so this package stays framework-free: inside your own
frame you may bundle anything, or nothing.

## Remote trees

A tree uses acorn's shared components in a desktop or terminal worker. Import `mountTree` from the
root package and the Solid adapter and components from `/remote`:

```tsx
import { mountTree } from 'acorn-plugin-sdk'
import { Card, Text, solidTree } from 'acorn-plugin-sdk/remote'

function Pane() {
  return <Card><Text>Plugin content</Text></Card>
}

mountTree({ pane: solidTree(Pane) })
```

The `pane` key matches the tree entry named in your manifest. Configure Solid's universal renderer
with `moduleName: 'acorn-plugin-sdk/remote'` when compiling JSX. Install `solid-js` for this path;
it is an optional peer dependency because frame-only plugins do not need it. See the
[tree authoring guide](https://github.com/jamesmacfie/acorn/blob/main/docs/plugins/frames.md) for the
manifest and build setup.

## Derived data sources

`acorn-plugin-sdk/data` is for a plugin's node half. `defineDerivedSource` builds a data source from
sources acorn already reads, such as Linear issues and GitHub pull requests. You declare the inputs
and the fields, and write one `query` function. Acorn reads the inputs with the accounts the person
picked, and the SDK answers every source operation and checks each record:

```ts
import { defineDerivedSource, field } from 'acorn-plugin-sdk/data'

export const source = defineDerivedSource({
  id: 'open-pulls', name: 'Open pull requests', singular: 'Pull request', plural: 'Pull requests',
  handler: '/v1/p/my-plugin/source',
  inputs: { pulls: { source: 'github:pull-requests', label: 'Pull requests' } },
  fields: { title: field.text({ label: 'Title', role: 'title' }) },
  async query({ inputs }) {
    const { records } = await inputs.pulls.all({ where: { state: 'open' } })
    return records.map((pull) => ({ id: pull.ref.recordId, opens: pull.ref, data: { title: String(pull.data.title) } }))
  },
})
```

`acorn-plugin-sdk/testing` runs that `query` against `fixtures('github:pull-requests', [...])`, records
built from the real source's fields. `npm create acorn-plugin <name> -- --data-source` writes a working
package with both. See `docs/plugin-authoring/derived-sources.md` in the acorn repository.

## You need a bundler for this

Your plugin's client half is served as **exactly one file**, so a bare specifier has nothing to resolve
against at runtime. Bundle the SDK, the optional Solid peer for a tree, and your code into `client.js`.

**If you would rather not run a bundler**, you do not need this package at all. Run
`npm create acorn-plugin`: it writes the whole no-bundler profile, handshake included, with no
dependencies. What you give up is the typed surface and the parts that are fiddly to redo — abort
signals, key-claim narrowing, subscribe bookkeeping, `mountFrame`'s failure rendering.

## What the bridge carries

`bridge.api` (five HTTP methods against your own namespace, or a core route your manifest declared a
scope for), `bridge.events.on`, `bridge.state` (durable, host-keyed, 1 MiB a value), `bridge.ui`
(toast, copy, openPane, openDestination, openTask, openUrl, and the importer verbs), `bridge.document` for a pane composed over
the host's editor, `bridge.webview`, `bridge.keys.claim`, and the `onAppearance` / `onSelect` /
`onSurfaceAction` callbacks. `bridge.context` is a snapshot of what the frame was opened to look at.

Appearance is applied for you: the host pushes theme, style and the full token map on connect and on
every change, and the SDK writes them to `:root`, which is what makes the host's `/ui.css` classes and
your own `var(--bg)` rules resolve.

## Compatibility

The host speaks loaded-plugin API major `2`. Your manifest can declare `"2"` or a range such as
`"1 || 2"` after you test against each included host major. Removing a published name or making an
incompatible shape change requires a new manifest API major. The npm version of `acorn-plugin-sdk`
is separate from that major. The repository guards published names and checks the SDK declarations
against the implementation.

## Docs

`docs/plugin-authoring.md` in the acorn repository is the full authoring contract; `docs/plugins.md`
covers both plugin tiers and what is published. If an agent is writing the plugin, have it call the
`plugin_authoring` tool first — that answer is derived from the connected node's own schemas rather
than from memory.
