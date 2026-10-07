import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { integrationsKey, prefsKey, projectsKey, workspacesKey, type Project, type Workspace } from '@acorn/protocol/api.ts'
import type { WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'

const platform = vi.hoisted(() => ({
  pickFolder: vi.fn<() => Promise<string | null>>(),
  createProject: vi.fn(),
  patchProject: vi.fn(),
  createWorkspace: vi.fn(),
}))
vi.mock('@solidjs/router', async (original) => ({
  ...await original<typeof import('@solidjs/router')>(),
  useNavigate: () => vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...await original<typeof import('@acorn/plugin-api/client')>(),
  canAddProjectFromFolder: () => true,
  pickFolder: platform.pickFolder,
  createProject: platform.createProject,
  patchProject: platform.patchProject,
  createWorkspace: platform.createWorkspace,
}))

import OnboardingWizard from './OnboardingWizard'

const project = (id: string, workspaceId: string): Project => ({
  id, name: id, workspaceId, path: `/tmp/${id}`, sort: 0, hidden: false, color: null,
  vcs: null, defaultBranch: null, remoteUrl: null, github: null,
})
const workspace = (id: string): Workspace => ({
  id, name: id, isDefault: false, sort: 0, projects: [{ id, name: id, sort: 0 }],
})

let host: HTMLDivElement
let dispose: () => void
let client: QueryClient
let stored: Record<string, string>
let projects: Project[]
let pendingWrite: Promise<void> | undefined
let releaseWrite: (() => void) | undefined
let saveError: Error | undefined
const writes: { key: string; value: string }[] = []

const view = () => document.body
const button = (label: string) => [...view().querySelectorAll<HTMLButtonElement>('button')]
  .find((element) => element.textContent?.trim() === label)
const click = (label: string) => {
  const element = button(label)
  expect(element, `button ${label}`).toBeTruthy()
  element!.click()
}
const waitForText = async (value: string) => vi.waitFor(() => expect(view().textContent).toContain(value))

function mount(mode?: WorkspacesMode) {
  stored = mode ? { 'core.workspaces': mode } : {}
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(prefsKey, stored)
  client.setQueryData(projectsKey, projects)
  client.setQueryData(workspacesKey, [workspace('Alpha'), workspace('Beta')])
  client.setQueryData(integrationsKey, { providers: [], integrations: [] })
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <QueryClientProvider client={client}>
      <OnboardingWizard workspacesPreference={mode} onClose={() => {}} />
    </QueryClientProvider>
  ), host)
}

beforeEach(() => {
  projects = []
  writes.length = 0
  pendingWrite = undefined
  releaseWrite = undefined
  saveError = undefined
  vi.clearAllMocks()
  platform.pickFolder.mockResolvedValue('/tmp/Alpha')
  platform.createProject.mockImplementation(async ({ path }: { path: string }) => {
    const id = path.split('/').at(-1)!
    const created = project(id, id)
    projects = [...projects, created]
    client.setQueryData(projectsKey, projects)
    return { project: created }
  })
  platform.patchProject.mockResolvedValue(undefined)
  platform.createWorkspace.mockResolvedValue(workspace('New'))
  vi.stubGlobal('fetch', vi.fn(async (_path: string, options: RequestInit) => {
    const raw = ArrayBuffer.isView(options.body)
      ? new TextDecoder().decode(options.body as Uint8Array)
      : String(options.body)
    const body = JSON.parse(raw) as { key: string; value: string }
    writes.push(body)
    if (pendingWrite) await pendingWrite
    if (saveError) throw saveError
    stored[body.key] = body.value
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
})

afterEach(() => {
  dispose?.()
  host?.remove()
  client?.clear()
  vi.unstubAllGlobals()
})

describe('first-run workspace choice', () => {
  it.each([
    ['off', 'Keep each project separate'],
    ['on', 'Group projects into workspaces'],
  ] as const)('saves %s before entering Add a project', async (mode, label) => {
    mount()
    if (mode === 'on') click('Group projects into workspaces')
    expect(view().textContent).toContain(label)
    click('Get started')
    await waitForText('Add your first project')
    expect(writes).toEqual([{ key: 'core.workspaces', value: mode }])
    expect(stored['core.workspaces']).toBe(mode)
  })

  it('waits for a save and leaves an error visible for retry', async () => {
    mount()
    pendingWrite = new Promise<void>((resolve) => { releaseWrite = resolve })
    click('Get started')
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(view().textContent).not.toContain('Add your first project')
    expect(button('Get started')?.disabled).toBe(true)
    releaseWrite!()
    await waitForText('Add your first project')

    dispose()
    host.remove()
    pendingWrite = undefined
    releaseWrite = undefined
    mount()
    saveError = new Error('Preference unavailable')
    click('Get started')
    await waitForText('Preference unavailable')
    expect(view().textContent).not.toContain('Add your first project')
    saveError = undefined
    click('Get started')
    await waitForText('Add your first project')
  })

  it('skips without writing the workspace mode', async () => {
    mount()
    click('Skip setup')
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes).toEqual([{ key: 'onboarded', value: '1' }])
  })

  it.each(['off', 'on'] as const)('uses saved %s mode without offering a choice', async (mode) => {
    mount(mode)
    expect(view().querySelectorAll('[role="radio"]')).toHaveLength(0)
    click('Get started')
    await waitForText('Add your first project')
    expect(writes).toHaveLength(0)
  })

  it.each(['off', 'on'] as const)('names projects in %s mode with the right controls', async (mode) => {
    mount(mode)
    click('Get started')
    await waitForText('Add your first project')
    const folder = [...view().querySelectorAll<HTMLButtonElement>('button.ui-card')]
      .find((element) => element.textContent?.includes('Open a folder'))!
    folder.click()
    await waitForText('Name your project')
    const name = view().querySelector<HTMLInputElement>('input')!
    name.value = 'Renamed'
    name.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(view().textContent?.includes('New workspace')).toBe(mode === 'on')
    click('Continue')
    await waitForText('Generate with AI')
    expect(platform.patchProject).toHaveBeenCalledWith('Alpha', { name: 'Renamed' })
  })

  it('keeps grouped workspace selection and creation available', async () => {
    mount('on')
    click('Get started')
    await waitForText('Add your first project')
    const folder = [...view().querySelectorAll<HTMLButtonElement>('button.ui-card')]
      .find((element) => element.textContent?.includes('Open a folder'))!
    folder.click()
    await waitForText('Name your project')
    view().querySelector<HTMLButtonElement>('.ui-select')?.click()
    await vi.waitFor(() => expect(view().querySelector('[data-value="__new__"]')).toBeTruthy())
    view().querySelector<HTMLButtonElement>('[data-value="__new__"]')!.click()
    expect(view().textContent).toContain('New workspace')
    const input = view().querySelector<HTMLInputElement>('input[placeholder="Workspace name"]')!
    input.value = 'Team'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    click('Create')
    await vi.waitFor(() => expect(platform.createWorkspace).toHaveBeenCalledWith('Team'))
  })

  it('keeps the saved answer fixed after navigating back', async () => {
    mount()
    click('Get started')
    await waitForText('Add your first project')
    click('Back')
    expect(view().querySelectorAll('[role="radio"]')).toHaveLength(0)
    expect(view().textContent).toContain('stay separate')
    click('Get started')
    await waitForText('Add your first project')
    expect(writes).toHaveLength(1)
  })
})
