import { describe, expect, it } from 'vitest'
import { Renderable } from '@opentui/core'
import { installRenderGuard } from './renderGuard'

// The one thing worth pinning: yoga's answer for a node it has never measured, and what the guard
// turns it into. Both halves are the real `updateFromLayout` — the fake is a node, not a stand-in for
// the method — so this fails the day OpenTUI clamps its own and the guard can go.
const unmeasured = () => ({
  _ctx: { frameId: 1 },
  _lastLayoutFrame: 0,
  _x: 0,
  _y: 0,
  _screenX: 0,
  _screenY: 0,
  _translateX: 0,
  _translateY: 0,
  _widthValue: 0,
  _heightValue: 0,
  parent: null,
  yogaNode: { getComputedLayout: () => ({ left: 0, top: 0, width: undefined, height: undefined }) },
  onLayoutResize: () => {},
})

describe('the render guard', () => {
  it('clamps the size of a node that joined the tree after the layout pass', () => {
    const proto = Renderable.prototype as unknown as { updateFromLayout: () => void }

    const before = unmeasured()
    proto.updateFromLayout.call(before)
    // Unguarded, this is what reaches the Zig side, which takes a `u32` and throws.
    expect(before._widthValue).toBeNaN()

    installRenderGuard()
    const after = unmeasured()
    proto.updateFromLayout.call(after)
    expect(after._widthValue).toBe(1)
    expect(after._heightValue).toBe(1)
  })
})
