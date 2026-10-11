import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project, Workspace } from '@acorn/protocol/api.ts'

const data = vi.hoisted(() => ({ mode: 'off' as 'on' | 'off' }))
const project = (id: string, workspaceId: string): Project => ({
  id,
  name: id,
  workspaceId,
  path: `/src/${id}`,
  sort: 0,
  hidden: false,
  color: null,
  vcs: 'git',
  defaultBranch: 'main',
  remoteUrl: null,
  github: null,
})
const projects = [project('Alpha', 'a'), project('Beta', 'b')]
const workspaces: Workspace[] = [
  { id: 'a', name: 'Alpha space', isDefault: false, sort: 0, projects: [{ id: 'Alpha', name: 'Alpha', sort: 0 }] },
  { id: 'b', name: 'Beta space', isDefault: false, sort: 1, projects: [{ id: 'Beta', name: 'Beta', sort: 0 }] },
]
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { key: string }) => ({
    get data() {
      return options().key === 'projects' ? projects : options().key === 'workspaces' ? workspaces : []
    },
    isError: false,
  }),
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}))
vi.mock('../../infra/queries', () => ({
  projectsKey: ['projects'],
  workspacesKey: ['workspaces'],
  tasksKey: ['tasks'],
  projectsOptions: () => ({ key: 'projects' }),
  workspacesOptions: () => ({ key: 'workspaces' }),
  tasksOptions: () => ({ key: 'tasks' }),
}))
vi.mock('./workspacesMode', () => ({ createWorkspacesMode: () => () => data.mode }))
vi.mock('../../infra/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infra/platform')>()),
  canPickFolder: () => false,
}))
vi.mock('../../host/registries/sources/projectImporters', () => ({ projectImporterContributions: () => [] }))

import WorkspaceProjectAssignments from './WorkspaceProjectAssignments'

let host: HTMLElement
let dispose: () => void
afterEach(() => {
  dispose?.()
  host?.remove()
})
const mount = (mode: 'on' | 'off') => {
  data.mode = mode
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <WorkspaceProjectAssignments navigate={() => {}} />, host)
}

describe('Settings Overview workspace mode', () => {
  it('draws a flat table with hide and colour, without workspace controls while off', () => {
    mount('off')
    expect(host.querySelectorAll('.ws-group-name')).toHaveLength(0)
    expect(host.textContent).not.toContain('Unassigned')
    expect(host.textContent).not.toContain('New workspace')
    expect(host.textContent).toContain('Group projects into workspaces')
    host.querySelector<HTMLInputElement>('input[aria-label="Select Alpha"]')!.click()
    expect(host.textContent).toContain('Hide')
    expect(host.querySelector('[aria-label="Set rail colour"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Move to workspace"]')).toBeNull()
  })

  it('keeps workspace groups and move controls while on', () => {
    mount('on')
    expect(host.querySelectorAll('.ws-group-name')).toHaveLength(2)
    expect(host.textContent).toContain('New workspace')
    expect(host.textContent).not.toContain('Group projects into workspaces')
    host.querySelector<HTMLInputElement>('input[aria-label="Select Alpha"]')!.click()
    expect(host.querySelector('[aria-label="Move to workspace"]')).not.toBeNull()
  })
})
