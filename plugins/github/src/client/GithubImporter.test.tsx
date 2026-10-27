import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { integrationsKey, projectsKey } from '@acorn/protocol/api.ts'
import { activeNodeId, setActiveNode } from '@acorn/plugin-api/client'
import { reposKey, type Repo } from '../shared/api'

// The folder comes from the folder dialog where it can browse the Node's disk, and from a folder field
// in the row everywhere else, such as on a remote Node (docs/github-integration.md § Importing projects).
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

import GithubImporter from './GithubImporter'

const repo = (id: number, name: string): Repo => ({
  id,
  owner: 'acme',
  name,
  private: false,
  defaultBranch: 'main',
  pushedAt: null,
})

let host: HTMLDivElement
let dispose: () => void
let originalNodeId: string | null
const onImported = vi.fn()

beforeEach(() => {
  originalNodeId = activeNodeId()
  setActiveNode('homelab')
  seams.local = true
  seams.pickNodeFolder.mockReset()
  seams.writeJson.mockReset().mockResolvedValue({ results: [{ ok: true, projectId: 'p1' }] })
  onImported.mockReset()
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(integrationsKey, {
    providers: [],
    integrations: [{ id: 'c1', providerId: 'github', label: 'GitHub', status: 'connected' }],
  })
  client.setQueryData(reposKey, [repo(1, 'api'), repo(2, 'web')])
  client.setQueryData(projectsKey, [])
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <GithubImporter onImported={onImported} onClose={() => {}} />
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

const rowFor = (label: string) =>
  [...host.querySelectorAll<HTMLElement>('.ui-setting-row')].find((row) => row.textContent?.includes(label))!
const press = (label: string, name: string) =>
  [...rowFor(label).querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === name)!
    .click()
const field = (label: string) => rowFor(label).querySelector<HTMLInputElement>('form input')
const submitTyped = (label: string, path: string) => {
  const input = field(label)!
  input.value = path
  input.dispatchEvent(new Event('input', { bubbles: true }))
  rowFor(label).querySelector('form')!.requestSubmit()
}
const sent = () => JSON.parse(seams.writeJson.mock.calls.at(-1)![1].body).repositories

describe('GitHub importer folders', () => {
  it('asks the folder dialog on a Node it can browse', async () => {
    seams.pickNodeFolder.mockResolvedValue('/Users/james/src')
    press('acme/api', 'Clone')
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(['p1']))
    expect(sent()).toEqual([{ repoId: 1, action: 'clone', parentDir: '/Users/james/src' }])
    expect(field('acme/api')).toBeNull()
  })

  it('opens a folder field in the row elsewhere, and starts the next Clone with the last folder', async () => {
    seams.local = false
    press('acme/api', 'Clone')
    expect(seams.pickNodeFolder).not.toHaveBeenCalled()
    submitTyped('acme/api', '/home/james/src')
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(['p1']))
    expect(sent()).toEqual([{ repoId: 1, action: 'clone', parentDir: '/home/james/src' }])
    await vi.waitFor(() => expect(field('acme/api')).toBeNull())

    press('acme/web', 'Clone')
    expect(field('acme/web')!.value).toBe('/home/james/src')
    press('acme/web', 'Link folder')
    expect(field('acme/web')!.value).toBe('')
  })

  it("keeps the field open with the Node's error in the row", async () => {
    seams.local = false
    seams.writeJson.mockResolvedValue({ results: [{ ok: false, error: "That folder doesn't exist on this Node." }] })
    press('acme/api', 'Clone')
    submitTyped('acme/api', '/home/james/nope')
    await vi.waitFor(() =>
      expect(rowFor('acme/api').querySelector('[role="alert"]')?.textContent).toBe(
        "That folder doesn't exist on this Node.",
      ),
    )
    expect(field('acme/api')).not.toBeNull()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('drops an open field when the active Node changes', async () => {
    seams.local = false
    press('acme/api', 'Link folder')
    expect(field('acme/api')).not.toBeNull()
    setActiveNode('another-node')
    await vi.waitFor(() => expect(field('acme/api')).toBeNull())
    expect(seams.writeJson).not.toHaveBeenCalled()
  })
})
