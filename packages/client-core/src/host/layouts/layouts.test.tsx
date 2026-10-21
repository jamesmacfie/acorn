import { createSignal, mergeProps } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUTS } from '.'
import { _resetLayoutState } from './state'
import { _resetSidebarCollapse } from '../../kit/lib/layout/collapseState'
import type { LayoutProps, Region } from './regions'

// The seven layouts, rendered with placeholder regions (docs/panes/layout.md § Layout model).
//
// What a render adds over the region table in @acorn/protocol/paneLayouts.ts is the part the table
// cannot see: that each region ends up in the document, in the order the layout promises, and that a
// layout drawing one region at a time never calls the thunks for the rest.

let host: HTMLElement
let dispose: (() => void) | undefined

const text =
  (name: string): Region =>
  () => <span data-region={name}>{name}</span>

const mount = (layout: keyof typeof LAYOUTS, props: Partial<LayoutProps> = {}) => {
  dispose = render(() => LAYOUTS[layout](mergeProps({ stateKey: 'pane', label: 'Pane', regions: {} }, props)), host)
}

// The body, because a drawer is a portal.
const regionOrder = () =>
  [...document.body.querySelectorAll('[data-region]')].map((node) => node.getAttribute('data-region'))

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  _resetLayoutState()
  localStorage.clear()
  _resetSidebarCollapse()
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  localStorage.clear()
  _resetSidebarCollapse()
})

