// Solid, rendering into a remote root instead of a document.
//
// Small because it does not have to be a DOM. `solid-js/universal` exists for exactly this: the JSX
// preset is told `generate: 'universal'` and `moduleName: 'acorn-plugin-sdk/remote'`, and every
// element creation and property set in your components compiles to a call into this module rather
// than to `document.createElement` and a cloned template. So there is no DOM shim to write, no
// `innerHTML` parser, and nothing for a plugin to reach through.
//
// Its own entrypoint, never the package's index: `acorn-plugin-sdk` must stay loadable in a bare Node
// test with no framework, and a Solid import on the main barrel would end that — a barrel evaluates
// every module on it.
//
// Your build, whole:
//
// ```ts
// // vite.config.ts
// solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })
// ```
// ```tsx
// import { mountTree } from 'acorn-plugin-sdk'
// import { solidTree } from 'acorn-plugin-sdk/remote'
// mountTree({ toolCard: solidTree(ToolCard) })
// ```
import { createRenderer } from 'solid-js/universal'
import { createStore, reconcile } from 'solid-js/store'
import type { JSX } from 'solid-js'
import {
  createNode, createText, firstChild, insertNode as attach, isTextNode, nextSibling, parentOf,
  removeNode, setProperty, setText, type AcornBridge, type RemoteNode, type TreeRender,
} from 'acorn-plugin-sdk'

const renderer = createRenderer<RemoteNode>({
  createElement: createNode,
  createTextNode: createText,
  replaceText: setText,
  setProperty: (node, name, value) => { setProperty(node, name, value) },
  insertNode: (parent, node, anchor) => { attach(parent, node, anchor) },
  removeNode: (parent, node) => { removeNode(parent, node) },
  isTextNode,
  // Solid's walkers want `undefined` where there is nothing; the root speaks `null`, which is the
  // honest answer for "this node has no parent" and the one the wire uses.
  getParentNode: (node) => parentOf(node) ?? undefined,
  getFirstChild: (node) => firstChild(node) ?? undefined,
  getNextSibling: (node) => nextSibling(node) ?? undefined,
})

// What the JSX preset compiles against. The names are Solid's, not ours.
export const {
  render, effect, memo, createComponent, createElement, createTextNode, insertNode, insert, spread,
  setProp, mergeProps, use,
} = renderer

/**
 * Wrap a Solid component as a tree renderer.
 *
 * The props the host mounted with arrive as a store, so a redraw is a reconcile rather than a
 * teardown: a tool card whose call gains output re-renders the one line that changed, and the
 * mutation that crosses the port is a `text`, not a fresh tree.
 */
export function solidTree<P extends Record<string, unknown>>(
  component: (props: P & { bridge: AcornBridge }) => JSX.Element,
): TreeRender {
  return (bridge, mount) => {
    const [props, setProps] = createStore({ ...(mount.props() as P), bridge })
    mount.onProps((next) => setProps(reconcile({ ...(next as P), bridge })))
    // The cast is `JSX.Element` versus `RemoteNode`. Solid ships one `JSX` namespace and it is typed
    // for the DOM, so a universal renderer's component type can never line up with it. Nothing is
    // being asserted about the value: the renderer treats whatever comes back as opaque.
    const draw = component as unknown as (props: P & { bridge: AcornBridge }) => RemoteNode
    mount.onUnmount(render(() => createComponent(draw, props), mount.root.node))
  }
}
