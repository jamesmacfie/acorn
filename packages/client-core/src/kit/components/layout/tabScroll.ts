import { onCleanup } from 'solid-js'

/** Keep the selected tab visible when a narrow strip overflows or selection changes off-screen. */
export function revealActiveTab(strip: HTMLElement | undefined, id: string): void {
  if (!strip || !id) return
  queueMicrotask(() => {
    const tab = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')].find((item) => item.id === id)
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  })
}

/** Mark the edge of a strip that hides tabs, as `data-overflow="start|end|both"`, so tabs.css can fade
 *  it. macOS hides the scrollbar, and without a cue nobody finds the tab past the edge. Call it from the
 *  strip's `ref`, so the listeners go when the strip does. */
export function trackTabOverflow(strip: HTMLElement): void {
  const update = () => {
    const hidden = strip.scrollWidth - strip.clientWidth
    const start = strip.scrollLeft > 1
    const end = strip.scrollLeft < hidden - 1
    const edge = start && end ? 'both' : start ? 'start' : end ? 'end' : undefined
    if (edge) strip.dataset.overflow = edge
    else delete strip.dataset.overflow
  }
  strip.addEventListener('scroll', update, { passive: true })
  // The strip resizes with its pane. A tab added, removed, or relabelled changes the width inside it
  // without resizing the strip, so that needs its own observer.
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
  resize?.observe(strip)
  const content = new MutationObserver(update)
  content.observe(strip, { childList: true, subtree: true, characterData: true })
  queueMicrotask(update)
  onCleanup(() => {
    strip.removeEventListener('scroll', update)
    resize?.disconnect()
    content.disconnect()
  })
}
