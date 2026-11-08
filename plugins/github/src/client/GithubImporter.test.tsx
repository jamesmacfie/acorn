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
  cloneRun: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', async (original) => {
  const actual = await original<typeof import('@acorn/plugin-api/client')>()
  return {
    ...actual,
    canAddProjectFromFolder: () => seams.local,
    pickNodeFolder: seams.pickNodeFolder,
    writeJson: seams.writeJson,
    // Only the clone run's reads; the lists' refetches go through as they would.
    readJson: (url: string, options?: Parameters<typeof actual.readJson>[1]) =>
      url.startsWith('/v1/core/projects/clone-runs/') ? seams.cloneRun(url, options) : actual.readJson(url, options),
  }
})

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
  seams.writeJson.mockReset().mockResolvedValue({ results: [{ ok: true, action: 'clone', cloneId: 'run-1' }] })
  seams.cloneRun.mockReset().mockResolvedValue({ state: 'finished', result: { ok: true, projectId: 'p1' } })
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
const description = (label: string) => rowFor(label).textContent ?? ''
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

  it('links a folder without a clone run', async () => {
    seams.writeJson.mockResolvedValue({ results: [{ ok: true, action: 'map', projectId: 'p2' }] })
    seams.pickNodeFolder.mockResolvedValue('/Users/james/src/api')
    press('acme/api', 'Link folder')
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(['p2']))
    expect(seams.cloneRun).not.toHaveBeenCalled()
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

// The Node clones in the background, and the row follows the run (docs/workspaces-and-tasks/clone-runs.md).
describe('GitHub importer clone runs', () => {
  it('shows Cloning… on the row until the run finishes, and lets another row clone meanwhile', async () => {
    let finish!: (run: unknown) => void
    seams.cloneRun.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    seams.pickNodeFolder.mockResolvedValue('/Users/james/src')
    press('acme/api', 'Clone')
    await vi.waitFor(() => expect(description('acme/api')).toContain('Cloning…'))
    expect(seams.cloneRun).toHaveBeenCalledWith(
      '/v1/core/projects/clone-runs/run-1?waitMs=20000',
      expect.objectContaining({ nodeId: 'homelab', long: true }),
    )
    const cloneButton = (label: string) =>
      [...rowFor(label).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Clone')!
    expect(cloneButton('acme/api').disabled).toBe(true)
    expect(cloneButton('acme/web').disabled).toBe(false)
    expect(onImported).not.toHaveBeenCalled()

    finish({ state: 'finished', result: { ok: true, projectId: 'p1' } })
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(['p1']))
    expect(description('acme/api')).toContain('Cloned')
  })

  it("shows a failed clone's error on its row", async () => {
    seams.cloneRun.mockResolvedValue({ state: 'finished', result: { ok: false, error: 'Repository not found.' } })
    seams.pickNodeFolder.mockResolvedValue('/Users/james/src')
    press('acme/api', 'Clone')
    await vi.waitFor(() =>
      expect(rowFor('acme/api').querySelector('[role="alert"]')?.textContent).toBe('Repository not found.'),
    )
    expect(onImported).not.toHaveBeenCalled()
  })

  it('stops following when the importer closes', async () => {
    let finish!: (run: unknown) => void
    seams.cloneRun.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    seams.pickNodeFolder.mockResolvedValue('/Users/james/src')
    press('acme/api', 'Clone')
    await vi.waitFor(() => expect(seams.cloneRun).toHaveBeenCalled())
    const { signal } = seams.cloneRun.mock.calls[0]![1] as { signal: AbortSignal }
    dispose()
    expect(signal.aborted).toBe(true)
    finish({ state: 'finished', result: { ok: true, projectId: 'p1' } })
    await Promise.resolve()
    expect(onImported).not.toHaveBeenCalled()
  })
})
