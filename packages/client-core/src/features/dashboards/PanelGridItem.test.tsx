import { render } from 'solid-js/web'
import type { Accessor, JSX } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardRevision, PanelPlan } from '@acorn/protocol/dashboards.ts'
import { Menu } from '../../kit/components/overlays/Menu'
import { dashboardCellRegistry } from './cells'
import type { PanelDefinition } from './model'
import type { PanelGridItemActions } from './PanelGridItem'

// The placed panel loads its own revision and runs. Here it only hands the menu a revision.
vi.mock('./PublishedDashboardPanel', () => ({
  default: (props: { actions: (published: Accessor<DashboardRevision | undefined>) => JSX.Element }) => (
    <div>{props.actions(() => revision)}</div>
  ),
}))

const { default: PanelGridItem } = await import('./PanelGridItem')

const plan: PanelPlan = {
  version: 2,
  title: 'Pulls',
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [
    {
      id: 'pulls',
      label: 'Pull requests',
      role: 'primary',
      reference: {
        kind: 'inline',
        bindings: {},
        content: {
          name: 'Pull requests',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          sourceParameters: {},
          query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { parameters: {} }, sort: [] },
        },
      },
    },
  ],
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: { pulls: { field: '/title' } } },
    { id: 'updated', label: 'Updated', type: 'datetime', bind: { pulls: { field: '/updated' } } },
  ],
  stages: [],
  view: { kind: 'list' },
  sort: [{ column: 'updated', direction: 'desc' }],
}
let revision: DashboardRevision
let host: HTMLDivElement
let dispose: (() => void) | undefined
const quickEdit = vi.fn<PanelGridItemActions['quickEdit']>()
const menuRows = () =>
  [...document.querySelectorAll('.ui-menu > *')].map((entry) =>
    entry.matches('.ui-menu-separator')
      ? '-'
      : (entry.querySelector('.ui-menu-label')?.textContent ?? entry.textContent),
  )
const item = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.ui-menu-item')].find(
    (entry) => entry.querySelector('.ui-menu-label')?.textContent === text,
  )

const published: PanelDefinition = {
  id: 'd1',
  title: 'Pulls',
  shaping: {},
  view: { kind: 'list' },
  publication: { dashboardId: 'd1' },
}

const openMenu = (definition = published) => {
  dispose = render(
    () => (
      <PanelGridItem
        definition={definition}
        scope={{ surface: 'home' }}
        layout={{
          collapsed: () => false,
          style: () => ({}),
          gestureKind: () => undefined,
          keyboardActive: () => false,
          announcement: () => '',
          register: () => {},
          unregister: () => {},
          onKeyDown: () => {},
          onBlur: () => {},
          onBeginDrag: () => {},
          onBeginResize: () => {},
        }}
        actions={{
          edit: () => {},
          editWithAi: () => {},
          openStudio: () => {},
          quickEdit,
          canDuplicate: () => true,
          duplicate: () => {},
          beginLayout: () => {},
          canMove: () => true,
          move: () => {},
          moveTargets: () => [],
          moveToTab: () => {},
          remove: () => {},
          delete: async () => {},
          deleteFailed: () => {},
        }}
      />
    ),
    host,
  )
  host.querySelector<HTMLButtonElement>('button[aria-label="Pulls panel actions"]')!.click()
}

beforeEach(() => {
  revision = {
    dashboardId: 'd1',
    workspaceId: 'w',
    revision: 2,
    content: plan,
    digest: 'x',
    createdAt: 1,
  } as DashboardRevision
  quickEdit.mockReset()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

describe('PanelGridItem menu', () => {
  it('lists the edits, then About and Duplicate, then the layout moves', () => {
    openMenu()
    expect(menuRows()).toEqual([
      'Edit…',
      'Edit with AI…',
      'Rename',
      '-',
      'View as',
      'Number',
      'List',
      'Table',
      'Board',
      'Chart',
      '-',
      'Sort by',
      'Title',
      'Updated',
      'Oldest first',
      'Newest first',
      '-',
      'About this panel',
      'Duplicate',
      '-',
      'Move or resize',
      'Move up',
      'Move down',
      '-',
      'Remove from this dashboard',
      'Delete panel',
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

  it('draws a definition this build does not know inert, with a menu that only arranges and removes it', () => {
    openMenu({ id: 'c1', title: 'Pulls', shaping: {}, view: { kind: 'later-kind' } })
    expect(host.textContent).toContain("Acorn can't show this here.")
    expect(menuRows()).toEqual(['Move or resize', 'Move up', 'Move down', '-', 'Remove from this dashboard'])
  })

  it('draws a kind a plugin registered with its body and its menu items above the layout items', () => {
    const registration = dashboardCellRegistry.register({
      id: 'later-kind',
      component: (props) => <p>{`Drawn ${String(props.definition.extra)}`}</p>,
      menuItems: (props) => (
        <Menu.Item context={props.menu} onSelect={() => {}}>
          Open it
        </Menu.Item>
      ),
    })
    openMenu({ id: 'c1', title: 'Pulls', shaping: {}, view: { kind: 'later-kind' }, extra: 'here' } as PanelDefinition)
    expect(host.textContent).toContain('Drawn here')
    expect(menuRows()).toEqual([
      'Open it',
      '-',
      'Move or resize',
      'Move up',
      'Move down',
      '-',
      'Remove from this dashboard',
    ])
    registration.dispose()
  })
})
