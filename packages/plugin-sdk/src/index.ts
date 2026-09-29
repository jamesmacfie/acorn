// Published entry point. Everything here re-exports @acorn/plugin-api/ui/sdk. The public name guard
// in tools/arch/publishedPluginSurface.test.ts and the type checks in contract.test.ts cover this
// package independently of the private facade snapshot.
//
// Only the sandbox bridge is published. `PLUGIN_BRIDGE_VERSION` stays internal to the handshake.
export { AcornBridgeError, connect, mountFrame, openLinkOnClick } from '@acorn/plugin-api/ui/sdk'
export type { AcornBridge, PluginByteResponse, PluginFrameContext, PluginTelemetryAttrs } from '@acorn/plugin-api/ui/sdk'
// The tree path, beside the frame path. Framework-free, so it belongs on this barrel; the Solid
// adapter that binds to it is `acorn-plugin-sdk/remote`, which is a separate entrypoint because this
// one has to stay loadable with no framework installed.
export {
  createNode, createText, firstChild, insertNode, isTextNode, mountTree, nextSibling, parentOf,
  removeNode, setProperty, setText,
} from '@acorn/plugin-api/ui/sdk'
export type { RemoteNode, RemoteRoot, TreeMount, TreeRender } from '@acorn/plugin-api/ui/sdk'
