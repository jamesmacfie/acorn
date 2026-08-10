import { describe, expect, it } from 'vitest'
import { sanitizeRailItem, scopedSourceItemsPath } from './data'

describe('descriptor source scope', () => {
  it('adds an encoded active project while preserving plugin query parameters', () => {
    expect(scopedSourceItemsPath('/v2/p/board/items', 'project/one'))
      .toBe('/v2/p/board/items?project=project%2Fone')
    expect(scopedSourceItemsPath('/v2/p/board/items?status=open', 'project-1'))
      .toBe('/v2/p/board/items?status=open&project=project-1')
    expect(scopedSourceItemsPath('/v2/p/board/items', undefined))
      .toBe('/v2/p/board/items')
  })
})

describe('descriptor source row parsing', () => {
  it('strips another plugin\'s task origin without dropping the row', () => {
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', task: { origin: 'linear', title: 'Fix checkout' },
    })).toEqual({
      id: '142', title: 'Checkout failed', task: { title: 'Fix checkout' },
    })
  })

  it('keeps exact and namespaced origins owned by the plugin', () => {
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', task: { origin: 'rollbar:error' },
    })?.task?.origin).toBe('rollbar:error')
  })

  it('strips a malformed task link while retaining valid task fields', () => {
    expect(sanitizeRailItem('rollbar', {
      id: '142', title: 'Checkout failed', task: { origin: 'rollbar', link: { connectionId: 7 } },
    })).toEqual({
      id: '142', title: 'Checkout failed', task: { origin: 'rollbar' },
    })
  })
})
