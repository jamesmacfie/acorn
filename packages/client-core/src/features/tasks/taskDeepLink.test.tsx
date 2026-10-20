import { createRoot, createSignal } from 'solid-js'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { consumePaneIntent, evictPendingIntents } from '../../host/registries/commands/clientEvents'
import { paneRegistry } from '../../host/registries/panes/panes'
import { layoutForTask } from './tasks'
import { createTaskDeepLink } from './taskDeepLink'

const pane = paneRegistry.register({
  id: 'test.deep-link',
  label: 'Deep link',
  glyph: 'x',
  order: 1,
  component: () => null,
})
afterAll(() => pane.dispose())

const disposals: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

function mount(taskId: string, query: Record<string, string>) {
  const navigate = vi.fn()
  const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null)
  const dispose = createRoot((dispose) => {
    createTaskDeepLink({ taskId: activeTaskId, search: () => query, navigate })
    return dispose
  })
  disposals.push(dispose, () => evictPendingIntents(taskId))
  setActiveTaskId(taskId)
  return navigate
}

describe('createTaskDeepLink', () => {
  it('opens and focuses a pane without creating a selection intent', async () => {
    const navigate = mount('pane-only-task', { pane: 'test.deep-link' })
    await Promise.resolve()
    expect(layoutForTask('pane-only-task')?.panes).toContain('test.deep-link')
    expect(consumePaneIntent('pane-only-task', 'test.deep-link')).toBeUndefined()
    expect(navigate).toHaveBeenCalledWith('/t/pane-only-task', { replace: true })
  })

  it('keeps the selected item intent and strips both query parameters', async () => {
    const navigate = mount('item-task', { pane: 'test.deep-link', item: 'ENG-404' })
    await Promise.resolve()
    expect(layoutForTask('item-task')?.panes).toContain('test.deep-link')
    expect(consumePaneIntent('item-task', 'test.deep-link')).toEqual({ kind: 'plugin:select', item: 'ENG-404' })
    expect(navigate).toHaveBeenCalledWith('/t/item-task', { replace: true })
  })

  it('carries a place in the item on the intent', async () => {
    mount('at-task', { pane: 'test.deep-link', item: 'session-1', at: '42' })
    await Promise.resolve()
    expect(consumePaneIntent('at-task', 'test.deep-link')).toEqual({
      kind: 'plugin:select',
      item: 'session-1',
      at: '42',
    })
  })
})
