import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { GitRef, GitRemote } from '../shared/api'

const [node, setNode] = createSignal('node-a')
const [project, setProject] = createSignal('project-a')
const [selectedRef, setSelectedRef] = createSignal<string | null>('local:topic')
const [selectedRemote, setSelectedRemote] = createSignal<string | null>('origin')
const setQueryData = vi.fn()
const invalidateQueries = vi.fn()
const changeRef = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const changeRemote = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const ref: GitRef = { kind: 'local', name: 'topic', objectId: 'a'.repeat(40), commitId: 'a'.repeat(40), upstream: null, checkedOut: false, reservedBy: [] }
const remote: GitRemote = { name: 'origin', fetchUrl: '/remote', pushUrl: '/remote', fetchUrlCount: 1, pushUrlCount: 0 }
vi.mock('@tanstack/solid-query', () => ({
  createQuery: (options: () => { queryKey: readonly unknown[] }) => ({
    get data() { return options().queryKey[0] === 'git-refs' ? { refs: [ref] } : { remotes: [remote], lastFetch: {} } },
    get error() { return null }, get isLoading() { return false },
  }),
  useQueryClient: () => ({ setQueryData, invalidateQueries }),
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  latestSignal: (await original<typeof import('@acorn/plugin-api/client')>()).latestSignal, activeNodeId: node, requestTaskLaunch: vi.fn() }))
vi.mock('./launchWorkflow', () => ({ sameGitActionScope: (captured: string, projectId: string, current: string) => captured === node() && projectId === current,
  launchWorkflowAtCommit: vi.fn() }))
vi.mock('./refsClient', () => ({ refsKey: (id: string) => ['git-refs', node(), id], refsOptions: (id: string) => ({ queryKey: ['git-refs', node(), id] }), changeRef }))
vi.mock('./remotesClient', () => ({ remotesKey: (id: string) => ['git-remotes', node(), id], remotesOptions: (id: string) => ({ queryKey: ['git-remotes', node(), id] }), changeRemote }))
vi.mock('./TaskRemoteActions', () => ({ TaskRemoteActions: () => null }))

const { RefDetail } = await import('./RefBrowse')
const { RemoteDetail } = await import('./RemoteBrowse')
let host: HTMLElement | null = null
let dispose = () => {}
afterEach(() => {
  dispose(); host?.remove(); host = null
  for (const modal of document.querySelectorAll('.ui-modal-overlay')) modal.remove()
  setNode('node-a'); setProject('project-a'); setSelectedRef('local:topic'); setSelectedRemote('origin')
  changeRef.mockReset(); changeRemote.mockReset(); setQueryData.mockReset(); invalidateQueries.mockReset()
})
const draw = (kind: 'ref' | 'remote') => {
  host = document.createElement('div'); document.body.append(host)
  dispose = render(() => kind === 'ref'
    ? <RefDetail projectId={project()} selected={selectedRef()} />
    : <RemoteDetail projectId={project()} selected={selectedRemote()} />, host)
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)!
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

it('keeps a late ref mutation in its original Node cache and leaves a replacement dialog open', async () => {
  let settle!: (value: unknown) => void
  changeRef.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw('ref')
  button('Create branch').click()
  button('Save').click()
  setNode('node-b'); setProject('project-b')
  await tick()
  button('Create tag').click()
  settle({ ok: false, reason: 'old refusal', roster: { refs: [] }, postState: 'fresh' })
  await tick()
  expect(document.body.textContent).toContain('create tag')
  expect(document.body.textContent).not.toContain('old refusal')
  expect(setQueryData).toHaveBeenCalledWith(['git-refs', 'node-a', 'project-a'], { refs: [] })
})

it('does not put a late remote fetch result or failure into a dismissed action', async () => {
  let settle!: (value: unknown) => void
  changeRemote.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw('remote')
  button('Fetch this remote').click()
  button('Fetch').click()
  button('Cancel').click()
  button('Edit fetch URL').click()
  settle({ ok: false, reason: 'old fetch failed', roster: { remotes: [remote], lastFetch: {} }, postState: 'fresh' })
  await tick()
  expect(document.body.textContent).toContain('set-url remote')
  expect(document.body.textContent).not.toContain('old fetch failed')
  expect(setQueryData).toHaveBeenCalledWith(['git-remotes', 'node-a', 'project-a'], { remotes: [remote], lastFetch: {} })
  dispose(); dispose = () => {}
})

it('keeps partial ref failure visible for retry and ignores completion after disposal', async () => {
  changeRef.mockResolvedValueOnce({ ok: false, reason: 'branch changed', roster: { refs: [ref] }, postState: 'fresh' })
  draw('ref')
  button('Create branch').click()
  button('Save').click()
  await tick()
  expect(document.body.textContent).toContain('branch changed')
  let settle!: (value: unknown) => void
  changeRef.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  button('Save').click()
  dispose(); dispose = () => {}
  settle({ ok: true, roster: { refs: [] }, postState: 'fresh' })
  await tick()
  expect(setQueryData).toHaveBeenLastCalledWith(['git-refs', 'node-a', 'project-a'], { refs: [] })
})

it('puts a late old-Node remote result only in its captured cache', async () => {
  let settle!: (value: unknown) => void
  changeRemote.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
  draw('remote')
  button('Fetch this remote').click(); button('Fetch').click()
  setNode('node-b'); setProject('project-b'); await tick()
  settle({ ok: true, roster: { remotes: [remote], lastFetch: {} }, postState: 'fresh' })
  await tick()
  expect(setQueryData).toHaveBeenCalledWith(['git-remotes', 'node-a', 'project-a'], { remotes: [remote], lastFetch: {} })
  expect(setQueryData).not.toHaveBeenCalledWith(['git-remotes', 'node-b', 'project-b'], expect.anything())
  expect(document.body.textContent).not.toContain('Fetched origin')
})

it('keeps an unavailable post-command observation out of the ref cache and reports its result', async () => {
  changeRef.mockResolvedValueOnce({ ok: true, reason: 'Git command completed. Post-state unavailable: readback failed',
    roster: { refs: [] }, postState: 'unavailable', command: { code: 0, error: null } })
  draw('ref')
  button('Create branch').click(); button('Save').click()
  await tick()
  expect(setQueryData).not.toHaveBeenCalled()
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['git-refs', 'node-a', 'project-a'] })
  expect(document.body.textContent).toContain('Post-state unavailable')
})

it('keeps an unavailable remote post-state out of the cache', async () => {
  changeRemote.mockResolvedValueOnce({ ok: false, reason: 'Post-state unavailable: readback failed',
    roster: { remotes: [remote], lastFetch: {} }, postState: 'unavailable', command: { code: 1, error: 'partial fetch' } })
  draw('remote')
  button('Fetch this remote').click(); button('Fetch').click()
  await tick()
  expect(setQueryData).not.toHaveBeenCalled()
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['git-remotes', 'node-a', 'project-a'] })
  expect(document.body.textContent).toContain('Post-state unavailable')
})
