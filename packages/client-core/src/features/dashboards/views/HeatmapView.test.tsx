import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import type { DashboardDisplayField } from '@acorn/dashboards-core/render'
import HeatmapView from './HeatmapView'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

const fields: DashboardDisplayField[] = [
  { id: 'day', name: 'Weekday', type: 'enum', values: ['Monday', 'Tuesday'].map((label) => ({ id: label, label })) },
  {
    id: 'hour',
    name: 'Hour',
    type: 'enum',
    values: ['13:00', '14:00', '15:00'].map((label) => ({ id: label, label })),
  },
]
const rows = [{ id: 'one', pluginId: 'agents', sourceId: 'turns', values: { day: 'Tuesday', hour: '14:00' } }]

it('is one tab stop, and the arrow, Home, and End keys reach every cell', () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <HeatmapView view={{ kind: 'heatmap', x: 'hour', y: 'day' }} schema={{ fields }} fields={fields} rows={rows} />
    ),
    host,
  )
  const stops = () => [...host.querySelectorAll('[tabindex="0"]')].map((cell) => cell.getAttribute('aria-label'))
  expect(host.querySelectorAll('[role="gridcell"]')).toHaveLength(6)
  expect(stops()).toEqual(['Monday, 13:00: 0'])
  const press = (key: string) =>
    (document.activeElement ?? host).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  host.querySelector<HTMLElement>('[tabindex="0"]')!.focus()
  press('ArrowDown')
  press('End')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Tuesday, 15:00: 0')
  press('ArrowLeft')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Tuesday, 14:00: 1')
  expect(document.activeElement?.getAttribute('data-step')).toBe('5')
  press('Home')
  press('ArrowUp')
  expect(stops()).toEqual(['Monday, 13:00: 0'])
  expect(host.textContent).toContain('Rows')
})
