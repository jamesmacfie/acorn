import { render } from 'solid-js/web'
import type { Accessor, JSX } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardRevision, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { PanelGridItemActions } from './PanelGridItem'

// The placed panel loads its own revision and runs. Here it only hands the menu a revision.
vi.mock('./PublishedDashboardPanel', () => ({
  default: (props: { actions: (published: Accessor<DashboardRevision | undefined>) => JSX.Element }) => <div>{props.actions(() => revision)}</div>,
}))

const { default: PanelGridItem } = await import('./PanelGridItem')

const plan: PanelPlan = {
  version: 2, title: 'Pulls', time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [{ id: 'pulls', label: 'Pull requests', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
    name: 'Pull requests', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { parameters: {} }, sort: [] },
  } } }],
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: { pulls: { field: '/title' } } },
    { id: 'updated', label: 'Updated', type: 'datetime', bind: { pulls: { field: '/updated' } } },
  ],
  stages: [], view: { kind: 'list' }, sort: [{ column: 'updated', direction: 'desc' }],
}
let revision: DashboardRevision
let host: HTMLDivElement
let dispose: (() => void) | undefined
const quickEdit = vi.fn<PanelGridItemActions['quickEdit']>()
const item = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.ui-menu-item')].find(entry => entry.querySelector('.ui-menu-label')?.textContent === text)

const openMenu = () => {
  dispose = render(() => <PanelGridItem
    definition={{ id: 'd1', title: 'Pulls', shaping: {}, view: { kind: 'list' }, publication: { dashboardId: 'd1' } }}
    scope={{ surface: 'home' }}
    layout={{
      collapsed: () => false, style: () => ({}), gestureKind: () => undefined, keyboardActive: () => false, announcement: () => '',
      register: () => {}, unregister: () => {}, onKeyDown: () => {}, onBlur: () => {}, onBeginDrag: () => {}, onBeginResize: () => {},
    }}
    actions={{
      edit: () => {}, editWithAi: () => {}, openStudio: () => {}, quickEdit, canDuplicate: () => true, duplicate: () => {},
      beginLayout: () => {}, canMove: () => true, move: () => {}, moveTargets: () => [], moveToTab: () => {},
      remove: () => {}, delete: async () => {}, deleteFailed: () => {},
    }}
  />, host)
  host.querySelector<HTMLButtonElement>('button[aria-label="Pulls panel actions"]')!.click()
}

beforeEach(() => {
  revision = { dashboardId: 'd1', workspaceId: 'w', revision: 2, content: plan, digest: 'x', createdAt: 1 } as DashboardRevision
  quickEdit.mockReset()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => { dispose?.(); host.remove() })

describe('PanelGridItem menu', () => {
  it('lists the edits, then About and Duplicate, then the layout moves', () => {
    openMenu()
    const rows = [...document.querySelectorAll('.ui-menu > *')].map(entry =>
      entry.matches('.ui-menu-separator') ? '-' : entry.querySelector('.ui-menu-label')?.textContent ?? entry.textContent)
    expect(rows).toEqual([
      'Edit…', 'Edit with AI…', 'Rename',
      '-', 'View as', 'Number', 'List', 'Table', 'Board', 'Chart',
      '-', 'Sort by', 'Title', 'Updated', 'Oldest first', 'Newest first',
      '-', 'About this panel', 'Duplicate',
      '-', 'Move or resize', 'Move up', 'Move down',
      '-', 'Remove from this dashboard', 'Delete panel',
    ])
  })

  it('disables a view the plan cannot use and says why', () => {
    openMenu()
    expect(item('Board')!.disabled).toBe(true)
    expect(item('Board')!.textContent).toContain('Group by a Choice column first.')
    expect(item('List')!.getAttribute('aria-checked')).toBe('true')
  })

  it('publishes a picked view or sort as one quick edit', () => {
    openMenu()
    item('Table')!.click()
    expect(quickEdit.mock.calls[0]![0](plan).view).toEqual({ kind: 'table' })
    openMenu()
    item('Title')!.click()
    expect(quickEdit.mock.calls[1]![0](plan).sort).toEqual([{ column: 'title', direction: 'desc' }])
  })
})
