import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Workspace } from '@acorn/protocol/api.ts'

// Default is where a deleted workspace's projects land, so no page in settings may rename or delete
// it: not its own page, and not Overview, whose rows only open pages. Another workspace can be both.
const mocks = vi.hoisted(() => ({
  workspaces: [] as Workspace[],
  projects: [] as Project[],
  renameWorkspace: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { of?: string }) => ({
    get data() {
      const of = options().of
      return of === 'workspaces' ? mocks.workspaces : of === 'projects' ? mocks.projects : []
    },
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}))
vi.mock('../../infra/queries', () => ({
  projectsKey: ['projects'], workspacesKey: ['workspaces'], tasksKey: ['tasks'],
  projectsOptions: () => ({ of: 'projects' }),
  workspacesOptions: () => ({ of: 'workspaces' }),
  tasksOptions: () => ({ of: 'tasks' }),
  integrationsOptions: () => ({ of: 'integrations' }),
}))
vi.mock('../workspaces/workspaceMutations', () => ({
  renameWorkspace: mocks.renameWorkspace,
  deleteWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  createProject: vi.fn(),
  patchProject: vi.fn(),
}))

import WorkspaceSettings from './WorkspaceSettings'
import WorkspaceProjectAssignments from '../workspaces/WorkspaceProjectAssignments'
import type { SettingsPageContext } from '../../host/registries/shell/settings'

const DEFAULT: Workspace = { id: 'ws-default', name: 'Default', isDefault: true, sort: 0, projects: [] }
const RUNN: Workspace = { id: 'ws-runn', name: 'Runn', isDefault: false, sort: 1, projects: [] }
const project = (id: string, workspaceId: string): Project => ({
  id, name: id, path: `/src/${id}`, workspaceId, sort: 0, hidden: false, color: null, vcs: 'git', defaultBranch: 'main', remoteUrl: null, github: null,
})
const context = (workspace: Workspace): SettingsPageContext => ({
  scope: { nodeId: 'node-a', workspace }, navigate: () => {}, onWorkspaceDeleted: () => {},
})

let host: HTMLElement
let dispose: (() => void) | undefined
beforeEach(() => {
  mocks.workspaces = [DEFAULT, RUNN]
  mocks.projects = [project('acorn', DEFAULT.id), project('runn-fast', RUNN.id)]
  mocks.renameWorkspace.mockClear()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

const nameField = () => host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!
const sectionIds = () => [...host.querySelectorAll('[data-settings-section]')].map((section) => section.getAttribute('data-settings-section'))

describe('the Default workspace', () => {
  it('cannot be renamed or deleted from its own page', async () => {
    dispose = render(() => <WorkspaceSettings workspace={DEFAULT} context={context(DEFAULT)} />, host)
    expect(nameField().disabled).toBe(true)
    expect(host.textContent).toContain("The Default workspace can't be renamed.")
    expect(sectionIds()).toEqual(['general', 'projects', 'connections'])
    // Even a commit that reached the field is refused before it becomes a write.
    nameField().value = 'Mine'
    nameField().dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(mocks.renameWorkspace).not.toHaveBeenCalled()
  })

  it('leaves another workspace renameable and deletable', () => {
    dispose = render(() => <WorkspaceSettings workspace={RUNN} context={context(RUNN)} />, host)
    expect(nameField().disabled).toBe(false)
    expect(sectionIds()).toEqual(['general', 'projects', 'connections', 'danger'])
  })

  it('has no rename or delete on Overview, where each workspace only opens its page', () => {
    dispose = render(() => <WorkspaceProjectAssignments navigate={() => {}} />, host)
    const table = host.querySelector('table')!
    expect(table.textContent).toContain('Default')
    expect(table.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(0)
    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).not.toContain('Delete')
  })
})
