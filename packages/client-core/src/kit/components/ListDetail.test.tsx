import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ListDetail } from './primitives'

// The list arrives in a prop, and a prop is a getter: every read re-runs the JSX the caller wrote
// there. ListDetail read it three times, so the column was built three times over and the copies
// fought over the same nodes. Docker's rail source drew an empty column
// (docs/ui-design.md § Two-column panes).

let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => host.remove())

describe('ListDetail', () => {
  it('builds the list column once', () => {
    let built = 0
    const List = () => {
      built += 1
      return <span>the list</span>
    }
    render(() => <ListDetail list={<List />}>the detail</ListDetail>, host)

    expect(built).toBe(1)
    expect(host.querySelectorAll('.ui-listdetail-list').length).toBe(1)
    expect(host.querySelector('.ui-listdetail-list')?.textContent).toBe('the list')
  })

  it('puts the shared resize handle between prop-form columns', () => {
    render(() => <ListDetail list={<span>the list</span>}>the detail</ListDetail>, host)

    const root = host.querySelector<HTMLElement>('.ui-listdetail')!
    expect([...root.children].map((node) => node.className)).toEqual([
      'ui-listdetail-list',
      'ui-split-handle',
      'ui-listdetail-detail',
    ])
    expect(root.querySelector('[role="separator"]')?.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('puts the shared resize handle between remote-tree column children', () => {
    render(() => (
      <ListDetail split>
        <div class="ui-listdetail-list">the list</div>
        <div class="ui-listdetail-detail">the detail</div>
      </ListDetail>
    ), host)

    const root = host.querySelector<HTMLElement>('.ui-listdetail')!
    expect([...root.children].map((node) => node.className)).toEqual([
      'ui-listdetail-list',
      'ui-split-handle',
      'ui-listdetail-detail',
    ])
  })

  it('resizes from the rendered list width and clamps to the component', () => {
    render(() => <ListDetail list={<span>the list</span>}>the detail</ListDetail>, host)
    const root = host.querySelector<HTMLElement>('.ui-listdetail')!
    const list = host.querySelector<HTMLElement>('.ui-listdetail-list')!
    const handle = host.querySelector<HTMLElement>('[role="separator"]')!
    Object.defineProperty(root, 'offsetWidth', { configurable: true, value: 800 })
    Object.defineProperty(list, 'offsetWidth', { configurable: true, value: 200 })

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(root.style.gridTemplateColumns).toBe('216px 1px minmax(0, 1fr)')

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(root.style.gridTemplateColumns).toBe('480px 1px minmax(0, 1fr)')

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(root.style.gridTemplateColumns).toBe('120px 1px minmax(0, 1fr)')
  })
})
