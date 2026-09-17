import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
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
