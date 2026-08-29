import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { paneRegistry, type PaneLayoutContribution } from './panes'
import type { Task } from '../queries'
import { _resetLayoutState } from '../layouts/state'

// The one thing the pane registry does beyond holding entries: it turns a declared layout into the
// component every consumer already expects (docs/panes.md § Contributions).

const task = { id: 't1', projectId: 'p1' } as unknown as Task

const pane = (over: Partial<PaneLayoutContribution> = {}): PaneLayoutContribution => ({
  id: 'notes', label: 'Notes', glyph: 'notepad-text', order: 30,
  layout: 'list-detail',
  regions: { list: () => <span data-region="list" />, detail: () => <span data-region="detail" /> },
  ...over,
})

let host: HTMLElement
let dispose: (() => void) | undefined
let registered: { dispose: () => void }[] = []
const register = (entry: PaneLayoutContribution) => {
  const held = paneRegistry.register(entry)
  registered.push(held)
  return held
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  _resetLayoutState()
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  for (const entry of registered) entry.dispose()
  registered = []
})

describe('a pane that declares a layout', () => {
  it('draws the layout and fills its regions', async () => {
    register(pane())
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)
    // `lazy` on the layout module, so the first paint is empty and the regions arrive once the
    // dynamic import settles. The budget is two seconds rather than a quarter of one: this used to
    // fail intermittently in a full `pnpm test`, where a cold dynamic import competes with every other
    // project's workers, and never on its own. A generous ceiling on a condition poll costs nothing
    // when it is met on the first try.
    for (let tries = 0; tries < 400 && !host.querySelector('[data-region]'); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect([...host.querySelectorAll('[data-region]')].map((node) => node.getAttribute('data-region')))
      .toEqual(['list', 'detail'])
  })

  // At registration rather than at render: finding it when someone opens the pane means finding it in
  // front of a user.
  it('throws at registration for a missing required region', () => {
    expect(() => register(pane({ regions: { list: () => <span /> } })))
      .toThrow(/needs a detail region/)
    expect(paneRegistry.get('notes')).toBeUndefined()
  })

  it('throws at registration for a region the layout does not have', () => {
    expect(() => register(pane({ layout: 'single', regions: { body: () => <span />, sidebar: () => <span /> } })))
      .toThrow(/has no sidebar region/)
  })

  it('throws at registration for a layout this build does not draw', () => {
    expect(() => register(pane({ layout: 'carousel' as PaneLayoutContribution['layout'] })))
      .toThrow(/unknown layout/)
  })
})