describe('every layout draws the regions it is given, in order', () => {
  it('single', () => {
    mount('single', { regions: { body: text('body') } })
    expect(regionOrder()).toEqual(['body'])
  })

  it('list-detail, with the optional regions inside the list column', () => {
    mount('list-detail', {
      regions: {
        list: text('list'),
        detail: text('detail'),
        'list-header': text('list-header'),
        'list-footer': text('list-footer'),
      },
    })
    expect(regionOrder()).toEqual(['list-header', 'list', 'list-footer', 'detail'])
    // The host draws the divider, so the list column carries a handle a keyboard can reach.
    expect(host.querySelector('[role="separator"]')?.getAttribute('aria-orientation')).toBe('vertical')
    expect(host.querySelector('aside')?.getAttribute('aria-label')).toBe('Pane list')
  })

  it('list-detail drops the whole column when the list is hidden', () => {
    mount('list-detail', {
      regions: { list: text('list'), detail: text('detail'), 'list-header': text('list-header') },
      hidden: ['list'],
    })
    expect(regionOrder()).toEqual(['detail'])
    expect(host.querySelector('[role="separator"]')).toBe(null)
  })

  it('list-detail can collapse to an empty rail while keeping its header and expand control', () => {
    mount('list-detail', {
      regions: {
        list: text('list'),
        detail: text('detail'),
        'list-header': text('list-header'),
        'list-footer': text('list-footer'),
      },
      collapsible: true,
      collapseContent: 'empty',
    })
    host.querySelector<HTMLButtonElement>('.ui-listdetail-edge .ui-btn')!.click()
    expect(regionOrder()).toEqual(['detail'])
    expect(host.querySelector('.layout-collapsed-header')).not.toBe(null)
    expect(host.querySelector<HTMLButtonElement>('.ui-listdetail-edge .ui-btn')?.getAttribute('aria-label')).toBe(
      'Expand Pane list',
    )
  })

  it('header-body-footer, with all three optional', () => {
    mount('header-body-footer', { regions: { header: text('header'), body: text('body'), footer: text('footer') } })
    expect(regionOrder()).toEqual(['header', 'body', 'footer'])
    dispose?.()
    mount('header-body-footer', { regions: { header: text('header'), body: text('body') } })
    expect(regionOrder()).toEqual(['header', 'body'])
  })

  it('tabs draws the bar and only the selected panel', () => {
    mount('tabs', {
      tabs: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
      regions: { 'panel:one': text('panel:one'), 'panel:two': text('panel:two') },
    })
    expect([...host.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual(['One', 'Two'])
    // No selection stored yet, so the first tab is the one on screen, and the other panel's thunk was
    // never called.
    expect(regionOrder()).toEqual(['panel:one'])
    expect(host.querySelector('[role="tabpanel"]')?.id).toBe('pane-panel-one')
  })

  it('document-over-frame and frame-beside-document are the same regions on two axes', () => {
    for (const [layout, axis] of [
      ['document-over-frame', 'y'],
      ['frame-beside-document', 'x'],
    ] as const) {
      mount(layout, { regions: { document: text('document'), frame: text('frame') } })
      expect(regionOrder()).toEqual(['document', 'frame'])
      expect(host.querySelector('.layout-document-split')?.getAttribute('data-axis')).toBe(axis)
      dispose?.()
      host.replaceChildren()
    }
  })

  it('stack-split', () => {
    mount('stack-split', { regions: { top: text('top'), bottom: text('bottom') } })
    expect(regionOrder()).toEqual(['top', 'bottom'])
    expect(host.querySelector('[role="separator"]')?.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('wizard draws the indicator and the controls around the step', () => {
    mount('wizard', {
      regions: { step: text('step') },
      steps: [
        { id: 'a', label: 'Add' },
        { id: 'b', label: 'Organize' },
        { id: 'c', label: 'Done' },
      ],
      current: 'b',
    })
    expect(regionOrder()).toEqual(['step'])
    expect([...host.querySelectorAll('.layout-wizard-step')].map((node) => node.getAttribute('data-state'))).toEqual([
      'done',
      'current',
      'todo',
    ])
    // Back and next, because the middle step has somewhere to go in both directions.
    expect([...host.querySelectorAll('.layout-wizard-actions button')].map((node) => node.textContent)).toEqual([
      'Back',
      'Next',
    ])
  })
})

describe('per-pane layout state', () => {
  it('keeps a tab selection under the pane id across an unmount', () => {
    mount('tabs', {
      tabs: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
      regions: { 'panel:one': text('panel:one'), 'panel:two': text('panel:two') },
    })
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click()
    expect(regionOrder()).toEqual(['panel:two'])

    dispose?.()
    host.replaceChildren()
    mount('tabs', {
      tabs: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
      regions: { 'panel:one': text('panel:one'), 'panel:two': text('panel:two') },
    })
    expect(regionOrder()).toEqual(['panel:two'])
  })

  it('falls back to the first tab when the stored one is gone', () => {
    mount('tabs', {
      tabs: [
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two' },
      ],
      regions: { 'panel:one': text('panel:one'), 'panel:two': text('panel:two') },
    })
    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click()
    dispose?.()
    host.replaceChildren()
    mount('tabs', { tabs: [{ id: 'one', label: 'One' }], regions: { 'panel:one': text('panel:one') } })
    expect(regionOrder()).toEqual(['panel:one'])
  })
})

// The phone's projections (docs/panes/layout.md § Named layouts). The shell sets the form factor on the
// root element before anything draws, so the tests do too.
describe('narrow', () => {
  const press = (name: string) =>
    [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === name)!
      .click()
  const buttons = () => [...document.body.querySelectorAll('button')].map((button) => button.textContent)
  const listDetail = (props: Partial<LayoutProps> = {}) =>
    mount('list-detail', mergeProps({ regions: { list: text('list'), detail: text('detail') } }, props))

  beforeEach(() => {
    document.documentElement.dataset.formFactor = 'narrow'
  })
  afterEach(() => {
    delete document.documentElement.dataset.formFactor
  })

  it('list-detail draws the list alone, with no divider, and offers Show detail', () => {
    listDetail()
    expect(regionOrder()).toEqual(['list'])
    expect(host.querySelector('[role="separator"]')).toBe(null)
    expect(buttons()).toEqual(['Show detail'])
    press('Show detail')
    expect(regionOrder()).toEqual(['detail'])
    expect(buttons()).toEqual(['Back'])
  })

  it('list-detail opens on the detail when something is already selected, and Back returns to the list', () => {
    listDetail({ selection: 'one' })
    expect(regionOrder()).toEqual(['detail'])
    press('Back')
    expect(regionOrder()).toEqual(['list'])
    // The selection is untouched, so forward lands on the same item.
    press('Show detail')
    expect(regionOrder()).toEqual(['detail'])
  })

  it('list-detail pushes the detail when the selection changes to a key, and not when it clears', () => {
    const [selection, setSelection] = createSignal<string | null>(null)
    listDetail({
      get selection() {
        return selection()
      },
    })
    // Nothing to show yet, so there is nothing to go forward to.
    expect(buttons()).toEqual([])
    setSelection('one')
    expect(regionOrder()).toEqual(['detail'])
    press('Back')
    setSelection('two')
    expect(regionOrder()).toEqual(['detail'])
    press('Back')
    setSelection(null)
    expect(regionOrder()).toEqual(['list'])
  })

  it('list-detail keeps the list header and footer in the list, and the detail alone when the list is hidden', () => {
    listDetail({
      regions: {
        list: text('list'),
        detail: text('detail'),
        'list-header': text('list-header'),
        'list-footer': text('list-footer'),
      },
    })
    expect(regionOrder()).toEqual(['list-header', 'list', 'list-footer'])
    dispose?.()
    host.replaceChildren()
    listDetail({ hidden: ['list'] })
    expect(regionOrder()).toEqual(['detail'])
    expect(buttons()).toEqual([])
  })

  it.each([
    ['document-over-frame', 'document', 'frame'],
    ['frame-beside-document', 'document', 'frame'],
    ['stack-split', 'top', 'bottom'],
  ] as const)('%s fills the pane with its first region and opens the second in a drawer', (layout, first, second) => {
    mount(layout, { regions: { [first]: text(first), [second]: text(second) } })
    expect(regionOrder()).toEqual([first])
    expect(host.querySelector('[role="separator"]')).toBe(null)
    press('Show panel')
    expect(regionOrder()).toEqual([first, second])
    expect(document.body.querySelector('.ui-drawer')?.getAttribute('aria-label')).toBe('Pane panel')
    expect(document.body.querySelector('.ui-drawer [data-region]')?.getAttribute('data-region')).toBe(second)
    press('Close')
    expect(regionOrder()).toEqual([first])
    expect(document.body.querySelector('.ui-drawer')).toBe(null)
  })
})
