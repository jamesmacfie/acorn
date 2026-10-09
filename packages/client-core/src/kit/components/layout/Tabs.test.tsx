import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import { TabPanel, Tabs } from './Tabs'

it('records scrolling when remote props are replaced without changing the retained offset', async () => {
  const host = document.createElement('div')
  const [row, setRow] = createSignal({ active: 'search', offset: 0, revision: 1 })
  const changed = vi.fn()
  const dispose = render(() => <TabPanel idPrefix="stable" id="search" active={row().active}
    scrollOffset={row().offset} onChange={changed}><div>{row().revision}</div></TabPanel>, host)
  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    setRow({ active: 'search', offset: 0, revision: 2 })
    const panel = host.querySelector<HTMLElement>('.ui-tab-panel')!
    panel.scrollTop = 321
    panel.dispatchEvent(new Event('scroll'))
    expect(changed).toHaveBeenCalledWith(321)
  } finally { dispose() }
})

it('restores a retained panel offset when remote props and content arrive after mounting', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const [ready, setReady] = createSignal(false)
  const [offset, setOffset] = createSignal<number>()
  const dispose = render(() => <TabPanel idPrefix="delayed" id="search" active="search" scrollOffset={offset()}>
    <Show when={ready()}><div>Late results</div></Show>
  </TabPanel>, host)
  try {
    const panel = host.querySelector<HTMLElement>('.ui-tab-panel')!
    let position = 0
    Object.defineProperty(panel, 'scrollTop', {
      configurable: true,
      get: () => position,
      set: (offset: number) => { position = ready() ? offset : 0 },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(position).toBe(0)
    setOffset(321)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(position).toBe(0)
    setReady(true)
    await vi.waitFor(() => expect(position).toBe(321))
  } finally {
    dispose()
    host.remove()
  }
})

// A remote tree's props are validated one at a time and a bad one is dropped, so a node can be asked
// to draw without a prop its type says is required. Throwing here unmounts the region the tree is in,
// which is how one plugin's malformed `tabs` list took out both halves of the API panel.
it('draws an empty strip when the tabs list never arrived', () => {
  const host = document.createElement('div')
  const dispose = render(() => (
    <Tabs
      tabs={undefined as unknown as never}
      active="body"
      onChange={() => {}}
      idPrefix="request"
      ariaLabel="Request"
    />
  ), host)
  try {
    expect(host.querySelector('.ui-tabs')).not.toBeNull()
    expect(host.querySelectorAll('.ui-tab')).toHaveLength(0)
  } finally {
    dispose()
  }
})

it('scrolls the active tab within one row while keeping trailing actions visible', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const scroll = vi.fn()
  const previous = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = scroll
  let select!: (id: string) => void
  const dispose = render(() => {
    const [active, setActive] = createSignal('one')
    select = setActive
    return (
      <Tabs
        tabs={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three' }]}
        active={active()}
        onChange={setActive}
        idPrefix="scrolling"
        ariaLabel="Sections"
        actions={<button type="button">Action</button>}
      />
    )
  }, host)
  try {
    const strip = host.querySelector<HTMLElement>('.ui-tab-scroll')!
    expect(strip.getAttribute('role')).toBe('tablist')
    expect(strip.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(host.querySelector('.ui-tabs-actions button')?.textContent).toBe('Action')
    expect(strip.contains(host.querySelector('.ui-tabs-actions'))).toBe(false)
    await Promise.resolve()
    scroll.mockClear()
    select('three')
    await Promise.resolve()
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(scroll.mock.instances.at(-1)).toBe(host.querySelector('#scrolling-tab-three'))
  } finally {
    dispose()
    host.remove()
    Element.prototype.scrollIntoView = previous
  }
})

// jsdom lays nothing out, so the strip's widths are stubbed. The attribute is what tabs.css fades on.
it('marks the edge of the strip that hides tabs', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => (
    <Tabs
      tabs={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]}
      active="one"
      onChange={() => {}}
      idPrefix="overflow"
      ariaLabel="Sections"
    />
  ), host)
  try {
    const strip = host.querySelector<HTMLElement>('.ui-tab-scroll')!
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 300 })
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 100 })
    const scrollTo = (left: number) => {
      strip.scrollLeft = left
      strip.dispatchEvent(new Event('scroll'))
    }
    scrollTo(0)
    expect(strip.dataset.overflow).toBe('end')
    scrollTo(100)
    expect(strip.dataset.overflow).toBe('both')
    scrollTo(200)
    expect(strip.dataset.overflow).toBe('start')
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 100 })
    scrollTo(0)
    expect(strip.dataset.overflow).toBeUndefined()
  } finally {
    dispose()
    host.remove()
  }
})

it('draws tree children as trailing actions, and no actions box when there are none', () => {
  const host = document.createElement('div')
  const tabs = [{ id: 'one', label: 'One' }]
  const [items, setItems] = createSignal<string[]>([])
  const dispose = render(() => (
    <Tabs tabs={tabs} active="one" onChange={() => {}} idPrefix="kids" ariaLabel="Kids">
      {/* The shape a tree host hands over: a list that may be empty. */}
      {items().map((item) => <b>{item}</b>)}
    </Tabs>
  ), host)
  try {
    expect(host.querySelector('.ui-tabs-actions')).toBeNull()
    setItems(['Error'])
    expect(host.querySelector('.ui-tabs-actions')?.textContent).toBe('Error')
  } finally { dispose() }
})
