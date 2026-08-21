// Published entry point. Everything here re-exports @acorn/plugin-api/ui/sdk, so this package can't
// drift from the facade the in-repo plugins compile against; the surface snapshot
// (packages/plugin-api/src/surface.snapshot.txt) covers both by covering one.
//
// Only the frame bridge is published; the other seven entrypoints never will be, and
// `PLUGIN_BRIDGE_VERSION` is not part of what's published either. See docs/plugins.md § What is
// published, and what acorn promises about it.
export { AcornBridgeError, connect, mountFrame, openLinkOnClick } from '@acorn/plugin-api/ui/sdk'
export type { AcornBridge, PluginFrameContext } from '@acorn/plugin-api/ui/sdk'
