// The published entry. Everything here comes through `@acorn/plugin-api/ui/sdk`, so this package
// cannot drift from the facade the in-repo plugins compile against — the surface snapshot
// (packages/plugin-api/src/surface.snapshot.txt) covers both by covering one.
//
// Only the frame SDK is published, and that is a statement about what CAN be, not a first slice of a
// larger plan. `./node`, `./client`, `./ui`, `./ui/host`, `./ui/diff`, `./ui/editor` and `./testkit`
// re-export node-core and client-core — hono, drizzle, Solid, Monaco — and a plugin does not want a
// second copy of any of them: it wants the host's, which it already has through `ctx` and through the
// document the frame is served in. The frame bridge is the one thing an out-of-tree author genuinely
// cannot obtain any other way, because the alternative is copying a handshake.
//
// `PLUGIN_BRIDGE_VERSION` is deliberately not re-exported. A frame does not compare it — `connect()`
// does that, and refuses a hello it does not recognise. Handing the number out invites a plugin to
// branch on it and pretend it supports two protocols.
export { AcornBridgeError, connect, mountFrame, openLinkOnClick } from '@acorn/plugin-api/ui/sdk'
export type { AcornBridge, PluginFrameContext } from '@acorn/plugin-api/ui/sdk'
