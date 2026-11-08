import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { integrationsKey, projectsKey } from '@acorn/protocol/api.ts'
import { activeNodeId, setActiveNode } from '@acorn/plugin-api/client'
import { repositoriesKey } from '../shared/api'

// The folder dialog where it can browse the Node's disk, and a folder field in the row everywhere else,
// as GithubImporter.test.tsx checks in full.
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

import BitbucketImporter from './BitbucketImporter'

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
  seams.cloneRun.mockReset()
  onImported.mockReset()
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(integrationsKey, {
    providers: [],
    integrations: [{ id: 'c1', providerId: 'bitbucket', label: 'Bitbucket', status: 'connected' }],
  })
  client.setQueryData(repositoriesKey, [
    { path: 'acme/api', name: 'api', private: false, defaultBranch: 'main', updatedAt: null },
  ])
  client.setQueryData(projectsKey, [])
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <BitbucketImporter onImported={onImported} onClose={() => {}} />
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
const sent = () => JSON.parse(seams.writeJson.mock.calls.at(-1)![1].body).repositories

describe('Bitbucket importer folders', () => {
  // The row follows the clone run, as GithubImporter.test.tsx checks in full.
  it('asks the folder dialog on a Node it can browse, and follows the clone', async () => {
    let finish!: (run: unknown) => void
    seams.cloneRun.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    seams.writeJson.mockResolvedValue({ results: [{ ok: true, action: 'clone', cloneId: 'run-1' }] })
    seams.pickNodeFolder.mockResolvedValue('/Users/james/src')
    press('Clone')
    await vi.waitFor(() => expect(row().textContent).toContain('Cloning…'))
    expect(seams.cloneRun.mock.calls[0]![0]).toBe('/v1/core/projects/clone-runs/run-1?waitMs=20000')
    finish({ state: 'finished', result: { ok: true, projectId: 'p1' } })
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith(['p1']))
    expect(row().textContent).toContain('Cloned')
    expect(sent()).toEqual([{ repository: 'acme/api', action: 'clone', parentDir: '/Users/james/src' }])
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
    expect(sent()).toEqual([{ repository: 'acme/api', action: 'map', path: '/home/james/src/api' }])
    await vi.waitFor(() => expect(field()).toBeNull())
  })
})
