/** Keep the selected tab visible when a narrow strip overflows or selection changes off-screen. */
export function revealActiveTab(strip: HTMLElement | undefined, id: string): void {
  if (!strip || !id) return
  queueMicrotask(() => {
    const tab = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')].find((item) => item.id === id)
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  })
}
