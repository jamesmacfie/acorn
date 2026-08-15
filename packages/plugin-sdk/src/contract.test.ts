import { expect, it } from 'vitest'
import * as sdk from './index.ts'
import type * as Published from './public.ts'
import type { AcornBridge, PluginFrameContext } from './index.ts'

// The drift lock for the hand-written published declaration.
//
// `public.ts` is copied verbatim to `dist/sdk.d.ts`, so it is what every out-of-tree plugin type-checks
// against. Nothing in the compiler connects it to the implementation — that is the price of not running
// a declaration rollup — so the connection is made here, and `tsc --noEmit` (this package's `lint`) is
// what enforces it. A shape that moves underneath a stable name fails at the assignment below, which is
// precisely the gap the surface snapshot cannot see: it pins NAMES, and names are not what breaks a
// stranger's build.
//
// Assignability is asserted in BOTH directions per type. One direction alone passes happily when the
// published type is a subset: drop a method from `ui` and the published bridge still accepts a real one.

/** Both directions ⇒ structurally identical. A type error here is the whole point of the file. */
type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]

// Deliberately not `import * as Published` compared wholesale: this package exports two webview payload
// types that the facade does not name, so namespace-level comparison would fail for a reason that is
// not drift. Per-type is also what names the offender when it does break.
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
  // component, or anything that reads `window` at module scope, this import throws here rather than in
  // a stranger's bundler.
  expect(typeof sdk.connect).toBe('function')
  expect(typeof sdk.mountFrame).toBe('function')
  expect(typeof sdk.openLinkOnClick).toBe('function')
  expect(typeof sdk.AcornBridgeError).toBe('function')
})

it('rejects a frame with no window to receive the bridge on', async () => {
  // The one runtime behaviour worth pinning from outside client-core's own suite: a frame that somehow
  // has no message target fails loudly instead of hanging on a promise that can never settle.
  const target = globalThis as { addEventListener?: unknown }
  const saved = target.addEventListener
  delete target.addEventListener
  try {
    await expect(sdk.connect()).rejects.toThrow(/no window/)
  } finally {
    target.addEventListener = saved
  }
})
