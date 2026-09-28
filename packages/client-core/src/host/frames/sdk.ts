// The framework-free entrypoint bundled into a third-party plugin's frame or worker. Its imports
// stay inside this directory or reach framework-free modules. A foreign bundler includes every value
// import, so a host module or framework dependency here would cross the sandbox boundary.
// The bridge is scheme-agnostic: it receives a port and does not know how the host served the bundle.
// The implementation modules stay private to this package; authors import this stable entrypoint.
export { AcornBridgeError } from './sdk/bridgeTypes'
export type { AcornBridge, AcornBridgeApi, PluginByteResponse, PluginTelemetryAttrs } from './sdk/bridgeTypes'
export { connect, mountTree, _resetConnection } from './sdk/connection'
export type { TreeMount, TreeRender } from './sdk/treeChannel'
export { mountFrame, openLinkOnClick } from './sdk/frameMount'
