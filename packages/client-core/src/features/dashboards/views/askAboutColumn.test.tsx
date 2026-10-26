import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { DashboardDisplayField } from '@acorn/dashboards-core/render'

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
const { default: TableView } = await import('./TableView')

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

const fields: DashboardDisplayField[] = [
  { id: 'title', name: 'Title', type: 'text', role: 'title' },
  { id: 'total', name: 'Total', type: 'number' },
]
const rows = [{ id: 'one', pluginId: 'core', sourceId: 'tasks', values: { title: 'Ship it', total: 2 } }]
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

it("offers Ask AI from a plan column's header button, and none for a column a step made", async () => {
  const onAsk = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <TableView
        view={{ kind: 'table' }}
        schema={{ fields }}
        fields={fields}
        rows={rows}
        onSelectPart={() => {}}
        askAboutColumn={{ columns: ['title'], onAsk }}
      />
    ),
    host,
  )
  // `total` comes from a step, so it has no column part to ask about.
  expect(host.querySelector('[aria-label="Actions for Total"]')).toBeNull()
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Actions for Title"]')!
  // A real button in the header, so Tab reaches it and Enter opens it.
  trigger.focus()
  trigger.click()
  await settle()
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entry) => entry.textContent === 'Ask AI about this',
  )!
  item.click()
  await settle()
  expect(onAsk).toHaveBeenCalledWith('title')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('has no header menu outside the studio', () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <TableView view={{ kind: 'table' }} schema={{ fields }} fields={fields} rows={rows} />, host)
  expect(host.querySelector('[aria-label="Actions for Title"]')).toBeNull()
})
