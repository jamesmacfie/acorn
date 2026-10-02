import { QueryClient } from '@tanstack/solid-query'
import { createRoot, createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task, Workspace } from '@acorn/protocol/api.ts'
import type { Project } from '../queries'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  pushBackgroundError: vi.fn(),
  savePref: vi.fn(),
}))
vi.mock('../../host/registries/commands/clientEvents', () => ({ clientEvents: { emit: mocks.emit } }))
vi.mock('../../features/notifications/notifications', async (importOriginal) => ({
  ...await importOriginal<object>(),
  pushBackgroundError: mocks.pushBackgroundError,
}))
vi.mock('../../features/settings/savePref', () => ({ savePref: mocks.savePref }))

import { createAppStartupRestore } from './appStartup'
import { hydrateWorkspaceHistory, noteWorkspaceVisit, previousWorkspaceId, workspaceHistory } from '../../features/workspaces/lastWorkspace'

const TASK = { id: 'task-1', projectId: 'project-1', title: 'A task' } as Task
const PROJECT = { id: 'project-1', name: 'A project' } as Project
const WORKSPACE = { id: 'workspace-2', name: 'Two', isDefault: false, sort: 0, projects: [{ id: 'project-1', name: 'A project', sort: 0 }] } as Workspace

// A whole boot, minus the parts a restore never reads.
const boot = (prefs: Record<string, string>, workspaces: () => Workspace[] | undefined, contributionsReady = () => true) => createRoot((dispose) => ({
  dispose,
  ...createAppStartupRestore({
    queryClient: new QueryClient(),
    prefs: () => prefs,
    prefsSettled: () => true,
    cacheRestoring: () => false,
    contributionsReady,
    projects: () => [PROJECT],
    tasks: () => [TASK],
    workspaces,
  }),
}))

// Which workspace to reopen. App.tsx opens it once the pass is done, so this only has to hand the
// saved id over, and not before the workspaces it names are known.
describe('launch workspace restore', () => {
  beforeEach(() => {
    hydrateWorkspaceHistory({ recent: [] })
    // jsdom has no `matchMedia`, and the theme pass reads one to follow the system's light/dark.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.clearAllMocks()
    mocks.savePref.mockResolvedValue(true)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('holds workspace restoration until the host has registered its compiled contributions', () => {
    const [ready, setReady] = createSignal(false)
    const startup = boot({ last_workspace: 'workspace-2' }, () => [WORKSPACE], ready)
    expect(startup.restored()).toBe(false)
    expect(startup.lastWorkspaceId()).toBe('')
    expect(mocks.emit).not.toHaveBeenCalledWith('boot:restored', expect.anything())
    setReady(true)
    expect(startup.restored()).toBe(true)
    expect(startup.lastWorkspaceId()).toBe('workspace-2')
    startup.dispose()
  })

  it('hands over the saved workspace once the workspaces have loaded', () => {
    const [workspaces, setWorkspaces] = createSignal<Workspace[] | undefined>(undefined)
    const startup = boot({ last_workspace: 'workspace-2' }, workspaces)
    expect(startup.restored()).toBe(false)

    setWorkspaces([WORKSPACE])
    expect(startup.restored()).toBe(true)
    expect(startup.lastWorkspaceId()).toBe('workspace-2')
    startup.dispose()
  })

  it('restores the visit order before reopening the workspace', () => {
    const startup = boot({
      last_workspace: 'workspace-2',
      // The pair saved before the order was a list still reads.
      workspace_history: JSON.stringify({ current: 'workspace-2', previous: 'workspace-1' }),
    }, () => [WORKSPACE])

    expect(startup.restored()).toBe(true)
    expect(workspaceHistory()).toEqual({ recent: ['workspace-2', 'workspace-1'] })
    expect(previousWorkspaceId()).toBe('workspace-1')
    startup.dispose()
  })

  it('drops malformed shortcut history without losing workspace restore', () => {
    const startup = boot({ last_workspace: 'workspace-2', workspace_history: '{bad' }, () => [WORKSPACE])

    expect(startup.lastWorkspaceId()).toBe('workspace-2')
    expect(previousWorkspaceId()).toBe(null)
    startup.dispose()
  })

  it('saves the new order after a workspace switch', () => {
    vi.useFakeTimers()
    try {
      const startup = boot({
        last_workspace: 'workspace-2',
        workspace_history: JSON.stringify({ recent: ['workspace-2', 'workspace-1'] }),
      }, () => [WORKSPACE])

      noteWorkspaceVisit('workspace-1')
      vi.advanceTimersByTime(500)
      expect(mocks.savePref).toHaveBeenCalledWith(
        expect.any(QueryClient), 'workspace_history',
        JSON.stringify({ recent: ['workspace-1', 'workspace-2'] }),
        { surfaceFailure: true },
      )
      startup.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('launch workspace write', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.clearAllMocks()
    mocks.savePref.mockResolvedValue(true)
  })
  afterEach(() => vi.unstubAllGlobals())

  // A boot that dies before a workspace opens flushes its pending writes on the way down. What it
  // flushes must be the saved workspace, not the empty value of "nothing open yet".
  it('does not save an empty workspace before one has opened', () => {
    const startup = boot({ last_workspace: 'workspace-2' }, () => [WORKSPACE])
    startup.dispose()

    expect(mocks.savePref).not.toHaveBeenCalledWith(expect.anything(), 'last_workspace', '', expect.anything())
  })
})
