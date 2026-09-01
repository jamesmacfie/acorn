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
//   stored geometry  what the next draw reads, and what a resize handler reads about the node it is
//                    resizing. `bufferDrawBox` takes unsigned sizes and `addToHitGrid` takes signed
//                    positions; both reject the `NaN` an unmeasured yoga node otherwise supplies.
//
// `onLayoutResize` has exactly one definition in 0.5.9 and no subclass overrides it, so the
// prototype is the whole of it.
//
// A frame drawn one cell wide is a frame nobody notices; the next one has the real size. Installed
// beside the renderer rather than owned by any node, and to be removed when OpenTUI clamps its own
// (there is no release past 0.5.9 that does).
/** How many listeners one renderer may carry before Node calls it a leak.
 *
 *  Every live `scrollbox` subscribes to the renderer's `selection` event, and a pull request draws
 *  well past Node's default ten (./kit/scrolling.tsx). That warning goes to stderr rather than
 *  through OpenTUI's console, so it paints straight over the frame. `ScrollBox.destroySelf`
 *  unsubscribes, so this is a count and not a leak: the cap is raised rather than removed, and a
 *  real runaway still trips it.
 *
 *  Lives here rather than beside the viewport because `main.tsx` may not import the kit before the
 *  platform seam exists, and this module is already the one it takes from OpenTUI at the top. */
export const RENDERER_LISTENER_CAP = 200

const cells = (value: number): number => (Number.isFinite(value) ? value : 1)
const position = (value: number): number => (Number.isFinite(value) ? value : 0)
let installed = false

export function installRenderGuard(): void {
  if (installed) return
  installed = true
  const proto = Renderable.prototype as unknown as {
    updateFromLayout: () => void
    onLayoutResize: (width: number, height: number) => void
    _widthValue: number
    _heightValue: number
    _x: number
    _y: number
    _screenX: number
    _screenY: number
  }
  const resize = proto.onLayoutResize
  proto.onLayoutResize = function patchedResize(this: typeof proto, width: number, height: number) {
    // Clamp the stored size before delegating, not only the arguments. `updateFromLayout` writes the
    // raw yoga numbers and calls this from inside that write, so a resize handler reads the node's
    // own `width`/`height` while they are still `NaN`. ScrollBox's does exactly that, and one `NaN`
    // there is permanent: its scroll position feeds itself back through `Math.max(0, value)`, which
    // keeps returning `NaN`, so the content node's translate never recovers and its whole subtree
    // draws at the wrong screen position for the life of the box.
    this._widthValue = cells(this._widthValue)
    this._heightValue = cells(this._heightValue)
    resize.call(this, cells(width), cells(height))
  }
  const inherited = proto.updateFromLayout
  proto.updateFromLayout = function patched(this: typeof proto) {
    inherited.call(this)
    this._widthValue = cells(this._widthValue)
    this._heightValue = cells(this._heightValue)
    this._x = position(this._x)
    this._y = position(this._y)
    this._screenX = position(this._screenX)
    this._screenY = position(this._screenY)
  }
}
