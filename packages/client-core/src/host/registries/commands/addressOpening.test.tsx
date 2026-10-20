import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  active: 'node-a' as string | null,
  navigated: [] as string[],
  projectPaths: [] as string[],
  selected: [] as (string | null)[],
  notices: [] as string[],
  toastActions: [] as Array<{ label: string; onPress: () => void }>,
  noticeRows: [] as string[],
  settings: [] as string[],
  opened: [] as string[],
  openedTask: null as unknown,
  claimed: true,
  claim: null as null | {
    target: Record<string, unknown>
    contribution: { providerId?: string; path?: () => string | null }
  },
  promotions: [] as unknown[],
  created: 0,
  loadedItems: 0,
  existingReads: 0,
  projectReads: 0,
  existing: false,
  projectsGate: null as Promise<void> | null,
  existingGate: null as Promise<void> | null,
  itemGate: null as Promise<void> | null,
}))

vi.mock('../../../infra/node/activeNode', () => ({
  activeNodeId: () => state.active,
  setActiveNode: (id: string) => {
    state.active = id
  },
}))
vi.mock('../../../infra/node/fleet', () => ({
  homeNodeId: () => 'node-a',
  nodes: () => [{ nodeId: 'node-a' }, { nodeId: 'node-b' }],
}))
vi.mock('../../../features/notifications/toast', () => ({
  toast: (message: string, options?: { action?: { label: string; onPress: () => void } }) => {
    state.notices.push(message)
    if (options?.action) state.toastActions.push(options.action)
  },
}))
vi.mock('../../../features/notifications/notifications', () => ({
  pushNotice: (notice: { detail: string }) => state.noticeRows.push(notice.detail),
}))
vi.mock('../../../features/tasks/tasks', () => ({
  setSelectedSource: (id: string | null) => state.selected.push(id),
}))
vi.mock('../sources/sources', () => ({
  defaultSourceId: () => 'home',
  matchRoute: (pattern: string, path: string) => pattern === path,
  sourceIdForPath: (path: string) => (path.includes('/pulls') ? 'pulls' : undefined),
  sourceRegistry: {
    get: (id: string) => (id === 'pulls' ? { id } : undefined),
    entries: () => [
      { id: 'plugin-source', projectSurfaceId: 'plugin-surface' },
      {
        id: 'source-github',
        providerId: 'github',
        promotion: {
          fromContentLink: async () => {
            state.loadedItems++
            await state.itemGate
            return { number: 42, title: 'Review changes', headRef: 'feature/pr' }
          },
          canPromote: () => true,
          existingTask: async () => {
            state.existingReads++
            await state.existingGate
            return state.existing ? { id: 'tracked-task' } : undefined
          },
          create: async () => {
            state.created++
            return { id: 'created-task' }
          },
        },
      },
    ],
  },
}))
vi.mock('../panes/projectSurfaces', () => ({
  projectSurfaceRoutes: () => [{ id: 'plugin-surface', path: '/p/project/x/plugin/item' }],
}))
vi.mock('../panes/panes', () => ({
  paneContribution: (id: string) => (id === 'linear' ? { id } : undefined),
}))
vi.mock('../panes/contentLinks', () => ({
  openInAppUrl: (url: string) => {
    state.opened.push(url)
    return state.claimed
  },
  claimFor: () => state.claim,
}))
vi.mock('./clientEvents', () => ({
  clientEvents: { emit: (_event: string, value: { tab: string }) => state.settings.push(value.tab) },
}))

import { openLink, registerAddressHost } from './addressOpening'

const mounted: Array<() => void> = []
function mount(nodeId: string) {
  const host = {
    nodeId,
    navigate: (path: string) => state.navigated.push(path),
    openProject: (path: string, source: string | null) => {
      state.projectPaths.push(path)
      state.selected.push(source)
      state.navigated.push(path)
    },
    openTask: (_id: string, path: string, task?: unknown) => {
      state.navigated.push(path)
      state.selected.push(null)
      state.openedTask = task
      return true
    },
    hasProject: (id: string) => id === 'project' || id === 'project-b',
    loadProjects: async () => {
      state.projectReads++
      await state.projectsGate
    },
    showPromotion: (details: unknown) => state.promotions.push(details),
  }
  mounted.push(registerAddressHost(host))
}

beforeEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  state.active = 'node-a'
  state.navigated = []
  state.projectPaths = []
  state.selected = []
  state.notices = []
  state.toastActions = []
  state.noticeRows = []
  state.settings = []
  state.opened = []
  state.openedTask = null
  state.claimed = true
  state.claim = null
  state.promotions = []
  state.created = 0
  state.loadedItems = 0
  state.existingReads = 0
  state.projectReads = 0
  state.existing = false
  state.projectsGate = null
  state.existingGate = null
  state.itemGate = null
})

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const claimPull = () => {
  state.claim = {
    target: { kind: 'pr', item: 'acme/repo#42' },
    contribution: { providerId: 'github', path: () => '/p/project/pulls/42' },
  }
}

describe('opening an Acorn address', () => {
  it('routes tasks, project paths, settings, sources, and claimed outside URLs', async () => {
    mount('node-a')
    expect(await openLink('acorn://local/t/task?pane=linear&item=ENG-1')).toEqual({ kind: 'opened' })
    expect(state.navigated).toContain('/t/task?pane=linear&item=ENG-1')
    expect(await openLink('acorn://local/t/task?pane=linear&item=ENG-1&at=7')).toEqual({ kind: 'opened' })
    expect(state.navigated).toContain('/t/task?pane=linear&item=ENG-1&at=7')
    expect(await openLink('acorn://local/t/task?pane=linear')).toEqual({ kind: 'opened' })
    expect(state.navigated).toContain('/t/task?pane=linear')
    expect(await openLink('acorn://node-a/p/project/pulls/42')).toEqual({ kind: 'opened' })
    expect(state.selected).toContain('pulls')
    expect(await openLink('acorn://node-a/settings/agents#general')).toEqual({ kind: 'opened' })
    expect(state.settings).toEqual(['settings/agents#general'])
    expect(await openLink('acorn://node-a/source/pulls')).toEqual({ kind: 'opened' })
    expect(await openLink('acorn://node-a/open?url=https%3A%2F%2Fexample.com')).toEqual({ kind: 'opened' })
    expect(state.opened).toEqual(['https://example.com'])
  })

  it('waits for the new Node shell before navigating', async () => {
    mount('node-a')
    const opening = openLink('acorn://node-b/t/task')
    expect(state.active).toBe('node-b')
    expect(state.navigated).toEqual([])
    mount('node-b')
    expect(await opening).toEqual({ kind: 'opened' })
    expect(state.navigated).toEqual(['/t/task'])
  })

  it('falls back to the project for an unavailable plugin path and reports it', async () => {
    mount('node-a')
    const link = 'acorn://node-a/p/project/x/missing/item'
    expect(await openLink(link)).toMatchObject({ kind: 'refused', link })
    expect(state.navigated).toEqual(['/p/project'])
    expect(state.notices[0]).toContain(link)
    expect(state.noticeRows[0]).toContain(link)
  })

  it('opens the task and reports a missing plugin pane', async () => {
    mount('node-a')
    expect(await openLink('acorn://node-a/t/task?pane=missing&item=one')).toMatchObject({ kind: 'refused' })
    expect(state.navigated).toEqual(['/t/task'])
    expect(state.noticeRows[0]).toContain('Pane is unavailable')
  })

  it('keeps a registered plugin path and lets the route select another workspace', async () => {
    mount('node-a')
    expect(await openLink('acorn://node-a/p/project/x/plugin/item')).toEqual({ kind: 'opened' })
    expect(state.selected).toContain('plugin-source')
    expect(await openLink('acorn://node-a/p/project-b')).toEqual({ kind: 'opened' })
    expect(state.navigated).toEqual(['/p/project/x/plugin/item', '/p/project-b'])
    expect(state.projectPaths).toEqual(['/p/project/x/plugin/item', '/p/project-b'])
    expect(state.notices).toEqual([])
  })

  it('marks core, compiled, and loaded project routes as explicit project navigation', async () => {
    mount('node-a')
    for (const link of [
      'acorn://node-a/p/project',
      'acorn://node-a/p/project/pulls/42',
      'acorn://node-a/p/project/x/plugin/item',
    ])
      expect(await openLink(link)).toEqual({ kind: 'opened' })
    expect(state.projectPaths).toEqual(['/p/project', '/p/project/pulls/42', '/p/project/x/plugin/item'])
  })

  it('reports refused, unpaired, missing, unclaimed, and new-task links without navigation', async () => {
    mount('node-a')
    for (const link of [
      'acorn://node-a/unknown',
      'acorn://unpaired/t/task',
      'acorn://node-a/p/missing',
      'acorn://node-a/source/missing',
      'acorn://node-a/new-task?url=https%3A%2F%2Fexample.com',
    ])
      expect(await openLink(link)).toMatchObject({ kind: 'refused', link })
    state.claimed = false
    expect(await openLink('acorn://node-a/open?url=https%3A%2F%2Fexample.com')).toMatchObject({ kind: 'refused' })
    expect(state.navigated).toEqual([])
    expect(state.notices).toHaveLength(6)
    expect(state.noticeRows).toHaveLength(6)
  })

  it('prepares a recognised item without writing until the dialog confirms', async () => {
    mount('node-a')
    state.claim = {
      target: { kind: 'pr', item: 'acme/repo#42' },
      contribution: { providerId: 'github', path: () => '/p/project/pulls/42' },
    }
    expect(await openLink('acorn://node-a/new-task?url=https%3A%2F%2Fexample.com')).toEqual({ kind: 'opened' })
    expect(state.projectPaths).toEqual(['/p/project'])
    expect(state.promotions).toEqual([
      {
        projectId: 'project',
        sourceId: 'source-github',
        item: { number: 42, title: 'Review changes', headRef: 'feature/pr' },
        itemTitle: 'Review changes',
      },
    ])
    expect(state.created).toBe(0)
    // Dismissing the request does not call the promotion's create method.
    state.promotions = []
    expect(state.created).toBe(0)
  })

  it('opens an active task without a dialog', async () => {
    mount('node-a')
    state.claim = { target: { kind: 'pr' }, contribution: { providerId: 'github', path: () => '/p/project/pulls/42' } }
    state.existing = true
    expect(await openLink('acorn://node-a/new-task?url=https%3A%2F%2Fexample.com')).toEqual({ kind: 'opened' })
    expect(state.navigated).toEqual(['/t/tracked-task'])
    expect(state.openedTask).toEqual({ id: 'tracked-task' })
    expect(state.promotions).toEqual([])
    expect(state.created).toBe(0)
    expect(state.loadedItems).toBe(0)
  })

  it('abandons pending new-task reads when the selected Node or registered host changes', async () => {
    const link = 'acorn://node-a/new-task?url=https%3A%2F%2Fexample.com'
    claimPull()
    mount('node-a')
    const projects = deferred()
    state.projectsGate = projects.promise
    const loadingProjects = openLink(link)
    await vi.waitFor(() => expect(state.projectReads).toBe(1))
    state.active = 'node-b'
    projects.release()
    await expect(loadingProjects).resolves.toMatchObject({ kind: 'refused' })
    expect(state.existingReads).toBe(0)

    state.active = 'node-a'
    state.projectsGate = null
    const existing = deferred()
    state.existingGate = existing.promise
    const loadingTask = openLink(link)
    await vi.waitFor(() => expect(state.existingReads).toBe(1))
    mounted.pop()?.()
    mount('node-a') // Same Node, new host: the old request must not navigate it.
    state.existing = true
    existing.release()
    await expect(loadingTask).resolves.toMatchObject({ kind: 'refused' })
    expect(state.loadedItems).toBe(0)

    state.existing = false
    state.existingGate = null
    const item = deferred()
    state.itemGate = item.promise
    const loadingItem = openLink(link)
    await vi.waitFor(() => expect(state.loadedItems).toBe(1))
    state.active = 'node-b'
    item.release()
    await expect(loadingItem).resolves.toMatchObject({ kind: 'refused' })
    expect(state.projectPaths).toEqual([])
    expect(state.navigated).toEqual([])
    expect(state.promotions).toEqual([])
    expect(state.notices).toEqual([])
  })

  it('distinguishes an untracked project and a claimed URL with no promotion', async () => {
    mount('node-a')
    state.claim = { target: { kind: 'pr' }, contribution: { providerId: 'github', path: () => null } }
    expect(await openLink('acorn://node-a/new-task?url=https%3A%2F%2Fexample.com')).toMatchObject({
      reason: 'Repository is not a project in Acorn',
    })
    expect(state.toastActions[0].label).toBe('Add project')
    state.toastActions[0].onPress()
    expect(state.settings).toEqual(['settings/workspaces#projects'])
    state.claim = { target: { kind: 'repo' }, contribution: { path: () => '/p/project' } }
    expect(await openLink('acorn://node-a/new-task?url=https%3A%2F%2Fexample.com')).toMatchObject({
      reason: 'Provider has no task promotion',
    })
    state.claim = { target: { kind: 'linear.issue', item: 'ENG-42' }, contribution: { providerId: 'linear' } }
    expect(await openLink('acorn://node-a/new-task?url=https%3A%2F%2Fexample.com')).toMatchObject({
      reason: 'Provider has no task promotion',
    })
    expect(state.promotions).toEqual([])
  })
})
