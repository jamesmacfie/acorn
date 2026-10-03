import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Row } from '../primitives'
import { Rows } from './Rows'
import { revealCollectionItem } from '../../keys/collection'
import { _resetCollectionState } from '../../keys/collectionState'

// A list rebuilt from a live store hands out fresh item objects on every frame. The rows must not go
// with them: the DOM inside a row holds a text selection, an open menu, and whatever the caller drew.

let dispose: (() => void) | undefined
let host: HTMLElement

const mount = (ui: () => unknown) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(ui as never, host)
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  _resetCollectionState()
})

const rows = () => [...host.querySelectorAll<HTMLElement>('.ui-row')]

// The virtual path publishes its scroll element in a frame, so a virtual list is only drawn after one.
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

describe('Rows reconciles by key', () => {
  it('keeps a row when the list is rebuilt with the same keys', () => {
    const [tick, setTick] = createSignal(0)
    mount(() => (
      <Rows
        id="rows-test-rebuild"
        items={['a', 'b'].map((key) => ({ key, label: key }))}
        // Read so the memo re-runs and rebuilds the item objects.
        ariaLabel={`build ${tick()}`}
      >
        {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
      </Rows>
    ))
    const before = rows()
    expect(before).toHaveLength(2)
    setTick(1)
    const after = rows()
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
  })

  it('redraws a row whose own fields changed', () => {
    const [label, setLabel] = createSignal('first')
    mount(() => (
      <Rows id="rows-test-relabel" items={[{ key: 'a', label: label() }]}>
        {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
      </Rows>
    ))
    const before = rows()[0]
    setLabel('second')
    const after = rows()[0]
    expect(after).not.toBe(before)
    expect(after?.textContent).toContain('second')
  })

  it('drops a row that left the list', () => {
    const [keys, setKeys] = createSignal(['a', 'b'])
    mount(() => (
      <Rows id="rows-test-remove" items={keys().map((key) => ({ key, label: key }))}>
        {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
      </Rows>
    ))
    const first = rows()[0]
    setKeys(['a'])
    expect(rows()).toHaveLength(1)
    // The survivor is the same element, so removing a sibling costs nothing.
    expect(rows()[0]).toBe(first)
  })
})

it('uses Enter for a standalone row press and the menu keys for its actions', () => {
  const press = vi.fn()
  const menu = vi.fn()
  mount(() => <Row onPress={press} onMenu={menu}>Record</Row>)
  const row = rows()[0]!
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }))
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
  expect(press).toHaveBeenCalledTimes(1)
  expect(menu).toHaveBeenCalledTimes(2)
})

describe('Rows redraws a virtual row whose item changed', () => {
  it('follows a filter that put a different item at the same index', async () => {
    // jsdom reports every box as zero and the virtualizer draws nothing without a height, so the
    // scroller is given one. `offsetHeight` is what it measures, not the bounding rect.
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    onTestFinished(() => { if (own) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', own) })
    const all = ['alpha', 'beta', 'gamma']
    const [filter, setFilter] = createSignal('')
    const items = () => all.filter((key) => key.includes(filter())).map((key) => ({ key, label: key }))
    mount(() => (
      <Rows virtual id="rows-test-virtual-filter" items={items()}>
        {(item, itemProps, _selected, place) => (
          <Row item={itemProps} offset={place.offset} height={place.height}>{item.label}</Row>
        )}
      </Rows>
    ))
    await frame()
    expect(rows()[0]?.textContent).toContain('alpha')
    setFilter('gam')
    await frame()
    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.textContent).toContain('gamma')
  })

  it('remeasures square rail rows when a sidebar collapses', async () => {
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    onTestFinished(() => { if (own) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', own) })
    const root = document.documentElement
    root.style.setProperty('--row-h-virt', '36px')
    root.style.setProperty('--tabrail-w', '48px')
    onTestFinished(() => {
      root.style.removeProperty('--row-h-virt')
      root.style.removeProperty('--tabrail-w')
    })
    const [collapsed, setCollapsed] = createSignal(false)
    mount(() => (
      <Rows virtual rowHeight={collapsed() ? 'rail' : 'default'} id="rows-test-rail-height" items={[{ key: 'a', label: 'alpha' }]}>
        {(item, itemProps, _selected, place) => (
          <Row item={itemProps} offset={place.offset} height={place.height}>{item.label}</Row>
        )}
      </Rows>
    ))
    await frame()
    expect(rows()[0]?.style.height).toBe('36px')
    setCollapsed(true)
    await frame()
    expect(rows()[0]?.style.height).toBe('48px')
  })
})

it('keeps a virtual row owner and updates its placement after an insertion', async () => {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
  onTestFinished(() => { if (own) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', own) })
  const [keys, setKeys] = createSignal(Array.from({ length: 100 }, (_, index) => String(index)))
  mount(() => <Rows virtual id="rows-insertion" items={keys().map((key) => ({ key, label: key }))}>
    {(item, props, _selected, place) => <Row item={props} offset={place.offset} height={place.height}>{item.label}</Row>}
  </Rows>)
  await frame()
  const survivor = rows().find((row) => row.textContent === '1')!
  const before = survivor.style.transform
  setKeys(['added', ...keys()])
  await frame()
  expect(rows().find((row) => row.textContent === '1')).toBe(survivor)
  expect(survivor.style.transform).not.toBe(before)
  expect(rows().length).toBeLessThan(40)
})

it('admits a bounded first frame and replays an early reveal when geometry arrives', async () => {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  let height = 0
  const resized: (() => void)[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized.push(() => callback([], this as unknown as ResizeObserver)) }
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  onTestFinished(() => { vi.unstubAllGlobals() })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height })
  onTestFinished(() => { if (own) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', own) })
  for (const [property, value] of [['scrollHeight', 80000], ['clientHeight', 300]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)
    Object.defineProperty(HTMLElement.prototype, property, { configurable: true, get: () => value })
    onTestFinished(() => { if (descriptor) Object.defineProperty(HTMLElement.prototype, property, descriptor); else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property] })
  }
  HTMLElement.prototype.scrollTo ??= () => {}
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (this: HTMLElement, options: ScrollToOptions | number) {
    this.scrollTop = typeof options === 'object' ? options.top ?? 0 : 0
    this.dispatchEvent(new Event('scroll'))
  })
  onTestFinished(() => scroll.mockRestore())
  const [listing, setListing] = createSignal<{ key: string; label: string }[]>([])
  mount(() => <Rows virtual id="rows-early-reveal" items={listing()}>
    {(item, props, _selected, place) => <Row item={props} offset={place.offset} height={place.height}>{item.label}</Row>}
  </Rows>)
  setListing(Array.from({ length: 2001 }, (_, index) => ({ key: String(index), label: String(index) })))
  expect(rows().length).toBeLessThanOrEqual(12)
  revealCollectionItem('rows-early-reveal', '1999')
  await frame()
  expect(rows().length).toBeLessThanOrEqual(12)
  height = 300
  for (const resize of resized) resize()
  await frame()
  await vi.waitFor(() => expect(rows().some((row) => row.textContent === '1999')).toBe(true))
  expect(rows().length).toBeLessThan(40)
  expect(host.querySelector('[role="listbox"]')?.getAttribute('aria-activedescendant')).toBe('rows-early-reveal-item-1999')
})
