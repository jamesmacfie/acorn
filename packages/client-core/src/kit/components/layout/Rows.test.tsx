import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { Row } from '../primitives'
import { Rows } from './Rows'
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

const rows = () => [...host.querySelectorAll('.ui-row')]

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
})
