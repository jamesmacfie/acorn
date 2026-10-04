import { QueryClient } from '@tanstack/solid-query'
import type { Project, Workspace } from '@acorn/protocol/api.ts'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActiveNode } from '../../infra/node/activeNode'
import { refreshFleet, _resetFleet } from '../../infra/node/fleet'
import { projectsKey, workspacesKey } from '../../infra/queries'
import { activeToasts, dismissToast } from '../notifications/toast'
import { addProjectFromFolder, canAddProjectFromFolder } from './addProject'

const local: NodeRecord = { nodeId: 'local', label: 'Local', endpoint: 'https://127.0.0.1:9443', local: true }
const remote: NodeRecord = { ...local, nodeId: 'remote', label: 'Remote', local: false }
const project: Project = {
  id: 'project', name: 'Repo', path: '/src/repo', workspaceId: 'work', sort: 0, hidden: false, color: null,
  vcs: 'git', defaultBranch: 'main', remoteUrl: null, github: null,
}
const workspaces: Workspace[] = [
  { id: 'work', name: 'Work', isDefault: false, sort: 0, projects: [] },
  { id: 'other', name: 'Personal', isDefault: false, sort: 1, projects: [] },
]

let queryClient: QueryClient
let returnedProject: Project
const pick = vi.fn<() => Promise<string | null>>()
const fetch = vi.fn<NonNullable<NonNullable<Window['acorn']>['nodeFetch']>>()

beforeEach(async () => {
  _resetFleet()
  returnedProject = project
  pick.mockReset().mockResolvedValue('/src/repo')
  fetch.mockReset().mockImplementation(async () => ({
    status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify({ project: returnedProject })),
  }))
  vi.stubGlobal('window', { acorn: {
    folderPath: { pick }, nodeFetch: fetch,
    fleetList: async () => ({ nodes: [local, remote], statuses: [local, remote].map(({ nodeId }) => ({ nodeId, state: 'online' })) }),
  } })
  await refreshFleet()
  setActiveNode(local.nodeId)
  queryClient = new QueryClient()
  queryClient.setQueryData(projectsKey, [])
  queryClient.setQueryData(workspacesKey, workspaces)
})

afterEach(() => {
  queryClient.clear()
  for (const { id } of activeToasts()) dismissToast(id)
  setActiveNode(null)
  _resetFleet()
  vi.unstubAllGlobals()
})

describe('adding a project from a folder', () => {
  it('offers the action only with a picker and a known local Node', () => {
    expect(canAddProjectFromFolder()).toBe(true)
    setActiveNode(remote.nodeId)
    expect(canAddProjectFromFolder()).toBe(false)
    setActiveNode('unknown')
    expect(canAddProjectFromFolder()).toBe(false)
    setActiveNode(local.nodeId)
    delete window.acorn!.folderPath
    expect(canAddProjectFromFolder()).toBe(false)
  })

  it('adds to the selected workspace on the local Node and refreshes membership', async () => {
    await addProjectFromFolder(queryClient, 'work')
    expect(fetch).toHaveBeenCalledOnce()
    const [nodeId, request] = fetch.mock.calls[0]
    expect(nodeId).toBe(local.nodeId)
    expect(request.path).toBe('/v1/core/projects')
    expect(request.method).toBe('POST')
    if (request.body?.kind !== 'bytes') throw new Error('Expected a JSON body')
    expect(JSON.parse(new TextDecoder().decode(request.body.bytes))).toEqual({ path: '/src/repo', workspaceId: 'work' })
    expect(queryClient.getQueryState(projectsKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(workspacesKey)?.isInvalidated).toBe(true)
    expect(activeToasts()).toMatchObject([{ message: 'Added Repo.', tone: 'success' }])
  })

  it('names the owning workspace when the API reuses a project in another workspace', async () => {
    returnedProject = { ...project, workspaceId: 'other' }
    await addProjectFromFolder(queryClient, 'work')
    expect(activeToasts()).toMatchObject([{
      message: 'Repo is already in Personal. Move it in Settings → Overview.', tone: 'neutral',
    }])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not pick or send a desktop folder when a remote Node is active', async () => {
    setActiveNode(remote.nodeId)
    await addProjectFromFolder(queryClient, 'work')
    expect(pick).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels when the active Node changes while the folder picker is open', async () => {
    let choose!: (path: string) => void
    pick.mockImplementation(() => new Promise((resolve) => { choose = resolve }))
    const adding = addProjectFromFolder(queryClient, 'work')
    setActiveNode(remote.nodeId)
    choose('/src/repo')
    await adding
    expect(fetch).not.toHaveBeenCalled()
    expect(activeToasts()).toMatchObject([{ message: 'The active Node changed. Choose the folder again.', tone: 'danger' }])
  })
})
