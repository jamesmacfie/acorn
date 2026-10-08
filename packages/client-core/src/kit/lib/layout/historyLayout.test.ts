import { expect, it } from 'vitest'
import { historyLayout } from './historyLayout'

it('keeps a parent lane across a page boundary and names filtered relationships without drawing edges', () => {
  const rows = [
    { id: 'merge', parents: ['main', 'side'] },
    { id: 'main', parents: ['root'] },
    { id: 'side', parents: ['root'] },
  ]
  const first = historyLayout(rows, true, true)
  expect(first[0]?.parentLanes).toHaveLength(2)
  expect(first[1]?.continuation).toBe(true)
  expect(first[2]?.continuation).toBe(true)
  const extended = historyLayout([...rows, { id: 'root', parents: [] }], true, false)
  expect(extended.slice(0, 3).map((row) => row.lane)).toEqual(first.map((row) => row.lane))
  expect(extended[3]?.lane).toBeGreaterThanOrEqual(0)
  const filtered = historyLayout([rows[0]!, rows[2]!], false, false)
  expect(filtered.every((row) => row.parentLanes.length === 0 && row.disconnected)).toBe(true)
})
