import { Renderable } from '@opentui/core'

// One clamp over OpenTUI's layout read, because a node that joins the tree after a frame's layout
// pass has no computed size and the renderer draws it anyway.
//
// `Renderable.updateFromLayout` takes the width and height straight from yoga: for a node yoga has
// never measured they come back undefined, `Math.max(undefined, 1)` is `NaN`, and the frame then
// hands that `NaN` to the Zig side, which is strict — `bufferDrawBox` and `addToHitGrid` both take a
// `u32` and both throw "Argument 3 must be a uint32", from inside the render loop, which takes the
// whole app with it.
//
// It happens for one frame and to any node with a border or a hit box, so it cannot be fixed in the
// node that hits it: `list-detail` mounts its divider when the list region arrives, and a `Card` in
// the agents transcript mounts on every turn. Switching to a workspace whose task opens the agents
// pane crashed `acorn` outright.
//
// Two clamps, because the size escapes by two doors and closing one is what this file used to do.
//
//   onLayoutResize   `updateFromLayout` hands the fresh size to this before it stores it, and the
//                    resize runs the whole way down: a `TextRenderable` passes it to its buffer's
//                    `setViewport`, which is a `u32` on the Zig side and throws the same way a draw
//                    does. Clamping only afterwards left this door open, and the agents pane found
//                    it — the frames the shell's panels added are enough new bordered nodes to make
//                    a one-frame gap in yoga's measurements routine rather than rare.
//   the stored size  what the next draw reads. `bufferDrawBox` and `addToHitGrid` both take a `u32`.
//
// `onLayoutResize` has exactly one definition in 0.5.9 and no subclass overrides it, so the
// prototype is the whole of it.
//
// A frame drawn one cell wide is a frame nobody notices; the next one has the real size. Installed
// beside the renderer rather than owned by any node, and to be removed when OpenTUI clamps its own
// (there is no release past 0.5.9 that does).
const cells = (value: number): number => (Number.isFinite(value) ? value : 1)

export function installRenderGuard(): void {
  const proto = Renderable.prototype as unknown as {
    updateFromLayout: () => void
    onLayoutResize: (width: number, height: number) => void
    _widthValue: number
    _heightValue: number
  }
  const resize = proto.onLayoutResize
  proto.onLayoutResize = function patchedResize(this: typeof proto, width: number, height: number) {
    resize.call(this, cells(width), cells(height))
  }
  const inherited = proto.updateFromLayout
  proto.updateFromLayout = function patched(this: typeof proto) {
    inherited.call(this)
    this._widthValue = cells(this._widthValue)
    this._heightValue = cells(this._heightValue)
  }
}
