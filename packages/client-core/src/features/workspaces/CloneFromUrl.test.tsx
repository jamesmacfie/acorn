// @vitest-environment jsdom
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloneRun } from '@acorn/protocol/api.ts'
import { projectsKey } from '../../infra/queries'
import AddProjectControls from './AddProjectControls'

// Clone from URL as the add controls host it: the real importer registry, a fake Node.

const state = vi.hoisted(() => ({
  post: vi.fn<(url: string, body: unknown) => Promise<unknown>>(),
  read: vi.fn<(url: string, options: { signal?: AbortSignal }) => Promise<CloneRun>>(),
  setNode: (_id: string) => {},
}))
vi.mock('../../infra/node/apiClient', async (original) => ({
  ...(await original<typeof import('../../infra/node/apiClient')>()),
  postJson: state.post,
  readJson: state.read,
}))
vi.mock('./addProject', () => ({ canAddProjectFromFolder: () => false, pickNodeFolder: async () => null }))
vi.mock('../../infra/node/activeNode', async () => {
  const { createSignal } = await import('solid-js')
  const [node, setNode] = createSignal('node-a')
  state.setNode = setNode
  return { activeNodeId: node }
})

let host: HTMLElement
let dispose = () => {}
let opened: string[]
afterEach(() => {
  dispose()
  host?.remove()
  state.setNode('node-a')
  state.post.mockReset()
  state.read.mockReset()
})

function mount() {
  host = document.createElement('div')
  document.body.append(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(projectsKey, [{ id: 'cloned' }])
  opened = []
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <AddProjectControls beginAdd={() => (id) => opened.push(id)} />
      </QueryClientProvider>
    ),
    host,
  )
}

const button = (text: string) =>
  [...host.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === text)
const openForm = () => button('Clone from URL')!.click()
const field = (label: string) => {
  const caption = [...host.querySelectorAll('label')].find((entry) => entry.textContent?.trim() === label)
  return caption ? (document.getElementById(caption.htmlFor) as HTMLInputElement) : undefined
}
const type = (label: string, value: string) => {
  const input = field(label)!
  input.value = value
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
}
const submit = () =>
  host.querySelector('.project-importer form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

describe('Clone from URL', () => {
  it('names the folder after the URL until the name is edited', () => {
    mount()
    openForm()
    type('Git URL', 'https://github.com/acme/web.git')
    expect(field('Folder name')!.value).toBe('web')
    type('Folder name', 'mine')
    type('Git URL', 'git@github.com:acme/api.git')
    expect(field('Folder name')!.value).toBe('mine')
  })

  it("won't clone a URL the Node would refuse, and says why", () => {
    mount()
    openForm()
    type('Parent folder on this Node', '/src')
    type('Git URL', 'http://github.com/acme/web.git')
    expect(button('Clone')!.disabled).toBe(true)
    expect(host.textContent).toContain('not http')
    type('Git URL', 'https://github.com/acme/web.git')
    expect(button('Clone')!.disabled).toBe(false)
  })

  it('reports the project a finished clone made, and says it is untrusted', async () => {
    state.post.mockResolvedValue({ cloneId: 'c1', state: 'running' })
    state.read
      .mockResolvedValueOnce({ state: 'running', elapsedMs: 20_000 })
      .mockResolvedValueOnce({ state: 'finished', result: { ok: true, projectId: 'cloned' } })
    mount()
    openForm()
    type('Git URL', 'https://github.com/acme/web.git')
    type('Parent folder on this Node', '/src')
    submit()
    expect(state.post).toHaveBeenCalledWith('/v1/core/projects/clone-runs', {
      url: 'https://github.com/acme/web.git',
      parentDir: '/src',
      name: 'web',
    })
    await vi.waitFor(() => expect(opened).toEqual(['cloned']))
    expect(host.textContent).toContain("Cloned web. It's untrusted until you trust it in its settings.")
    expect(state.read.mock.calls[0]![0]).toBe('/v1/core/projects/clone-runs/c1?waitMs=20000')
  })

  it('keeps the fields and shows the Node’s message when the clone fails', async () => {
    state.post.mockResolvedValue({ cloneId: 'c1', state: 'running' })
    state.read.mockResolvedValue({ state: 'finished', result: { ok: false, error: 'Repository not found.' } })
    mount()
    openForm()
    type('Git URL', 'https://github.com/acme/web.git')
    type('Parent folder on this Node', '/src')
    submit()
    await vi.waitFor(() => expect(host.textContent).toContain('Repository not found.'))
    expect(field('Git URL')!.value).toBe('https://github.com/acme/web.git')
    expect(button('Clone')!.disabled).toBe(false)
  })

  it('stops following on a Node change, and forgets the parent typed for the old Node', async () => {
    state.post.mockResolvedValue({ cloneId: 'c1', state: 'running' })
    let signal: AbortSignal | undefined
    state.read.mockImplementation((_url, options) => {
      signal = options.signal
      return new Promise(() => {})
    })
    mount()
    openForm()
    type('Git URL', 'https://github.com/acme/web.git')
    type('Parent folder on this Node', '/src')
    submit()
    await vi.waitFor(() => expect(host.textContent).toContain('Cloning web…'))
    expect(field('Git URL')!.disabled).toBe(true)

    state.setNode('node-b')
    await vi.waitFor(() => expect(host.querySelector('.project-importer')).toBeNull())
    expect(signal?.aborted).toBe(true)
    openForm()
    expect(field('Parent folder on this Node')!.value).toBe('')

    state.setNode('node-a')
    openForm()
    expect(field('Parent folder on this Node')!.value).toBe('/src')
  })
})
