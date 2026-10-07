import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  active: 'node-a' as string | null,
  navigated: [] as string[],
  selected: [] as (string | null)[],
  notices: [] as string[],
  noticeRows: [] as string[],
  settings: [] as string[],
  opened: [] as string[],
  claimed: true,
}))

vi.mock('../../../infra/node/activeNode', () => ({
  activeNodeId: () => state.active,
  setActiveNode: (id: string) => { state.active = id },
}))
vi.mock('../../../infra/node/fleet', () => ({
  homeNodeId: () => 'node-a',
  nodes: () => [{ nodeId: 'node-a' }, { nodeId: 'node-b' }],
}))
vi.mock('../../../features/notifications/toast', () => ({
  toast: (message: string) => state.notices.push(message),
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
  sourceIdForPath: (path: string) => path.includes('/pulls') ? 'pulls' : undefined,
  sourceRegistry: {
    get: (id: string) => id === 'pulls' ? { id } : undefined,
    entries: () => [{ id: 'plugin-source', projectSurfaceId: 'plugin-surface' }],
  },
}))
vi.mock('../panes/projectSurfaces', () => ({
  projectSurfaceRoutes: () => [{ id: 'plugin-surface', path: '/p/project/x/plugin/item' }],
}))
vi.mock('../panes/panes', () => ({
  paneContribution: (id: string) => id === 'linear' ? { id } : undefined,
}))
vi.mock('../panes/contentLinks', () => ({
  openInAppUrl: (url: string) => { state.opened.push(url); return state.claimed },
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
    openTask: (_id: string, path: string) => { state.navigated.push(path); state.selected.push(null); return true },
    hasProject: (id: string) => id === 'project' || id === 'project-b',
  }
  mounted.push(registerAddressHost(host))
}

beforeEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
  state.active = 'node-a'
  state.navigated = []
  state.selected = []
  state.notices = []
  state.noticeRows = []
  state.settings = []
  state.opened = []
  state.claimed = true
})

describe('opening an Acorn address', () => {
  it('routes tasks, project paths, settings, sources, and claimed outside URLs', async () => {
    mount('node-a')
    expect(await openLink('acorn://local/t/task?pane=linear&item=ENG-1')).toEqual({ kind: 'opened' })
    expect(state.navigated).toContain('/t/task?pane=linear&item=ENG-1')
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
    expect(state.notices).toEqual([])
  })

  it('reports refused, unpaired, missing, unclaimed, and new-task links without navigation', async () => {
    mount('node-a')
    for (const link of [
      'acorn://node-a/unknown',
      'acorn://unpaired/t/task',
      'acorn://node-a/p/missing',
      'acorn://node-a/source/missing',
      'acorn://node-a/new-task?url=https%3A%2F%2Fexample.com',
    ]) expect(await openLink(link)).toMatchObject({ kind: 'refused', link })
    state.claimed = false
    expect(await openLink('acorn://node-a/open?url=https%3A%2F%2Fexample.com')).toMatchObject({ kind: 'refused' })
    expect(state.navigated).toEqual([])
    expect(state.notices).toHaveLength(6)
    expect(state.noticeRows).toHaveLength(6)
  })
})
