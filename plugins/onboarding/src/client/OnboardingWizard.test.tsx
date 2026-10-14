import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  integrationsKey,
  modelBackendsKey,
  prefsKey,
  projectsKey,
  workspacesKey,
  type Project,
  type Workspace,
} from '@acorn/protocol/api.ts'
import type { WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'
import { activeNodeId, setActiveNode } from '@acorn/plugin-api/client'

const platform = vi.hoisted(() => ({
  pickNodeFolder: vi.fn<() => Promise<string | null>>(),
  createProject: vi.fn(),
  patchProject: vi.fn(),
  createWorkspace: vi.fn(),
}))
const navigation = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@solidjs/router', async (original) => ({
  ...(await original<typeof import('@solidjs/router')>()),
  useNavigate: () => navigation.navigate,
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...(await original<typeof import('@acorn/plugin-api/client')>()),
  canAddProjectFromFolder: () => true,
  pickNodeFolder: platform.pickNodeFolder,
  createProject: platform.createProject,
  patchProject: platform.patchProject,
  createWorkspace: platform.createWorkspace,
}))

import OnboardingWizard from './OnboardingWizard'

const project = (id: string, workspaceId: string): Project => ({
  id,
  name: id,
  workspaceId,
  path: `/tmp/${id}`,
  sort: 0,
  hidden: false,
  color: null,
  vcs: null,
  defaultBranch: null,
  remoteUrl: null,
  github: null,
})
const workspace = (id: string): Workspace => ({
  id,
  name: id,
  isDefault: false,
  sort: 0,
  projects: [{ id, name: id, sort: 0 }],
})

let host: HTMLDivElement
let dispose: () => void
let client: QueryClient
let stored: Record<string, string>
let projects: Project[]
let pendingWrite: Promise<void> | undefined
let releaseWrite: (() => void) | undefined
let saveError: Error | undefined
let originalNodeId: string | null
const writes: { key: string; value: string }[] = []

const view = () => document.body
const button = (label: string) =>
  [...view().querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === label)
const click = (label: string) => {
  const element = button(label)
  expect(element, `button ${label}`).toBeTruthy()
  element!.click()
}
const waitForText = async (value: string) => vi.waitFor(() => expect(view().textContent).toContain(value))
// A layout option's button also holds its picture, so it is found by its radio role and label.
const radio = (label: string) =>
  [...view().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((element) =>
    element.textContent?.startsWith(label),
  )
const toLayout = async () => {
  click('Get started')
  await waitForText('Choose a layout')
}

function mount(mode?: WorkspacesMode, options: { unmountOnClose?: boolean } = {}) {
  stored = mode ? { 'core.workspaces': mode } : {}
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(prefsKey, stored)
  client.setQueryData(projectsKey, projects)
  client.setQueryData(workspacesKey, [workspace('Alpha'), workspace('Beta')])
  client.setQueryData(integrationsKey, { providers: [], integrations: [] })
  client.setQueryData(modelBackendsKey, { backends: [], missing: [] })
  host = document.createElement('div')
  document.body.append(host)
  const [open, setOpen] = createSignal(true)
  const [preference, setPreference] = createSignal(mode)
  const onClose = vi.fn(() => {
    if (options.unmountOnClose) setOpen(false)
  })
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Show when={open()}>
          <OnboardingWizard workspacesPreference={preference()} onClose={onClose} />
        </Show>
      </QueryClientProvider>
    ),
    host,
  )
  return { onClose, setPreference }
}

async function advanceToDone() {
  click('Get started')
  await waitForText('Add your first project')
  const folder = [...view().querySelectorAll<HTMLButtonElement>('button.ui-card')].find((element) =>
    element.textContent?.includes('Open a folder'),
  )!
  folder.click()
  await vi.waitFor(() => expect(view().querySelector('h2')?.textContent).toBe('Name your project'))
  click('Continue')
  await vi.waitFor(() => expect(view().querySelector('h2')?.textContent).toBe('Generate with AI'))
  click('Continue')
  await vi.waitFor(() => expect(view().querySelector('h2')?.textContent).toBe("You're set"))
}

