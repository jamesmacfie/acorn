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
// A frame drawn one cell wide is a frame nobody notices; the next one has the real size. Installed
// beside the renderer rather than owned by any node, and to be removed when OpenTUI clamps its own
// (there is no release past 0.5.9 that does).
export function installRenderGuard(): void {
  const proto = Renderable.prototype as unknown as {
    updateFromLayout: () => void
    _widthValue: number
    _heightValue: number
  }
  const inherited = proto.updateFromLayout
  proto.updateFromLayout = function patched(this: typeof proto) {
    inherited.call(this)
    if (!Number.isFinite(this._widthValue)) this._widthValue = 1
    if (!Number.isFinite(this._heightValue)) this._heightValue = 1
  }
}
