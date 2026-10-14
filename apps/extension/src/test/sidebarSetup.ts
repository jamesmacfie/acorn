// jsdom lays nothing out, so it has no ResizeObserver. This one keeps each observer, so a test can
// report a resize the way the browser would.
type Observer = { callback: ResizeObserverCallback; elements: Set<Element> }
const resizeObservers = new Set<Observer>()

globalThis.ResizeObserver = class implements ResizeObserver {
  private readonly entry: Observer
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, elements: new Set() }
    resizeObservers.add(this.entry)
  }
  observe(element: Element) {
    this.entry.elements.add(element)
  }
  unobserve(element: Element) {
    this.entry.elements.delete(element)
  }
  disconnect() {
    resizeObservers.delete(this.entry)
  }
}

// Every observer watching an element is told its size changed.
export function reportResize() {
  for (const observer of resizeObservers)
    if (observer.elements.size) observer.callback([], undefined as unknown as ResizeObserver)
}
