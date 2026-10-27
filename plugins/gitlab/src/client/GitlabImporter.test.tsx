import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { integrationsKey, projectsKey } from '@acorn/protocol/api.ts'
import { activeNodeId, setActiveNode } from '@acorn/plugin-api/client'
import { projectsKey as gitlabProjectsKey } from '../shared/api'

// The folder dialog where it can browse the Node's disk, and a folder field in the row everywhere else,
// as GithubImporter.test.tsx checks in full.
const seams = vi.hoisted(() => ({
  local: true,
  pickNodeFolder: vi.fn<() => Promise<string | null>>(),
  writeJson: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...(await original<typeof import('@acorn/plugin-api/client')>()),
  canAddProjectFromFolder: () => seams.local,
  pickNodeFolder: seams.pickNodeFolder,
  writeJson: seams.writeJson,
}))

import GitlabImporter from './GitlabImporter'

let host: HTMLDivElement
let dispose: () => void
let originalNodeId: string | null
const onImported = vi.fn()

beforeEach(() => {
  originalNodeId = activeNodeId()
  setActiveNode('homelab')
  seams.local = true
  seams.pickNodeFolder.mockReset()
  seams.writeJson.mockReset().mockResolvedValue({ results: [{ ok: true, acornProjectId: 'p1' }] })
  onImported.mockReset()
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(integrationsKey, {
    providers: [],
    integrations: [{ id: 'c1', providerId: 'gitlab', label: 'GitLab', status: 'connected' }],
  })
  client.setQueryData(gitlabProjectsKey, [
    {
      id: 7,
      host: 'gitlab.com',
      path: 'acme/api',
      name: 'api',
      private: false,
      defaultBranch: 'main',
      lastActivityAt: null,
    },
  ])
  client.setQueryData(projectsKey, [])
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <GitlabImporter onImported={onImported} onClose={() => {}} />
      </QueryClientProvider>
    ),
    host,
  )
})

afterEach(() => {
  dispose()
  host.remove()
  setActiveNode(originalNodeId)
})

const row = () => host.querySelector<HTMLElement>('.ui-setting-row')!
const press = (name: string) =>
  [...row().querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === name)!
    .click()
const field = () => row().querySelector<HTMLInputElement>('form input')
const sent = () => JSON.parse(seams.writeJson.mock.calls.at(-1)![1].body).projects

describe('GitLab importer folders', () => {
  it('asks the folder dialog on a Node it can browse', async () => {
    seams.pickNodeFolder.mockResolvedValue('/Users/james/src')
    press('Clone')
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(['p1']))
    expect(sent()).toEqual([{ host: 'gitlab.com', projectId: 7, action: 'clone', parentDir: '/Users/james/src' }])
    expect(field()).toBeNull()
  })

  it('opens a folder field in the row elsewhere', async () => {
    seams.local = false
    press('Link folder')
    expect(seams.pickNodeFolder).not.toHaveBeenCalled()
    field()!.value = '/home/james/src/api'
    field()!.dispatchEvent(new Event('input', { bubbles: true }))
    row().querySelector('form')!.requestSubmit()
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(['p1']))
    expect(sent()).toEqual([{ host: 'gitlab.com', projectId: 7, action: 'map', path: '/home/james/src/api' }])
    await vi.waitFor(() => expect(field()).toBeNull())
  })
})
