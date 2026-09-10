import type { TelemetryAttrs } from '@acorn/protocol/telemetry.ts'
import { startInteraction, telemetryEnabled, type SpanHandle } from '../../infra/telemetry/emitter'

// The `nav.change` span: how long it takes between asking for a different page and seeing one
// (docs/frontend.md § Telemetry).
//
// A page change here is a signal write, not a navigation. Routes mount a no-op component and
// `App.tsx` draws from `selectedSource()` and `activeTaskId()`, so there is no router event to hang
// this on and no `onLoad` to end it. It starts where the signal is written and ends on the second
// `requestAnimationFrame`, which is the same pattern the boot marks use: the first frame is the one
// the browser was already going to paint, and the second is the first one with the new content in
// it.
//
// Regions that suspend are not covered by this. A pane that is still fetching draws nothing at that
// second frame, and `pane.region` is what measures it to content.

/** The change in flight, or null between them. */
let open: { span: SpanHandle; attrs: TelemetryAttrs } | null = null

const nextFrame = (run: () => void): void => {
  // A bare-Node suite has no frames. Nothing reaches here with telemetry off, and the fallback is
  // what keeps a test that turns it on from hanging on a callback that never fires.
  if (typeof requestAnimationFrame !== 'function') return void setTimeout(run, 0)
  requestAnimationFrame(run)
}

/**
 * Say that the page is changing, and to what.
 *
 * Two calls inside one change collapse into one span, with the later attributes winning. That is
 * not a nicety: opening a task writes both signals, clearing the selected source and then setting
 * the task, and two spans for one click would report the click as a navigation to nothing followed
 * by a navigation to the task.
 */
export function markPageChange(owner: string, attrs: TelemetryAttrs): void {
  if (!telemetryEnabled()) return
  if (open) {
    open.attrs = { ...open.attrs, ...attrs }
    return
  }
  const span = startInteraction(owner, { name: 'nav.change', attrs: { seam: 'nav.change' } })
  const change = { span, attrs: { seam: 'nav.change', ...attrs } }
  open = change
  nextFrame(() => nextFrame(() => {
    open = null
    change.span.end('ok', change.attrs)
  }))
}

/** Test seam: forget a change that is still waiting for its second frame. */
export const _resetPageChange = (): void => {
  open = null
}