beforeEach(() => {
  originalNodeId = activeNodeId()
  projects = []
  writes.length = 0
  pendingWrite = undefined
  releaseWrite = undefined
  saveError = undefined
  vi.clearAllMocks()
  platform.pickNodeFolder.mockResolvedValue('/tmp/Alpha')
  platform.createProject.mockImplementation(async ({ path }: { path: string }) => {
    const id = path.split('/').at(-1)!
    const created = project(id, id)
    projects = [...projects, created]
    client.setQueryData(projectsKey, projects)
    return { project: created }
  })
  platform.patchProject.mockResolvedValue(undefined)
  platform.createWorkspace.mockResolvedValue(workspace('New'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, options: RequestInit) => {
      const raw = ArrayBuffer.isView(options.body)
        ? new TextDecoder().decode(options.body as Uint8Array)
        : String(options.body)
      const body = JSON.parse(raw) as { key: string; value: string }
      writes.push(body)
      if (pendingWrite) await pendingWrite
      if (saveError) throw saveError
      stored[body.key] = body.value
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})

afterEach(() => {
  dispose?.()
  host?.remove()
  client?.clear()
  vi.unstubAllGlobals()
  setActiveNode(originalNodeId)
})

describe('first-run workspace choice', () => {
  it.each([
    ['off', 'Keep each project separate'],
    ['on', 'Group projects into workspaces'],
  ] as const)('saves %s before entering Add a project', async (mode, label) => {
    mount()
    await toLayout()
    expect(view().textContent).toContain(
      "You can group projects into workspaces later, but you can't separate them again.",
    )
    radio(label)!.click()
    expect(radio(label)?.getAttribute('aria-checked')).toBe('true')
    click('Continue')
    await waitForText('Add your first project')
    expect(writes).toEqual([{ key: 'core.workspaces', value: mode }])
    expect(stored['core.workspaces']).toBe(mode)
  })

  it('waits for a save and leaves an error visible for retry', async () => {
    mount()
    await toLayout()
    pendingWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    click('Continue')
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(view().textContent).not.toContain('Add your first project')
    expect(button('Continue')?.disabled).toBe(true)
    releaseWrite!()
    await waitForText('Add your first project')

    dispose()
    host.remove()
    pendingWrite = undefined
    releaseWrite = undefined
    mount()
    await toLayout()
    saveError = new Error('Preference unavailable')
    click('Continue')
    await waitForText('Preference unavailable')
    expect(view().textContent).not.toContain('Add your first project')
    saveError = undefined
    click('Continue')
    await waitForText('Add your first project')
  })

  it('skips without writing the workspace mode', async () => {
    const { onClose } = mount(undefined, { unmountOnClose: true })
    click('Skip setup')
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes).toEqual([{ key: 'onboarded', value: '1' }])
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(navigation.navigate).not.toHaveBeenCalled()
  })

  it.each(['off', 'on'] as const)('uses saved %s mode without offering a choice', async (mode) => {
    mount(mode)
    expect(view().textContent).not.toContain('Layout')
    click('Get started')
    await waitForText('Add your first project')
    expect(view().querySelectorAll('[role="radio"]')).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it.each(['off', 'on'] as const)('names projects in %s mode with the right controls', async (mode) => {
    mount(mode)
    click('Get started')
    await waitForText('Add your first project')
    const folder = [...view().querySelectorAll<HTMLButtonElement>('button.ui-card')].find((element) =>
      element.textContent?.includes('Open a folder'),
    )!
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
    const folder = [...view().querySelectorAll<HTMLButtonElement>('button.ui-card')].find((element) =>
      element.textContent?.includes('Open a folder'),
    )!
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

  it.each(['off', 'on'] as const)(
    'shows the saved %s answer and its one-way rule after navigating back',
    async (mode) => {
      const { setPreference } = mount()
      await toLayout()
      radio(mode === 'off' ? 'Keep each project separate' : 'Group projects into workspaces')!.click()
      click('Continue')
      await waitForText('Add your first project')
      click('Back')
      await waitForText(
        mode === 'off'
          ? 'Your projects stay separate. You can group them into workspaces later in Settings.'
          : "Your projects are grouped into workspaces. You can't switch back to separate projects.",
      )
      expect(view().querySelectorAll('[role="radio"]')).toHaveLength(0)
      if (mode === 'off') {
        setPreference('on')
        await waitForText("Your projects are grouped into workspaces. You can't switch back to separate projects.")
      }
      click('Continue')
      await waitForText('Add your first project')
      expect(writes).toHaveLength(1)
    },
  )

  it('opens the first project after Finish closes and unmounts the wizard', async () => {
    const { onClose } = mount('off', { unmountOnClose: true })
    await advanceToDone()
    click('Open acorn')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(view().querySelector('[role="dialog"]')).toBeNull()
    expect(writes).toEqual([{ key: 'onboarded', value: '1' }])
    expect(navigation.navigate).toHaveBeenCalledWith('/p/Alpha')
  })

  it('keeps Finish open after a failed completion save', async () => {
    const { onClose } = mount('off', { unmountOnClose: true })
    await advanceToDone()
    saveError = new Error('Preference unavailable')
    click('Open acorn')
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    await vi.waitFor(() => expect(button('Open acorn')?.disabled).toBe(false))
    expect(onClose).not.toHaveBeenCalled()
    expect(navigation.navigate).not.toHaveBeenCalled()
    expect(view().querySelector('[role="dialog"]')).toBeTruthy()
  })

  it.each(['node switch', 'disposal'] as const)('ignores a pending Finish after external %s', async (interruption) => {
    const { onClose } = mount('off', { unmountOnClose: true })
    await advanceToDone()
    pendingWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    click('Open acorn')
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    if (interruption === 'node switch') setActiveNode('another-node')
    else dispose()
    releaseWrite!()
    await vi.waitFor(() => expect(stored.onboarded).toBe('1'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onClose).not.toHaveBeenCalled()
    expect(navigation.navigate).not.toHaveBeenCalled()
  })
})
