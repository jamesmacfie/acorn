import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ListDetail } from './primitives'
import { claimNarrowBack, narrowBack } from '../lib/layout/narrowView'

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

// A phone shows one column at a time (docs/ui-design/two-column-panes.md § Narrow). The columns stay
// mounted and `data-view` says which one the sheet shows.
describe('ListDetail on a phone', () => {
  const view = () => host.querySelector<HTMLElement>('.ui-listdetail')?.dataset.view
  const press = (name: string) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === name)!.click()

  beforeEach(() => {
    document.documentElement.dataset.formFactor = 'narrow'
  })
  afterEach(() => {
    delete document.documentElement.dataset.formFactor
  })

  it('shows the list, drops the divider, and goes forward and back on request', () => {
    render(() => <ListDetail list={<span>the list</span>}>the detail</ListDetail>, host)

    expect(view()).toBe('list')
    expect(host.querySelector('.ui-split-handle')).toBe(null)
    press('Show detail')
    expect(view()).toBe('detail')
    press('Back')
    expect(view()).toBe('list')
  })

  it('shows the detail when the selection changes to a key', () => {
    const [selection, setSelection] = createSignal<string | null>(null)
    render(
      () => (
        <ListDetail selection={selection()} list={<span>the list</span>}>
          the detail
        </ListDetail>
      ),
      host,
    )

    expect(host.querySelector('.ui-listdetail-switch')).toBe(null)
    setSelection('one')
    expect(view()).toBe('detail')
    press('Back')
    setSelection(null)
    expect(view()).toBe('list')
  })

  it('hands Back to a shell that claims it, and draws no Back row of its own', () => {
    const release = claimNarrowBack()
    try {
      render(() => <ListDetail list={<span>the list</span>}>the detail</ListDetail>, host)
      expect(narrowBack()).toBeUndefined()
      press('Show detail')
      expect(view()).toBe('detail')
      expect(host.querySelector('.ui-listdetail-switch[data-to="list"]')).toBe(null)
      narrowBack()!()
      expect(view()).toBe('list')
      expect(narrowBack()).toBeUndefined()
    } finally {
      release()
    }
  })

  it('leaves a split of one column alone', () => {
    render(() => <ListDetail>the detail</ListDetail>, host)

    expect(view()).toBeUndefined()
  })
})
