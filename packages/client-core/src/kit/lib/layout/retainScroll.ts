import { createEffect, on, onCleanup, untrack } from 'solid-js'

// A scroller that comes back where the reader left it.
//
// Leaving a pane takes its DOM with it (the pane contract has no keep-alive, see
// host/registries/panes/panes.test.tsx), so without this every sidebar reopens at the top. The offset
// is kept by whoever already owns the list's other state, and this only moves it between that store
// and the element. Session-only, like those stores.
//
// One write is rarely enough on the way back, because the rows tend to arrive after the scroller does
// and the browser clamps the offset to whatever height is there. So the restore retries while the
// content changes, as `TabPanel` does (../../components/layout/Tabs.tsx), and gives up at the deadline
// or as soon as the reader scrolls for themselves.

const RESTORE_DEADLINE_MS = 5000
const READER_INPUT = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const

export type ScrollStore = {
  /** Which place the scroller is showing. A change restores the new one's offset, for a scroller that
   *  stays mounted while its subject changes, such as a pane switching task. */
  key: () => string
  read: (key: string) => number
  write: (key: string, offset: number) => void
}

/** Call from a component, with its scroller, for example from the scroller's `ref`. */
export function retainScroll(element: HTMLElement, store: ScrollStore): void {
  let current = untrack(store.key)
  let pending: ReturnType<typeof setTimeout> | undefined
  let observer: MutationObserver | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    clearTimeout(pending)
    pending = undefined
    observer?.disconnect()
    observer = undefined
    clearTimeout(deadline)
  }
  const restore = (desired: number) => {
    element.scrollTop = desired
    if (Math.abs(element.scrollTop - desired) < 1) { stop(); return }
    if (observer) return
    // `style` as well as children, because a virtual list grows by its canvas's inline height.
    observer = new MutationObserver(() => restore(desired))
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    deadline = setTimeout(stop, RESTORE_DEADLINE_MS)
  }

  // The first attempt waits a task, so the scroller is in the document. A timer rather than an
  // animation frame, because a hidden window runs no frames at all and the restore would never start.
  createEffect(on(store.key, (key) => {
    stop()
    current = key
    pending = setTimeout(() => {
      pending = undefined
      restore(untrack(() => store.read(key)))
    }, 0)
  }))

  const onScroll = () => {
    // A restore in flight is the host scrolling, and its clamped steps are not a place to keep.
    if (!observer && !pending) store.write(current, element.scrollTop)
  }
  element.addEventListener('scroll', onScroll, { passive: true })
  for (const type of READER_INPUT) element.addEventListener(type, stop, { passive: true })
  onCleanup(() => {
    stop()
    element.removeEventListener('scroll', onScroll)
    for (const type of READER_INPUT) element.removeEventListener(type, stop)
  })
}
