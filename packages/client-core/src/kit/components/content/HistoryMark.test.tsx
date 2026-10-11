import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { HistoryMark } from './HistoryMark'
import { historyLayout } from '../../lib/layout/historyLayout'

it('renders row edges and exposes hidden lanes without merging their coordinates', () => {
  const parents = Array.from({ length: 10 }, (_, index) => `parent-${index}`)
  const [slot] = historyLayout([{ id: 'merge', parents }, ...parents.map((id) => ({ id, parents: [] }))], true, false)
  const host = document.createElement('div')
  const dispose = render(() => <HistoryMark slot={slot!} />, host)
  expect(host.querySelectorAll('line')).toHaveLength(8)
  expect(host.querySelector('text')?.textContent).toBe('+2')
  expect([...host.querySelectorAll('line')].map((line) => line.getAttribute('x2'))).toEqual([
    '6',
    '18',
    '30',
    '42',
    '54',
    '66',
    '78',
    '90',
  ])
  dispose()

  const filtered = historyLayout([{ id: 'match', parents: ['unseen'] }], false, false)[0]!
  const end = render(() => <HistoryMark slot={filtered} />, host)
  expect(host.querySelectorAll('line')).toHaveLength(0)
  end()
})
