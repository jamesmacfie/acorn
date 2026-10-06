import { describe, expect, it } from 'vitest'
import type { PluginRailItem } from '@acorn/protocol/api.ts'
import { filterSourceItems } from './sourceFilter'

const items: PluginRailItem[] = [
  {
    id: 'linear-connection:ENG-42', title: 'Fix login', short: 'ENG-42', fields: ['ENG-42'],
    task: { title: 'Fix login', link: { connectionId: 'linear-connection', identifier: 'ENG-42' } },
  },
  {
    id: 'rollbar-connection:142', title: 'TypeError: cannot read length', short: '#142', fields: ['9,000'],
    task: { title: 'TypeError: cannot read length', link: { connectionId: 'rollbar-connection', identifier: '142' } },
  },
  {
    id: 'opaque-row-999', title: 'Refresh timeout',
    task: { title: 'Refresh timeout', link: { connectionId: 'connection', identifier: 'OPS-7' } },
  },
]

describe('source list filtering', () => {
  it.each([
    [' eng-42 ', ['linear-connection:ENG-42']],
    ['42', ['linear-connection:ENG-42', 'rollbar-connection:142']],
    ['#42', ['linear-connection:ENG-42', 'rollbar-connection:142']],
    ['142', ['rollbar-connection:142']],
    ['#142', ['rollbar-connection:142']],
    ['ops-7', ['opaque-row-999']],
    ['LOGIN', ['linear-connection:ENG-42']],
    ['9,000', []],
    ['999', []],
    ['#', ['rollbar-connection:142']],
  ])('finds %s by title or item identifier', (query, expected) => {
    expect(filterSourceItems(items, query).map((item) => item.id)).toEqual(expected)
  })

  it('keeps the loaded list and its order when the filter is empty', () => {
    expect(filterSourceItems(items, '   ')).toBe(items)
  })
})
