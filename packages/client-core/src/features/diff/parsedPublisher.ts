import type { ParsedFile } from '../../kit/diff/diffModel'

const SCROLL_END_DELAY_MS = 150
const FALLBACK_IDLE_DELAY_MS = 16

type IdleWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

/**
 * Keeps progressive parsing off the active scroll path. Visible files publish immediately; the
 * rest collect until the browser is idle or scrolling has stopped.
 */
export function createParsedFilePublisher(options: {
  publish: (files: ParsedFile[]) => void
  isPriority: (path: string) => boolean
}) {
  const pending = new Map<string, ParsedFile>()
  let scrolling = false
  let idleHandle: number | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  let scrollEndTimer: ReturnType<typeof setTimeout> | null = null

  const cancelIdle = () => {
    if (idleHandle != null && typeof window !== 'undefined') {
      const idleWindow = window as IdleWindow
      idleWindow.cancelIdleCallback?.(idleHandle)
    }
    if (fallbackTimer != null) clearTimeout(fallbackTimer)
    idleHandle = null
    fallbackTimer = null
  }

  const take = (paths?: ReadonlySet<string>) => {
    const ready: ParsedFile[] = []
    for (const [path, file] of pending) {
      if (paths && !paths.has(path)) continue
      pending.delete(path)
      ready.push(file)
    }
    return ready
  }

  const flush = (paths?: Iterable<string>) => {
    const selected = paths ? new Set(paths) : undefined
    const ready = take(selected)
    if (!pending.size) cancelIdle()
    if (ready.length) options.publish(ready)
  }

  const schedule = () => {
    if (scrolling || !pending.size || idleHandle != null || fallbackTimer != null) return
    if (typeof window !== 'undefined' && (window as IdleWindow).requestIdleCallback) {
      idleHandle = (window as IdleWindow).requestIdleCallback!(() => {
        idleHandle = null
        if (!scrolling) flush()
      }, { timeout: 100 })
      return
    }
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null
      if (!scrolling) flush()
    }, FALLBACK_IDLE_DELAY_MS)
  }

  const enqueue = (files: ParsedFile[]) => {
    const priority: ParsedFile[] = []
    for (const file of files) {
      if (options.isPriority(file.file.path)) priority.push(file)
      else pending.set(file.file.path, file)
    }
    if (priority.length) options.publish(priority)
    schedule()
  }

  const markScrolling = () => {
    scrolling = true
    cancelIdle()
    if (scrollEndTimer != null) clearTimeout(scrollEndTimer)
    scrollEndTimer = setTimeout(() => {
      scrollEndTimer = null
      scrolling = false
      schedule()
    }, SCROLL_END_DELAY_MS)
  }

  const reset = () => {
    pending.clear()
    scrolling = false
    cancelIdle()
    if (scrollEndTimer != null) clearTimeout(scrollEndTimer)
    scrollEndTimer = null
  }

  const dispose = reset

  return { dispose, enqueue, flush, markScrolling, reset }
}
