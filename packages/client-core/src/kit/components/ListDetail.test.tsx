import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ListDetail } from './primitives'

// The list arrives in a prop, and a prop is a getter: every read re-runs the JSX the caller wrote
// there. Reading it more than once builds the column several times over, the copies fight over the
// same nodes, and the column draws empty (docs/ui-design/two-column-panes.md § Two-column panes).

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
    render(
      () => (
        <ListDetail split>
          <div class="ui-listdetail-list">the list</div>
          <div class="ui-listdetail-detail">the detail</div>
        </ListDetail>
      ),
      host,
    )

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

  it('restores a resized sidebar after remount and scopes widths to the supplied identity', () => {
    const [key, setKey] = createSignal('retained-git-project')
    const draw = () =>
      render(
        () => (
          <ListDetail widthKey={key()} list={<span>list</span>}>
            detail
          </ListDetail>
        ),
        host,
      )
    let dispose = draw()
    const root = () => host.querySelector<HTMLElement>('.ui-listdetail')!
    Object.defineProperty(root(), 'offsetWidth', { configurable: true, value: 800 })
    Object.defineProperty(host.querySelector('.ui-listdetail-list')!, 'offsetWidth', { configurable: true, value: 200 })
    host
      .querySelector('[role="separator"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    dispose()
    dispose = draw()
    expect(root().style.gridTemplateColumns).toBe('216px 1px minmax(0, 1fr)')
    setKey('other-git-project')
    expect(root().style.gridTemplateColumns).toBe('')
    setKey('retained-git-project')
    expect(root().style.gridTemplateColumns).toBe('216px 1px minmax(0, 1fr)')
    dispose()
  })
})
