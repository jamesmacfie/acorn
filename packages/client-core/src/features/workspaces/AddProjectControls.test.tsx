// @vitest-environment jsdom
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  create: vi.fn(async (_seed: { path: string }) => ({ project: { id: 'created' } })),
  imported: undefined as undefined | ((ids?: readonly string[]) => void),
  local: false,
  picker: false,
  projects: [{ id: 'first' }, { id: 'second' }],
}))
vi.mock('@tanstack/solid-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    getQueryData: () => state.projects,
  }),
}))
vi.mock('../../infra/queries', () => ({ projectsKey: ['projects'], workspacesKey: ['workspaces'], tasksKey: ['tasks'] }))
vi.mock('../../infra/platform', () => ({ canPickFolder: () => state.picker, pickFolder: async () => '/client/path' }))
vi.mock('./addProject', () => ({ canAddProjectFromFolder: () => state.local }))
vi.mock('./workspaceMutations', () => ({ createProject: state.create }))
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => 'remote' }))
vi.mock('../../host/registries/sources/projectImporters', () => ({
  projectImporterContributions: () => [{ id: 'fake', label: 'Import', glyph: 'plus', component: (props: { onImported: (ids?: readonly string[]) => void }) => {
    state.imported = props.onImported
    return null
  } }],
}))

import AddProjectControls from './AddProjectControls'

let host: HTMLElement
let dispose = () => {}
afterEach(() => { dispose(); host?.remove(); state.create.mockClear(); state.imported = undefined; state.local = false; state.picker = false })
const mount = (onProjectAdded: (id: string) => void) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AddProjectControls onProjectAdded={onProjectAdded} />, host)
}

describe('shared add project controls', () => {
  it('uses an absolute Node path without an explicit workspace and opens the returned project', async () => {
    const added = vi.fn()
    mount(added)
    const input = host.querySelector('input')!
    input.value = '/remote/work'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(added).toHaveBeenCalledWith('created'))
    expect(state.create).toHaveBeenCalledWith({ path: '/remote/work' })
    expect(host.textContent).not.toContain('Add folder…')
  })

  it('selects a reported project ID that exists in the refreshed list', async () => {
    const added = vi.fn()
    mount(added)
    host.querySelectorAll('button')[1]!.click()
    state.imported?.(['missing', 'second', 'first'])
    await vi.waitFor(() => expect(added).toHaveBeenCalledWith('second'))
  })

  it('sends a local picker path without workspace membership', async () => {
    state.local = true
    state.picker = true
    const added = vi.fn()
    mount(added)
    host.querySelector('button')!.click()
    await vi.waitFor(() => expect(added).toHaveBeenCalledWith('created'))
    expect(state.create).toHaveBeenCalledWith({ path: '/client/path' })
  })
})
