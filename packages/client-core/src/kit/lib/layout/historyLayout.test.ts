import { expect, it } from 'vitest'
import { historyLayout } from './historyLayout'

it('joins merge lanes through divergence, convergence, and the root', () => {
  const rows = [
    { id: 'merge', parents: ['main', 'side'] },
    { id: 'main', parents: ['root'] },
    { id: 'side', parents: ['root'] },
    { id: 'root', parents: [] },
  ]
  const slots = historyLayout(rows, true, false)
  expect(slots[0]?.edges).toEqual([
    { from: 0, to: 0, start: 'center', end: 'bottom', continuation: false },
    { from: 0, to: 1, start: 'center', end: 'bottom', continuation: false },
  ])
  expect(slots[1]?.edges).toContainEqual({ from: 1, to: 1, start: 'top', end: 'bottom', continuation: false })
  expect(slots[2]?.edges).toContainEqual({ from: 1, to: 0, start: 'center', end: 'bottom', continuation: false })
  expect(slots[3]?.edges).toEqual([{ from: 0, to: 0, start: 'top', end: 'center', continuation: false }])
})

it('keeps boundary continuations and never draws inferred filtered edges', () => {
  const rows = [{ id: 'tip', parents: ['next'] }, { id: 'next', parents: ['outside'] }]
  const page = historyLayout(rows, true, true)
  expect(page[1]?.edges).toContainEqual({ from: 0, to: 0, start: 'center', end: 'bottom', continuation: true })
  const extended = historyLayout([...rows, { id: 'outside', parents: [] }], true, false)
  expect(extended.slice(0, 2).map((row) => row.lane)).toEqual(page.map((row) => row.lane))
  const filtered = historyLayout(rows, false, false)
  expect(filtered.every((row) => row.edges.length === 0 && row.disconnected)).toBe(true)
  const window = historyLayout(rows, true, false, true)
  expect(window[0]?.edges).toContainEqual({ from: 0, to: 0, start: 'top', end: 'center', continuation: true })
})

it('counts lanes beyond the visible geometry without aliasing them', () => {
  const parents = Array.from({ length: 10 }, (_, index) => `parent-${index}`)
  const [merge] = historyLayout([{ id: 'merge', parents }, ...parents.map((id) => ({ id, parents: [] }))], true, false)
  expect(merge?.lanes).toBe(10)
  expect(new Set(merge?.edges.map((edge) => edge.to)).size).toBe(10)
})

it('moves a surviving lane into the vacated column when a root terminates', () => {
  const rows = [
    { id: 'merge', parents: ['main', 'short', 'long'] },
    { id: 'main', parents: ['root'] },
    { id: 'short', parents: [] },
    { id: 'long', parents: ['root'] },
    { id: 'root', parents: [] },
  ]
  const slots = historyLayout(rows, true, false)
  expect(slots[2]?.edges).toContainEqual({ from: 2, to: 1, start: 'top', end: 'bottom', continuation: false })
  expect(slots[2]?.edges.some((edge) => edge.from === 1 && edge.end === 'bottom')).toBe(false)
  expect(slots[3]?.lane).toBe(1)
})
