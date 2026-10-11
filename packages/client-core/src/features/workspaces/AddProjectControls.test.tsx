// @vitest-environment jsdom
import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { createQuery, QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectsKey } from '../../infra/queries'
import { projectPath } from '../../host/registries/commands/corePaths'
import { noProjectsScreenVisible } from './noProjectsGate'
import { createProjectAddNavigation } from './projectAddNavigation'
import NoProjects from './NoProjects'

type ProjectRow = { id: string }
const state = vi.hoisted(() => ({
  serverProjects: [] as ProjectRow[],
  create: vi.fn<(_seed: { path: string }) => Promise<{ project: ProjectRow }>>(),
  imported: undefined as undefined | ((ids?: readonly string[]) => void),
  activeNode: (): string => 'node-a',
  setNode: (_id: string) => {},
}))
vi.mock('./workspaceMutations', () => ({ createProject: state.create }))
vi.mock('./addProject', () => ({ canAddProjectFromFolder: () => false }))
vi.mock('../../infra/platform', async (original) => ({
  ...(await original<typeof import('../../infra/platform')>()),
  canPickFolder: () => true,
}))
vi.mock('../../infra/node/activeNode', async () => {
  const { createSignal } = await import('solid-js')
  const [node, setNode] = createSignal('node-a')
  state.activeNode = node
  state.setNode = setNode
  return { activeNodeId: node }
})
vi.mock('../../host/registries/sources/projectImporters', () => ({
  projectImporterContributions: () => [
    {
      id: 'remote-safe',
      label: 'Remote importer',
      glyph: 'plus',
      component: (props: { onImported: (ids?: readonly string[]) => void }) => {
        state.imported = props.onImported
        return <div>Importer open</div>
      },
    },
  ],
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let host: HTMLElement
let client: QueryClient
let dispose = () => {}
let routes: string[]
let source: string | null
let setPathname: (path: string) => void
afterEach(() => {
  dispose()
  host?.remove()
  client?.clear()
  state.setNode('node-a')
  state.serverProjects = []
  state.imported = undefined
  state.create.mockReset()
})

async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(projectsKey, [])
  routes = []
  source = null
  const [pathname, changePathname] = createSignal('/old-project')
  setPathname = changePathname

  function Shell() {
    const projects = createQuery(() => ({ queryKey: projectsKey, queryFn: async () => state.serverProjects }))
    const beginAdd = createProjectAddNavigation({
      nodeId: state.activeNode,
      pathname,
      settingsOpen: () => false,
      openProject: (id) => {
        source = 'home'
        routes.push(projectPath(id))
      },
    })
    return (
      <>
        <Show
          when={noProjectsScreenVisible({
            projectCount: projects.data?.length,
            projectsError: projects.isError,
            wizardVisible: false,
          })}
        >
          <NoProjects beginAdd={beginAdd} />
        </Show>
        <Show when={projects.data?.length}>
          <div data-testid="project-view">Project loaded</div>
        </Show>
      </>
    )
  }

  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Shell />
      </QueryClientProvider>
    ),
    host,
  )
  await vi.waitFor(() => expect(host.querySelector('form.project-add-path')).not.toBeNull())
}

function submitPath(path: string) {
  const input = host.querySelector<HTMLInputElement>('input')!
  input.value = path
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

function openImporter() {
  const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent?.includes('Remote importer'))!
  button.click()
  expect(state.imported).toBeTypeOf('function')
}

describe('empty screen add lifecycle with a real query client', () => {
  it('opens the returned folder project after refetch replaces the empty screen', async () => {
    const pending = deferred<{ project: ProjectRow }>()
    state.create.mockReturnValue(pending.promise)
    await mount()
    submitPath('/node/folder')
    expect(state.create).toHaveBeenCalledWith({ path: '/node/folder' })
    state.serverProjects = [{ id: 'returned' }]
    pending.resolve({ project: { id: 'returned' } })
    await vi.waitFor(() => expect(host.querySelector('[data-testid="project-view"]')).not.toBeNull())
    await vi.waitFor(() => expect(routes).toEqual([projectPath('returned')]))
    expect(source).toBe('home')
  })

  it('opens the returned folder project when an event removes the screen before POST resolves', async () => {
    const pending = deferred<{ project: ProjectRow }>()
    state.create.mockReturnValue(pending.promise)
    await mount()
    submitPath('/node/folder')
    state.serverProjects = [{ id: 'event-project' }]
    client.setQueryData(projectsKey, state.serverProjects)
    await vi.waitFor(() => expect(host.querySelector('form.project-add-path')).toBeNull())
    pending.resolve({ project: { id: 'event-project' } })
    await vi.waitFor(() => expect(routes).toEqual([projectPath('event-project')]))
  })

  it('keeps a remote-safe importer and opens an actual reported project after plugin refetch', async () => {
    await mount()
    expect(host.textContent).toContain('Remote importer')
    openImporter()
    state.serverProjects = [{ id: 'actual' }]
    await client.invalidateQueries({ queryKey: projectsKey })
    await vi.waitFor(() => expect(host.querySelector('form.project-add-path')).toBeNull())
    state.imported?.(['missing', 'actual'])
    await vi.waitFor(() => expect(routes).toEqual([projectPath('actual')]))
  })

  it('ignores a folder completion after switching Nodes', async () => {
    const pending = deferred<{ project: ProjectRow }>()
    state.create.mockReturnValue(pending.promise)
    await mount()
    submitPath('/node/folder')
    state.setNode('node-b')
    pending.resolve({ project: { id: 'old-node-project' } })
    await vi.waitFor(() => expect(state.create).toHaveBeenCalledOnce())
    await new Promise((done) => setTimeout(done, 0))
    expect(routes).toEqual([])
  })

  it('ignores an importer completion after switching Nodes', async () => {
    await mount()
    openImporter()
    state.setNode('node-b')
    state.serverProjects = [{ id: 'old-node-project' }]
    client.setQueryData(projectsKey, state.serverProjects)
    await vi.waitFor(() => expect(host.querySelector('form.project-add-path')).toBeNull())
    state.imported?.(['old-node-project'])
    await new Promise((done) => setTimeout(done, 0))
    expect(routes).toEqual([])
  })

  it('ignores an importer completion after unrelated navigation', async () => {
    await mount()
    openImporter()
    setPathname('/elsewhere')
    state.serverProjects = [{ id: 'actual' }]
    client.setQueryData(projectsKey, state.serverProjects)
    await vi.waitFor(() => expect(host.querySelector('form.project-add-path')).toBeNull())
    state.imported?.(['actual'])
    await new Promise((done) => setTimeout(done, 0))
    expect(routes).toEqual([])
  })
})
