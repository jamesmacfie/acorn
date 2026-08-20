import { expect, it } from 'vitest'
import * as sdk from './index.ts'
import type * as Published from './public.ts'
import type { AcornBridge, PluginFrameContext } from './index.ts'

// The drift lock for the hand-written published declaration.
//
// `public.ts` is copied verbatim to `dist/sdk.d.ts`, so it's what every out-of-tree plugin type-checks
// against. Nothing in the compiler connects it to the implementation, which is the price of not running
// a declaration rollup, so the connection is made here and `tsc --noEmit` enforces it. A shape that
// moves underneath a stable name fails at the assignment below, which is the gap the surface snapshot
// can't see: it pins names, and names aren't what breaks a stranger's build.
//
// Assignability is asserted in both directions per type. One direction alone passes happily when the
// published type is a subset: drop a method from `ui` and the published bridge still accepts a real one.

/** Both directions means structurally identical. A type error here is the point of the file. */
type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]

// Not `import * as Published` compared wholesale: this package exports two webview payload types the
// facade doesn't name, so namespace-level comparison would fail for a reason that isn't drift. Per-type
// also names the offender when it does break.
const _bridge: Mutual<AcornBridge, Published.AcornBridge> = [true, true]
const _context: Mutual<PluginFrameContext, Published.PluginFrameContext> = [true, true]
const _error: Mutual<InstanceType<typeof sdk.AcornBridgeError>, InstanceType<typeof Published.AcornBridgeError>> = [true, true]
const _connect: Mutual<typeof sdk.connect, typeof Published.connect> = [true, true]
const _mount: Mutual<typeof sdk.mountFrame, typeof Published.mountFrame> = [true, true]
const _link: Mutual<typeof sdk.openLinkOnClick, typeof Published.openLinkOnClick> = [true, true]
void [_bridge, _context, _error, _connect, _mount, _link]

it('evaluates in a bare node environment, with no DOM and no shell', () => {
  // The canary for the property that makes this package publishable at all: its import closure reaches
  // nothing but protocol types and framework-free frame code. The day someone re-exports a Solid
  // component, or anything reading `window` at module scope, this import throws here rather than in a
  // stranger's bundler.
  expect(typeof sdk.connect).toBe('function')
  expect(typeof sdk.mountFrame).toBe('function')
  expect(typeof sdk.openLinkOnClick).toBe('function')
  expect(typeof sdk.AcornBridgeError).toBe('function')
})

it('rejects a frame with no window to receive the bridge on', async () => {
  // The one runtime behaviour worth pinning from outside client-core's own suite: a frame with no
  // message target fails loudly instead of hanging on a promise that can never settle.
  const target = globalThis as { addEventListener?: unknown }
  const saved = target.addEventListener
  delete target.addEventListener
  try {
    await expect(sdk.connect()).rejects.toThrow(/no window/)
  } finally {
    target.addEventListener = saved
  }
})
