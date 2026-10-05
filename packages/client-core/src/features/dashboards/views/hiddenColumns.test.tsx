import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { DashboardDisplayField } from '@acorn/dashboards-core/render'

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
const { default: ListView } = await import('./ListView')
const { default: TableView } = await import('./TableView')

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); document.body.replaceChildren() })

const fields: DashboardDisplayField[] = [
  { id: 'title', name: 'Title', type: 'text', role: 'title' },
  { id: 'owner', name: 'Owner', type: 'text' },
  { id: 'rank', name: 'Rank', type: 'number', hidden: true },
]
const rows = [{ id: 'one', pluginId: 'core', sourceId: 'tasks', values: { title: 'Ship it', owner: 'Ada', rank: 7 } }]

it('leaves hidden columns out of a table and a list', () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <>
    <TableView view={{ kind: 'table' }} schema={{ fields }} fields={fields} rows={rows} />
    <ListView view={{ kind: 'list' }} schema={{ fields }} fields={fields} rows={rows} />
  </>, host)
  expect(host.textContent).toContain('Owner')
  expect(host.textContent).toContain('Ada')
  expect(host.textContent).not.toContain('Rank')
  expect(host.textContent).not.toContain('7')
})
