// A layout model for the diff in jsdom, which has none (docs/testing/desktop.md § The large-surface fixture).
//
// - The scroller is 800 by 600 over a canvas as tall as the layout sets it, and its `scrollTop` clamps
//   to what that canvas can reach, the way a browser's does. jsdom's does not clamp, and a test that
//   let it could assert a position no browser would accept.
// - A dynamic block, which the layout marks with `data-block`, is as tall as `heights` says: its fixed
//   part (the code line above a note, none for a thread) plus its dynamic part. Unset, a thread is 120
//   and a line's note is 20.
// - `ResizeObserver` is modelled: an element reports its size once when first observed, on a timer,
//   and again whenever the test calls `resize()`, synchronously, as the browser does after a layout
//   change and before paint.
// - `scrollTo` moves the scroller and says so with a scroll event.
//
// Enough to drive the layout's geometry, measurement and corrections; rects of anything else, momentum,
// and real paint are the real window's to check.

const VIEW_WIDTH = 800
const VIEW_HEIGHT = 600

type Observer = { callback: ResizeObserverCallback; elements: Set<Element>; instance: ResizeObserver }

export type DiffLayoutModel = (() => void) & {
  /** Dynamic heights by block id, excluding the block's fixed part. */
  heights: Map<string, number>
  /** Report every observed element (or those `filter` keeps) as resized. */
  resize: (filter?: (element: Element) => boolean) => void
  /** Observers constructed and not yet disconnected. */
  observers: () => number
}

const baseOf = (id: string) => (id.startsWith('t:') ? 0 : 20)
const dynamicOf = (heights: Map<string, number>, id: string) => heights.get(id) ?? (id.startsWith('t:') ? 120 : 20)

export function installDiffLayout(): DiffLayoutModel {
  const heights = new Map<string, number>()
  const observers = new Set<Observer>()
  const tops = new WeakMap<Element, number>()
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
  const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
  const rect = Element.prototype.getBoundingClientRect
  const scrollTo = Element.prototype.scrollTo
  const hadObserver = 'ResizeObserver' in globalThis
  const previousObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver

  const isScroller = (element: Element) => element.classList.contains('diff')
  const canvasHeight = (element: Element) => {
    const canvas = element.firstElementChild
    return canvas instanceof HTMLElement ? parseFloat(canvas.style.height) || 0 : 0
  }

  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) { return isScroller(this) ? VIEW_HEIGHT : 0 },
  })
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get(this: Element) { return isScroller(this) ? VIEW_WIDTH : 0 },
  })
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) { return isScroller(this) ? canvasHeight(this) : 0 },
  })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) { return isScroller(this) ? tops.get(this) ?? 0 : scrollTop.get!.call(this) },
    set(this: Element, value: number) {
      if (!isScroller(this)) return scrollTop.set!.call(this, value)
      tops.set(this, Math.max(0, Math.min(value, canvasHeight(this) - VIEW_HEIGHT)))
    },
  })
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const id = this instanceof HTMLElement ? this.dataset.block : undefined
    if (!id) return rect.call(this)
    const height = baseOf(id) + dynamicOf(heights, id)
    return { x: 0, y: 0, top: 0, left: 0, right: VIEW_WIDTH, bottom: height, width: VIEW_WIDTH, height, toJSON: () => ({}) } as DOMRect
  }
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top != null) this.scrollTop = options.top
    this.dispatchEvent(new Event('scroll'))
  } as typeof Element.prototype.scrollTo

  const entry = (element: Element): ResizeObserverEntry => {
    const box = isScroller(element) ? { width: VIEW_WIDTH, height: VIEW_HEIGHT } : { width: VIEW_WIDTH, height: element.getBoundingClientRect().height }
    return { target: element, contentRect: { ...box, x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height } } as unknown as ResizeObserverEntry
  }

  class ModelResizeObserver {
    private readonly observer: Observer
    private waiting = new Set<Element>()
    private timer: ReturnType<typeof setTimeout> | 0 = 0
    constructor(callback: ResizeObserverCallback) {
      this.observer = { callback, elements: new Set(), instance: this as unknown as ResizeObserver }
      observers.add(this.observer)
    }
    observe(element: Element) {
      this.observer.elements.add(element)
      this.waiting.add(element)
      if (this.timer) return
      this.timer = setTimeout(() => {
        this.timer = 0
        const due = [...this.waiting].filter((candidate) => this.observer.elements.has(candidate))
        this.waiting.clear()
        if (due.length && observers.has(this.observer)) this.observer.callback(due.map(entry), this.observer.instance)
      }, 0)
    }
    unobserve(element: Element) {
      this.observer.elements.delete(element)
      this.waiting.delete(element)
    }
    disconnect() {
      observers.delete(this.observer)
      this.observer.elements.clear()
      this.waiting.clear()
      if (this.timer) clearTimeout(this.timer)
      this.timer = 0
    }
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ModelResizeObserver

  const dispose = () => {
    if (clientHeight) Object.defineProperty(Element.prototype, 'clientHeight', clientHeight)
    if (clientWidth) Object.defineProperty(Element.prototype, 'clientWidth', clientWidth)
    if (scrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight)
    Object.defineProperty(Element.prototype, 'scrollTop', scrollTop)
    Element.prototype.getBoundingClientRect = rect
    Element.prototype.scrollTo = scrollTo
    if (hadObserver) (globalThis as { ResizeObserver?: unknown }).ResizeObserver = previousObserver
    else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  }

  return Object.assign(dispose, {
    heights,
    resize: (filter?: (element: Element) => boolean) => {
      for (const observer of observers) {
        const due = [...observer.elements].filter((element) => element.isConnected && (!filter || filter(element)))
        if (due.length) observer.callback(due.map(entry), observer.instance)
      }
    },
    observers: () => observers.size,
  })
}
