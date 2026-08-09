// The bridge a third-party plugin's client bundle talks to the shell through
// (docs/plugins.md).
//
// Its own entrypoint rather than a section of ./ui, and this is the one split in the package that is
// about the RUNTIME rather than about components. A plugin's client bundle runs inside a sandboxed
// frame: no host DOM, no `window.acorn`, no network, one MessagePort. Nothing on ./ui can run there —
// Solid components reach for `window` at module scope and expect the shell's realm — so a bundle that
// imported the design-system barrel to get `connect` would pull in a shell it cannot use.
//
// Everything here is framework-free by construction. Inside its own frame a plugin bundles whatever it
// likes; what it needs from us is this port and the appearance tokens that come down it.
export { connect, AcornBridgeError } from '@acorn/client-core/plugins/frames/sdk.ts'
export type { AcornBridge, AcornBridgeApi } from '@acorn/client-core/plugins/frames/sdk.ts'
export type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
