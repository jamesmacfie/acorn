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
// `openLinkOnClick` is here rather than on ./ui beside `renderMarkdown`, even though a frame calls the
// two on the same line: it needs the bridge, and this is the entrypoint that has one.
// `mountFrame` is the boot sequence every frame repeats — stylesheet, root element, tooltips, connect,
// render — and it takes a render CALLBACK rather than a component precisely so this entrypoint stays
// framework-free.
export { connect, AcornBridgeError, mountFrame, openLinkOnClick } from '@acorn/client-core/plugins/frames/sdk.ts'
// `AcornBridge` is the whole bridge; `AcornBridgeApi` was its `.api` sub-shape, and nothing ever named the
// sub-shape on its own — a frame holds the bridge and calls through it.
export type { AcornBridge } from '@acorn/client-core/plugins/frames/sdk.ts'
// The context the host hands a frame on connect. Kept rather than pruned: the four things that name it
// today are all host-side and reach it through @acorn/protocol, and a frame that wants to type the
// context it was given has nowhere else to go.
export type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
