import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it, vi } from 'vitest'
import { Tabs } from './Tabs'

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
