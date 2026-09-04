// Published entry point. Everything here re-exports @acorn/plugin-api/ui/sdk, so this package can't
// drift from the facade the in-repo plugins compile against; the surface snapshot
// (packages/plugin-api/src/surface.snapshot.txt) covers both by covering one.
//
// Only the frame bridge is published; the other ten entrypoints never will be, and
// `PLUGIN_BRIDGE_VERSION` is not part of what's published either. See docs/plugins.md § What is
// published, and what acorn promises about it.
export { AcornBridgeError, connect, mountFrame, openLinkOnClick } from '@acorn/plugin-api/ui/sdk'
export type { AcornBridge, PluginByteResponse, PluginFrameContext } from '@acorn/plugin-api/ui/sdk'
// The tree path, beside the frame path. Framework-free, so it belongs on this barrel; the Solid
// adapter that binds to it is `acorn-plugin-sdk/remote`, which is a separate entrypoint because this
// one has to stay loadable with no framework installed.
export {
  createNode, createText, firstChild, insertNode, isTextNode, mountTree, nextSibling, parentOf,
  removeNode, setProperty, setText,
} from '@acorn/plugin-api/ui/sdk'
export type { RemoteNode, RemoteRoot, TreeMount, TreeRender } from '@acorn/plugin-api/ui/sdk'
