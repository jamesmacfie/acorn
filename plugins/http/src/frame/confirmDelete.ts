// Two-click delete, because a plugin frame has no `window.confirm`.
//
// The iframe is sandboxed `allow-scripts allow-same-origin` and deliberately NOT `allow-modals`
// (client-core/plugins/frames/PluginFrame.tsx), so Chromium suppresses `confirm()` and returns false. The
// compiled panel guarded both of its deletes with one, which in a frame is a delete button that silently
// does nothing — the kind of regression a tier move introduces without touching a line of the logic.
//
// So: the first click arms a row, the second commits it, and clicking anything else disarms. No modal, no
// dialog verb on the bridge, and nothing to keep in step with the host.
import { createSignal } from 'solid-js'

export type ArmedDelete = {
  /** The key currently awaiting its second click, if any — for the button's label. */
  armed: () => string | null
  /** True when the caller should go ahead and delete. */
  request: (key: string) => boolean
  disarm: () => void
}

export function createArmedDelete(): ArmedDelete {
  const [armed, setArmed] = createSignal<string | null>(null)
  return {
    armed,
    request: (key) => {
      if (armed() === key) {
        setArmed(null)
        return true
      }
      setArmed(key)
      return false
    },
    disarm: () => setArmed(null),
  }
}
