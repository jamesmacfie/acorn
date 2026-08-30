// The bridge a third-party plugin's client bundle talks to the shell through, its own entrypoint
// because nothing on ./ui can run inside the sandboxed frame that bundle loads into (Solid reaches
// for `window` at module scope). See docs/plugins.md § Loaded plugins: the client half for the
// frame's full sandbox and the `mountFrame` boot sequence.
//
// `openLinkOnClick` is here rather than beside `renderMarkdown` on ./ui because it needs the bridge.
export { connect, AcornBridgeError, mountFrame, openLinkOnClick } from '@acorn/client-core/plugins/frames/sdk.ts'
// `AcornBridge` is the whole bridge. `AcornBridgeApi` was its `.api` sub-shape, and nothing ever named
// the sub-shape on its own.
export type { AcornBridge } from '@acorn/client-core/plugins/frames/sdk.ts'
// The context the host hands a frame on connect. Kept rather than pruned: the four things that name it
// today are all host-side, and a frame that wants to type the context it was given has nowhere else to go.
export type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'

// ── The tree path ─────────────────────────────────────────────────────────────────────────────────
// The second way a sandboxed bundle draws: a tree of the host's own kit nodes instead of pixels
// (docs/plugins.md § The tree contract). Same bundle, same bridge, same sandbox rules; what differs
// is that the host mounts its components for the names the tree carries, so the result inherits focus,
// keys, ARIA and the reader's style pack.
//
// `mountTree` is here beside `mountFrame` because the choice between them is the whole difference
// between the two paths, and a bundle makes it in one line.
export { mountTree } from '@acorn/client-core/plugins/frames/sdk.ts'
export type { TreeMount, TreeRender } from '@acorn/client-core/plugins/frames/sdk.ts'
// The remote root's mutators, as free functions. This is the surface a framework adapter binds to —
// `acorn-plugin-sdk/remote` is Solid's, in a dozen lines — and vanilla code can call them directly.
export {
  createNode, createText, firstChild, insertNode, isTextNode, nextSibling, parentOf, removeNode,
  setProperty, setText,
} from '@acorn/client-core/plugins/frames/remoteRoot.ts'
export type { RemoteNode, RemoteRoot } from '@acorn/client-core/plugins/frames/remoteRoot.ts'
