// Solid, rendering into a remote root instead of a document, and the kit as nodes you can write in
// JSX (docs/plugins.md § Loaded plugins: the client half).
//
// This is the sandbox half of the tree path, so the rules at the top of ./sdk.ts apply here too: it
// runs inside a stranger's worker, it touches no `window`, and a foreign bundler bundles it. It is
// reached from a plugin as `@acorn/plugin-api/ui/tree`, and from a published plugin as
// `acorn-plugin-sdk/remote`, which is a re-export of this file.
//
// Small because it does not have to be a DOM. `solid-js/universal` exists for exactly this: the JSX
// preset is told `generate: 'universal'` and `moduleName: '@acorn/plugin-api/ui/tree'`, and every
// element creation and property set in your components compiles to a call into this module rather
// than to `document.createElement` and a cloned template. So there is no DOM shim to write, no
// `innerHTML` parser, and nothing for a plugin to reach through.
//
// Your build, whole: take `mountTree` from the SDK entrypoint and the nodes and `solidTree` from this
// one, and hand `mountTree` a renderer per surface — `mountTree({ toolCard: solidTree(ToolCard) })`.
// The builder points the preset here; there is no framework key to name, because Solid is the only
// thing a tree bundle compiles through.
import { createRenderer } from 'solid-js/universal'
import { createStore, reconcile } from 'solid-js/store'
import type { JSX } from 'solid-js'
import { KIT_NODES, type KitNodeName } from '@acorn/protocol/tree/nodes.ts'
import type { AcornBridge, TreeRender } from './sdk'
import {
  createNode, createText, firstChild, insertNode as attach, isTextNode, nextSibling, parentOf,
  removeNode, setProperty, setText, type RemoteNode,
} from './remoteRoot'

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
 * What a kit node takes here: anything, checked on arrival.
 *
 * Loose on purpose. The host validates every prop against the wire schema before it reaches a
 * component (@acorn/protocol/tree/props.ts), so a narrow type here would be a second, drifting copy
 * of a rule that is already enforced where it matters. What it does buy is the shape of the value: a
 * function survives only under one of the kit's eleven event names, and `class`, `style` and the rest
 * of the DOM escape hatches are dropped before they cross.
 */
export type KitNodeProps = Record<string, unknown> & { children?: unknown }

/**
 * One kit node as a component.
 *
 * A remote tree names types, not functions, so `<Card>` has to compile to "make a node called Card".
 * Solid's JSX compiler treats a capitalised tag as a component call, which is why each name is a
 * function rather than a string: the function is where the name is minted.
 *
 * `spread` is the renderer's own, so children and reactive props are handled by the same code Solid
 * would use on a DOM element — a prop that changes patches one node, and a list that grows inserts
 * one child.
 */
const kitNode = (type: KitNodeName) => {
  const node = (props: KitNodeProps): RemoteNode => {
    const own = createNode(type)
    spread(own, props, false)
    return own
  }
  // Solid ships one `JSX` namespace and it is typed for the DOM, so a universal renderer's component
  // can never line up with it. Nothing is being asserted about the value: the renderer treats what
  // comes back as opaque, and this cast is what lets an author write ordinary JSX.
  return node as unknown as (props: KitNodeProps) => JSX.Element
}

/** Every kit node, keyed by name. The named exports below are this object, destructured. */
export const KIT_NODE_COMPONENTS = Object.fromEntries(
  KIT_NODES.map((name) => [name, kitNode(name)]),
) as Record<KitNodeName, (props: KitNodeProps) => JSX.Element>

// Destructured rather than written out one `export const` at a time, so the list cannot drift from
// `KIT_NODES`: a name here that the kit does not have is a type error, and a name the kit has that is
// missing here is caught by ./remoteSolid.test.ts.
export const {
  Stack, Inline, Section, Fold, Card, Timeline, Tabs, Toolbar, Modal, ModalBody,
  ModalActions, Menu, Popover, ListDetail, ListColumn, DetailColumn, SplitHandle, DocumentTabs,
  SectionHeader, TabPanel, ToolbarSpacer, Text, Link, Heading, Rows, Row, TreeRow, RowActions, Badge, Chip,
  ChipRow, StatusDot, Facts, DescriptionList, Table, TableHead, TableRow, TableCell, Grid, Meter, CodeBlock, Log, Markdown, DiffPane,
  DiffLine, FileHead,
  NonCodeRow, SplitCell, EmptyState, Alert, Spinner, Kbd, UserAvatar, Icon, Button, Input, Textarea,
  Select, Checkbox, SegmentedControl, ToggleButton, Picker, PickerRow, Composer, MentionTextarea,
  KeyValueEditor, FindBar, Field, ConfirmButton, CopyButton, ModelConnectionPicker, Rectangle, Only,
  Fallback,
} = KIT_NODE_COMPONENTS

/**
 * Wrap a Solid component as a tree renderer.
 *
 * The props the host mounted with arrive as a store, so a redraw is a reconcile rather than a
 * teardown: a pane whose data gains a line re-renders that line, and the mutation that crosses the
 * port is a `text`, not a fresh tree.
 */
export function solidTree<P extends Record<string, unknown>>(
  component: (props: P & { bridge: AcornBridge }) => JSX.Element,
): TreeRender {
  return (bridge, mount) => {
    const [props, setProps] = createStore({ ...(mount.props() as P), bridge })
    mount.onProps((next) => setProps(reconcile({ ...(next as P), bridge })))
    // The same cast `kitNode` makes, for the same reason.
    const draw = component as unknown as (props: P & { bridge: AcornBridge }) => RemoteNode
    mount.onUnmount(render(() => createComponent(draw, props), mount.root.node))
  }
}
