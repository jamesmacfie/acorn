import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { KeyValueEditor } from './KeyValueEditor'

// jsdom lays nothing out, so these read the attributes the grid template keys on. The template itself
// is checked in the real window: `repeat(0, …)` is invalid CSS, and writing it for a grid with no extra
// columns threw the whole template away and stacked every cell in one column.
const mount = (props: Partial<Parameters<typeof KeyValueEditor>[0]>) => {
  const host = document.createElement('div')
  const dispose = render(() => (
    <KeyValueEditor ariaLabel="Params" rows={[{ key: 'page', value: '2', enabled: true }]} onChange={() => {}} {...props} />
  ), host)
  return { grid: host.querySelector<HTMLElement>('.ui-kvgrid')!, dispose }
}

it('writes no extra-column track when the caller has no extra columns', () => {
  const { grid, dispose } = mount({})
  try {
    expect(grid.hasAttribute('data-extra-cols')).toBe(false)
    expect(grid.style.getPropertyValue('--kv-extra-cols')).toBe('')
    expect(grid.hasAttribute('data-no-enable')).toBe(false)
  } finally {
    dispose()
  }
})

it('counts the extra columns when there are some', () => {
  const { grid, dispose } = mount({ columns: [{ id: 'kind', header: 'Kind', render: () => <span>text</span> }] })
  try {
    expect(grid.hasAttribute('data-extra-cols')).toBe(true)
    expect(grid.style.getPropertyValue('--kv-extra-cols')).toBe('1')
  } finally {
    dispose()
  }
})

it('marks a grid without the enable column, so it drops that track', () => {
  const { grid, dispose } = mount({ enableColumn: false })
  try {
    expect(grid.hasAttribute('data-no-enable')).toBe(true)
    expect(grid.querySelector('input[type="checkbox"]')).toBeNull()
  } finally {
    dispose()
  }
})
