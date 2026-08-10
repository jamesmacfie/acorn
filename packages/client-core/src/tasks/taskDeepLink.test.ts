import { afterEach, describe, expect, it } from 'vitest'
import { paneRegistry } from '../registries/panes'
import { parseTaskDeepLink } from './taskDeepLink'

const pane = (id: string) => paneRegistry.register({
  id, label: id, glyph: 'x', order: 1, component: () => null,
})

let registered: { dispose(): void } | undefined
afterEach(() => {
  registered?.dispose()
  registered = undefined
})

describe('parseTaskDeepLink', () => {
  it('reads a pane and item pair', () => {
    registered = pane('test.notes')
    expect(parseTaskDeepLink({ pane: 'test.notes', item: 'ENG-404' })).toEqual({ pane: 'test.notes', item: 'ENG-404' })
  })

  it('rejects a pane no plugin contributed', () => {
    // Otherwise openPane would push an id nothing can render into the task's PERSISTED layout, where it
    // would survive restarts.
    expect(parseTaskDeepLink({ pane: 'test.absent', item: 'ENG-404' })).toBeNull()
  })

  it('needs both halves', () => {
    registered = pane('test.notes')
    expect(parseTaskDeepLink({ pane: 'test.notes' })).toBeNull()
    expect(parseTaskDeepLink({ item: 'ENG-404' })).toBeNull()
    expect(parseTaskDeepLink({})).toBeNull()
  })

  it('takes the first value when a param is repeated', () => {
    registered = pane('test.notes')
    expect(parseTaskDeepLink({ pane: ['test.notes', 'test.other'], item: ['a', 'b'] })).toEqual({ pane: 'test.notes', item: 'a' })
  })
})
