// The exact local reader for rendered-surface health (docs/telemetry.md § Rendered-surface health).
//
// Telemetry gets a handful of samples at each checkpoint (emitter.ts installs that handler). A
// developer or a WebDriver flow wants the whole snapshot at the moment it asks, so this answers a
// request on the page's own event target by writing one `performance.mark` whose `detail` is the
// snapshot. The previous mark is cleared first, so a flow that asks ten thousand times leaves one
// entry on the timeline rather than ten thousand. The same `acorn:` performance-timeline path the
// renderer spans use (emitter.ts § setSpansOnTimeline), and nothing on `window`.
//
// A request is a plain event rather than a function a script can call, because the page exposes no
// module to a script. The snapshot holds numbers only (kit/lib/telemetry/surfaceHealth.ts § sanitize), which is
// why answering it needs no switch: anything that can dispatch the event can already read the DOM.
import { surfaceHealthSnapshot } from '../../kit/lib/telemetry/surfaceHealth'

/** The event a reader dispatches on the page's event target to ask for a fresh snapshot. */
export const SURFACE_HEALTH_REQUEST = 'acorn:surface-health'
/** The performance mark the answer is written to, read with `performance.getEntriesByName`. */
export const SURFACE_HEALTH_MARK = 'acorn:surface.health'

/** Replace the one health mark on the performance timeline with the current snapshot. */
export function markSurfaceHealth(): void {
  performance.clearMarks(SURFACE_HEALTH_MARK)
  performance.mark(SURFACE_HEALTH_MARK, { detail: surfaceHealthSnapshot() })
}

/** Answer health requests dispatched on `target` until the returned function is called. The
 *  listener runs synchronously inside `dispatchEvent`, so the mark exists when that call returns. */
export function answerSurfaceHealthRequests(target: EventTarget): () => void {
  const listener = () => {
    try {
      markSurfaceHealth()
    } catch {
      // A diagnostic that failed must not surface as an error in the page it describes.
    }
  }
  target.addEventListener(SURFACE_HEALTH_REQUEST, listener)
  return () => target.removeEventListener(SURFACE_HEALTH_REQUEST, listener)
}
