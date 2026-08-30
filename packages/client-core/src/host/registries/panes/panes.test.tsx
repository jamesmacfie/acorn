import { onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { paneAvailable, paneRegistry, type PaneLayoutContribution } from './panes'
import type { Task } from '../../../infra/queries'
import { _resetPaneModels } from './paneModels'
import { evictScope } from '../shell/scopeEviction'
import { _resetLayoutState } from '../../layouts/state'

// The one thing the pane registry does beyond holding entries: it turns a declared layout into the
// component every consumer already expects (docs/panes.md § Contributions).

const task = { id: 't1', projectId: 'p1' } as unknown as Task

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry is heterogeneous by construction
const pane = (over: Partial<PaneLayoutContribution<any>> = {}): PaneLayoutContribution<any> => ({
  id: 'notes', label: 'Notes', glyph: 'notepad-text', order: 30,
  layout: 'list-detail',
  regions: { list: () => <span data-region="list" />, detail: () => <span data-region="detail" /> },
  ...over,
})

let host: HTMLElement
let dispose: (() => void) | undefined
let registered: { dispose: () => void }[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
const register = (entry: PaneLayoutContribution<any>) => {
  const held = paneRegistry.register(entry)
  registered.push(held)
  return held
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  _resetLayoutState()
  _resetPaneModels()
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

// Two regions are two components the host mounts side by side, so whatever they share has to outlive
// both of them (./paneModels.ts, docs/panes.md § Layout model). Four compiled panes each kept their
// own root map before this seam existed.
describe('the model a pane’s regions share', () => {
  it('builds once per task and hands the same object to every region', async () => {
    let built = 0
    const seen: { id: number }[] = []
    const Region = (props: { model: { id: number } }) => {
      seen.push(props.model)
      return <span data-region="r" />
    }
    register(pane({
      model: () => ({ id: ++built }),
      regions: { list: Region, detail: Region },
    }))
    const Pane = paneRegistry.get('notes')!.component
    dispose = render(() => <Pane task={task} />, host)
    // The layout module is behind `lazy`, so the regions arrive once the dynamic import settles. Same
    // generous poll as the test above, for the same reason.
    for (let tries = 0; tries < 400 && seen.length < 2; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(seen).toHaveLength(2)
    expect(built).toBe(1)
    expect(seen[1]).toBe(seen[0])
  })

  it('disposes the previous task’s model when another task asks, and on eviction', async () => {
    const { paneModel } = await import('./paneModels')
    const disposed: string[] = []
    const build = (id: string) => () => {
      onCleanup(() => disposed.push(id))
      return { id }
    }
    expect(paneModel('notes', 't1', build('t1'))).toBe(paneModel('notes', 't1', build('t1-again')))
    paneModel('notes', 't2', build('t2'))
    // One task is on screen at a time, so the one before it is a task somebody navigated away from,
    // and disposing eagerly is what flushes its pending save.
    expect(disposed).toEqual(['t1'])
    evictScope({ scope: 'task', taskId: 't2' })
    expect(disposed).toEqual(['t1', 't2'])
  })
})

describe('paneAvailable', () => {
  // The gate the rail and the pane switcher both read (../../../features/tasks/TaskPaneHost.tsx).
  // The seam arm is what keeps the browser preview off a shell that ships without preview views:
  // `'desktop'` said yes to that shell, and the pane then rendered a dead end.
  afterEach(() => { delete (window as unknown as { acorn?: unknown }).acorn })

  it('a seam gate follows the host, not the shell', () => {
    const gated = pane({ id: 'preview', requires: { seam: 'preview' } })
    register(gated)
    const entry = paneRegistry.get('preview')!
    ;(window as unknown as { acorn?: unknown }).acorn = { desktop: true, platform: 'darwin' }
    expect(paneAvailable(entry)).toBe(false)
    ;(window as unknown as { acorn?: unknown }).acorn = {
      desktop: true,
      platform: 'darwin',
      preview: { ensure() {}, setBounds() {}, show() {}, hide() {}, load() {}, command() {}, evict() {}, onEvent: () => () => {} },
    }
    expect(paneAvailable(entry)).toBe(true)
  })
})
