// Split mode gives each column its own horizontal scroll, so the pair always fits the pane (see
// docs/diff-rendering.md § Row geometry for why). The scroller is each row's own `.diff-code` box:
// `.diff-split-cell` wraps so an open composer can drop below the code, and a flex line breaks on
// an item's hypothetical size, so the code span cannot be sized to its content without landing on
// line two. Scrolling inside it works, and it puts the gutters outside the scroller.
//
// One scroller per row means they have to be kept in step, or "scroll the left column" would mean
// scrolling each of its lines by hand. This is one capture-phase listener on the container (scroll
// events do not bubble) that mirrors an offset across the rest of its side.
//
// Writing scrollLeft on the siblings makes each of them fire a scroll event a frame later.
// Comparing against the stored offset stops that echo from looping; a re-entrancy flag cannot,
// because the write has already returned by the time the echo arrives.
export function createSplitScrollSync() {
  const offsets = [0, 0]
  let container: HTMLElement | null = null

  const sideOf = (code: HTMLElement) => (code.parentElement?.previousElementSibling ? 1 : 0)

  const codeCells = (side: number) =>
    container?.querySelectorAll<HTMLElement>(
      `.diff-split-pair > .diff-split-cell:nth-child(${side + 1}) > .diff-code`,
    ) ?? []

  const onScroll = (event: Event) => {
    const code = event.target
    if (!(code instanceof HTMLElement) || !code.classList.contains('diff-code')) return
    const side = sideOf(code)
    if (offsets[side] === code.scrollLeft) return
    offsets[side] = code.scrollLeft
    for (const other of codeCells(side)) if (other !== code) other.scrollLeft = offsets[side]
  }

  const detach = () => container?.removeEventListener('scroll', onScroll, true)

  return {
    attach: (el: HTMLElement) => {
      detach()
      container = el
      el.addEventListener('scroll', onScroll, true)
    },
    /** A band mounts at scrollLeft 0, so a column scrolled right would show new rows out of step. */
    adopt: (band: HTMLElement) => {
      for (const code of band.querySelectorAll<HTMLElement>('.diff-split-cell > .diff-code')) {
        const offset = offsets[sideOf(code)]
        if (offset) code.scrollLeft = offset
      }
    },
    dispose: detach,
  }
}
