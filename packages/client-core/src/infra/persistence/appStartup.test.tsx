import { QueryClient } from '@tanstack/solid-query'
import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import type { Project } from '../queries'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  pushBackgroundError: vi.fn(),
  savePref: vi.fn(),
}))
vi.mock('../../host/registries/commands/clientEvents', () => ({ clientEvents: { emit: mocks.emit } }))
vi.mock('../../features/notifications/notifications', () => ({ pushBackgroundError: mocks.pushBackgroundError }))
vi.mock('../../features/settings/savePref', () => ({ savePref: mocks.savePref }))

import { activeTaskId, selectedSource, setActiveTaskId, setSelectedSource } from '../../features/tasks/tasks'
import { createAppStartupRestore } from './appStartup'

const TASK = { id: 'task-1', projectId: 'project-1', title: 'A task' } as Task
const PROJECT = { id: 'project-1', name: 'A project' } as Project

// A whole boot, minus the parts a restore never reads. `path` stays on a project path so the
// last-path slice has nothing to correct.
const boot = (prefs: Record<string, string>): (() => void) => createRoot((dispose) => {
  createAppStartupRestore({
    queryClient: new QueryClient(),
    prefs: () => prefs,
    cacheRestoring: () => false,
    projects: () => [PROJECT],
    tasks: () => [TASK],
    path: () => '/p/project-1',
    navigate: () => {},
  })
  return dispose
})

// Reopening where the window was closed. `last_task` and `last_source` are one answer between them,
// and an empty source is the half that says "a task was on screen" (./appStartup.ts).
describe('launch view restore', () => {
  beforeEach(() => {
    // jsdom has no `matchMedia`, and the theme pass reads one to follow the system's light/dark.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.clearAllMocks()
    mocks.savePref.mockResolvedValue(true)
    setActiveTaskId(null)
    setSelectedSource(null)
  })
  afterEach(() => {
    setSelectedSource(null)
    vi.unstubAllGlobals()
  })

  it('reopens on the task that was on screen rather than on the default source', () => {
    const dispose = boot({ last_task: 'task-1', last_source: '' })

    expect(activeTaskId()).toBe('task-1')
    expect(selectedSource()).toBeNull()
    dispose()
  })

  it('reopens on a stored browse source', () => {
    const dispose = boot({ last_task: 'task-1', last_source: 'github' })

    expect(selectedSource()).toBe('github')
    dispose()
  })
})
