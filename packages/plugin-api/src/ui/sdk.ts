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
