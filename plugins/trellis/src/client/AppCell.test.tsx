import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { DashboardCellDefinition } from '@acorn/plugin-api/client'
import type { AppListing } from '../shared/api'

const [deletedAt, setDeletedAt] = createSignal<number>()
const mocks = vi.hoisted(() => ({ placements: [] as string[], navigate: vi.fn(), setSelectedSource: vi.fn() }))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'n',
  allProjects: () => [{ id: 'p', name: 'acorn', workspaceId: 'w' }],
  toast: () => {},
  setSelectedSource: mocks.setSelectedSource,
}))
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('./ProjectApps', () => ({
  useAppEditing: () => ({}),
  setDeleted: async (_nodeId: string, _appId: string, deleted: boolean) => setDeletedAt(deleted ? 1 : undefined),
}))
vi.mock('./addToDashboard', () => ({ projectWorkspaceId: () => 'w' }))
vi.mock('./appsStore', () => ({
  appsLoaded: () => true,
  refreshApps: async () => {},
  appById: (appId: string): AppListing | undefined =>
    appId === 'app-0123456789ab'
      ? { appId, projectId: 'p', name: 'Checklist', description: '', head: 3, updatedAt: 0, deletedAt: deletedAt() }
      : undefined,
}))
// The revision itself runs lang-core. Here it only says where it was drawn.
vi.mock('./AppToolCard', () => ({
  Revision: (props: { revision: number; placement: string }) => {
    mocks.placements.push(props.placement)
    return <p>{`v${props.revision} drawn`}</p>
  },
}))
import { AppDashboardCell, AppDashboardCellMenu } from './AppCell'

const definition = (appId: string): DashboardCellDefinition => ({
  id: `cell-${appId}`,
  title: 'Checklist',
  shaping: {},
  view: { kind: 'app' },
  app: { projectId: 'p', appId },
})

let host: HTMLDivElement, dispose: () => void
afterEach(() => {
  dispose?.()
  host?.remove()
  setDeletedAt(undefined)
})
const draw = (appId: string, remove = () => {}) => {
  host = document.body.appendChild(document.createElement('div'))
  dispose = render(() => <AppDashboardCell definition={definition(appId)} refreshes={() => 0} remove={remove} />, host)
}

it("draws the app's head on the dashboard and names its project", () => {
  draw('app-0123456789ab')
  expect(host.textContent).toContain('acorn · v3')
  expect(host.textContent).toContain('v3 drawn')
  expect(mocks.placements).toContain('dashboard')
})

it('says a deleted app is unavailable, offers Remove and Restore, and draws it again once restored', async () => {
  const remove = vi.fn()
  setDeletedAt(1)
  draw('app-0123456789ab', remove)
  expect(host.textContent).toContain("Checklist isn't available")
  expect(host.textContent).toContain('It was deleted from acorn.')
  const button = (label: string) => [...host.querySelectorAll('button')].find((each) => each.textContent === label)!
  button('Remove from this dashboard').click()
  expect(remove).toHaveBeenCalled()
  button('Restore').click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(host.textContent).toContain('v3 drawn')
})

it('says an app removed for good is gone', () => {
  draw('app-ffffffffffff')
  expect(host.textContent).toContain('It was removed from acorn for good.')
})

it('offers Open app, which selects the Apps source and goes to the app, while the app is live', () => {
  host = document.body.appendChild(document.createElement('div'))
  const menu = { close: () => {}, register: () => {} }
  dispose = render(() => <AppDashboardCellMenu definition={definition('app-0123456789ab')} menu={menu} />, host)
  expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    'Open app',
    'Edit in a new task',
  ])
  host.querySelector('button')!.click()
  expect(mocks.setSelectedSource).toHaveBeenCalledWith('apps')
  expect(mocks.navigate).toHaveBeenCalledWith('/p/p/apps/app-0123456789ab')
  dispose()
  setDeletedAt(1)
  dispose = render(() => <AppDashboardCellMenu definition={definition('app-0123456789ab')} menu={menu} />, host)
  expect(host.querySelectorAll('button')).toHaveLength(0)
})
