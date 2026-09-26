// A layout model for the diff in jsdom, which has none: the scroller is 600px over a canvas as tall as
// its style says, an item is 20px a row or a pending segment's reserved height, and `scrollTo` moves
// the scroller and says so the way a browser would. Enough for the virtualizer to mount a window and follow a jump; coverage by rect and
// real scroll behaviour are the real window's to check (docs/testing.md § Large-surface fixture).
export function installDiffLayout(): () => void {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
  const scrollTo = Element.prototype.scrollTo
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains('diff')) return 600
      if (this.classList.contains('diff-item')) {
        const pending = this.querySelector<HTMLElement>('.diff-segment-pending')
        if (pending) return parseFloat(pending.style.height) || 20
        return Math.max(1, this.querySelectorAll('.diff-row, .diff-split-band').length) * 20
      }
      return 20
    },
  })
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) { return this.classList.contains('diff') ? 600 : 0 },
  })
  // The canvas's height, which is what bounds how far the virtualizer may scroll.
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      const canvas = this.classList.contains('diff') ? this.firstElementChild : null
      return canvas instanceof HTMLElement ? parseFloat(canvas.style.height) || 0 : 0
    },
  })
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top != null) this.scrollTop = options.top
    this.dispatchEvent(new Event('scroll'))
  } as typeof Element.prototype.scrollTo
  return () => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    if (clientHeight) Object.defineProperty(Element.prototype, 'clientHeight', clientHeight)
    if (scrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight)
    Element.prototype.scrollTo = scrollTo
  }
}
