# acorn-plugin-sdk

The frame bridge for [acorn](https://github.com/jamesmacfie/acorn) plugins.

An acorn plugin's UI runs in a sandboxed iframe with no host DOM, no `window.acorn` and
`connect-src 'none'` — no `fetch`, no WebSocket, no network of any kind. Its only I/O is one
`MessagePort` the host transfers in. This package is what talks over it.

```sh
npm install acorn-plugin-sdk
```

```js
import { mountFrame, openLinkOnClick } from 'acorn-plugin-sdk'
import styles from './my-pane.css?inline'

mountFrame({ styles }, async (bridge, root) => {
  const { text } = await bridge.api.get(`/v2/p/my-plugin/greeting?taskId=${bridge.context.taskId}`)
  root.textContent = text
  root.addEventListener('click', (event) => openLinkOnClick(bridge, event))
})
```

`mountFrame` is the boot sequence every frame repeats — inject your stylesheet, make a root element,
mount the tooltip listener, connect, render, and draw the failure if the handshake never lands. It
takes a render callback rather than a component, so this package stays framework-free: inside your own
frame you may bundle anything, or nothing.

## You need a bundler for this

Your plugin's client half is served as **exactly one file**, so a bare specifier has nothing to resolve
against at runtime — bundling this package into your `client.js` is what makes the import work. That
output is one file, which is all the origin requires.

**If you would rather not run a bundler**, you do not need this package at all. Run
`npm create acorn-plugin`: it writes the whole no-bundler profile, handshake included, with no
dependencies. What you give up is the typed surface and the parts that are fiddly to redo — abort
signals, key-claim narrowing, subscribe bookkeeping, `mountFrame`'s failure rendering.

## What the bridge carries

`bridge.api` (five HTTP methods against your own namespace, or a core route your manifest declared a
scope for), `bridge.events.on`, `bridge.state` (durable, host-keyed, 1 MiB a value), `bridge.ui`
(toast, copy, openPane, openUrl, and the importer verbs), `bridge.document` for a pane composed over
the host's editor, `bridge.webview`, `bridge.keys.claim`, and the `onAppearance` / `onSelect` /
`onSurfaceAction` callbacks. `bridge.context` is a snapshot of what the frame was opened to look at.

Appearance is applied for you: the host pushes theme, style and the full token map on connect and on
every change, and the SDK writes them to `:root`, which is what makes the host's `/ui.css` classes and
your own `var(--bg)` rules resolve.

## Compatibility

A plugin that loads under a given `PLUGIN_API_MAJOR` keeps loading under it. Removing a name from this
surface requires that major to move — enforced in acorn's own tree, not by convention. A major bump is
a hard break with no deprecation window, and a manifest names its major by exact string match.

## Docs

`docs/plugin-authoring.md` in the acorn repository is the full authoring contract; `docs/plugins.md`
covers both plugin tiers and what is published. If an agent is writing the plugin, have it call the
`plugin_authoring` tool first — that answer is derived from the connected node's own schemas rather
than from memory.
