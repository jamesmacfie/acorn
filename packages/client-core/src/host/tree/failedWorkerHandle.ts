import type { TreeWorkerHandle } from './workerHost'

/** A failed startup has no worker, authority or admission left. Keep its surface addressable so the
 * enclosing TreeHost can draw the ordinary failure state rather than unwinding the application. */
export function failedWorkerHandle(reason: string, onRefused: (reason: string) => void): TreeWorkerHandle {
  let active = true
  let refuse: ((reason: string) => void) | null = onRefused
  const listeners = new Set<(reason: string) => void>()
  queueMicrotask(() => { if (active) refuse?.(reason) })
  return {
    mount() {}, unmount() {}, select() {}, surfaceAction() {}, appearance() {},
    bridgePort: () => null,
    onHostRequest: () => () => {},
    transport: () => ({
      onBatch: () => () => {},
      onFailed(listener) {
        if (!active) return () => {}
        listeners.add(listener)
        queueMicrotask(() => { if (active && listeners.has(listener)) listener(reason) })
        return () => { listeners.delete(listener) }
      },
      send() {},
    }),
    release() { active = false; refuse = null; listeners.clear() },
  }
}
