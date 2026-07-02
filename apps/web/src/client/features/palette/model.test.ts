import { describe, expect, it } from 'vitest'
import { composeItems, fuzzyFilter, fuzzyScore } from './model'

describe('composeItems', () => {
  it('orders errors → run targets → layouts → actions with stable ids', () => {
    const items = composeItems({
      targets: [
        { id: 'dev', command: 'pnpm dev', running: false },
        { id: 'stack', command: 'docker compose up', running: true },
      ],
      layouts: [{ id: 'review' }],
      errors: [{ source: 'repo', message: 'run.bad is missing command' }],
      actions: [{ id: 'action:terminal', label: 'New terminal' }],
    })
    expect(items.map((i) => i.kind)).toEqual(['error', 'run', 'run', 'layout', 'action'])
    expect(items[0].label).toContain('config error (repo)')
    expect(items[1].label).toBe('Run: dev')
    expect(items[2].label).toBe('Stop: stack')
    expect(items[3].id).toBe('layout:review')
  })
})

describe('fuzzy filter', () => {
  const items = composeItems({
    targets: [
      { id: 'dev', command: 'pnpm dev', running: false },
      { id: 'seed', command: 'pnpm db:seed', running: false },
    ],
    errors: [],
    actions: [
      { id: 'a1', label: 'New terminal' },
      { id: 'a2', label: 'Archive task' },
      { id: 'a3', label: 'Maximise pane' },
    ],
  })
  it('matches subsequences and ranks contiguous/word-start hits higher', () => {
    const out = fuzzyFilter(items, 'dev')
    expect(out[0].label).toBe('Run: dev')
    expect(fuzzyFilter(items, 'term')[0].label).toBe('New terminal')
    expect(fuzzyFilter(items, 'zzz')).toEqual([])
  })
  it('empty query returns everything unfiltered', () => {
    expect(fuzzyFilter(items, ' ')).toEqual(items)
  })
  it('fuzzyScore rejects non-subsequences', () => {
    expect(fuzzyScore('abc', 'a-b')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})
