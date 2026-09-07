import { describe, expect, it } from 'vitest'
import { workspaceViewSlice } from '../../infra/persistence/stateSlices'
import {
  dispatchLayout,
  evictWorkspaceView,
  focusedPane,
  hydrateWorkspaceView,
  maximizedPane,
  rememberWorkspaceView,
  selectedSource,
  setFocusedPane,
  setMaximizedPane,
  setSelectedSource,
  toggleFocusedPaneMax,
  workspaceView,
} from './tasks'

describe('task pane session state', () => {
  it('drops focus when the focused pane is removed before maximize is toggled', () => {
    const taskId = 'tasks-test-close-focused-pane'
    dispatchLayout(taskId, { type: 'replace', layout: { panes: ['pr', 'editor'] } })
    setFocusedPane(taskId, 'editor')

    dispatchLayout(taskId, { type: 'close', pane: 'editor' })
    toggleFocusedPaneMax(taskId)

    expect(focusedPane(taskId)).toBeUndefined()
    expect(maximizedPane(taskId)).toBeUndefined()
  })

  it('defensively rejects stale focus not present in the current layout', () => {
    const taskId = 'tasks-test-stale-focused-pane'
    dispatchLayout(taskId, { type: 'replace', layout: { panes: ['pr'] } })
    setFocusedPane(taskId, 'editor')

    toggleFocusedPaneMax(taskId)

    expect(focusedPane(taskId)).toBeUndefined()
    expect(maximizedPane(taskId)).toBeUndefined()
  })

  it('clears maximize state when a layout replacement removes that pane', () => {
    const taskId = 'tasks-test-replace-maximized-pane'
    dispatchLayout(taskId, { type: 'replace', layout: { panes: ['pr', 'editor'] } })
    setMaximizedPane(taskId, 'editor')

    dispatchLayout(taskId, { type: 'replace', layout: { panes: ['pr'] } })

    expect(maximizedPane(taskId)).toBeUndefined()
  })

  it('retains an unknown persisted source id until the user selects a known source', () => {
    const previous = selectedSource()
    try {
      setSelectedSource('plugin.temporarily-missing')
      expect(selectedSource()).toBe('plugin.temporarily-missing')

      setSelectedSource('github')
      expect(selectedSource()).toBe('github')
    } finally {
      setSelectedSource(previous)
    }
  })
})

// The memory behind "switching workspaces returns me to what I was looking at", and behind reopening
// there after a restart: one store, one slice over it (../../infra/persistence/stateSlices.ts).
describe('per-workspace view memory', () => {
  it('remembers a view per workspace and forgets one workspace at a time', () => {
    rememberWorkspaceView('ws-a', { source: 'github' })
    rememberWorkspaceView('ws-b', { taskId: 'task-1' })

    expect(workspaceView('ws-a')).toEqual({ source: 'github' })
    expect(workspaceView('ws-b')).toEqual({ taskId: 'task-1' })

    evictWorkspaceView('ws-a')
    expect(workspaceView('ws-a')).toBeUndefined()
    expect(workspaceView('ws-b')).toEqual({ taskId: 'task-1' })
  })

  it('lets a view recorded this session win over the stored one', () => {
    rememberWorkspaceView('ws-live', { source: 'linear' })
    hydrateWorkspaceView('ws-live', { source: 'github' })

    expect(workspaceView('ws-live')).toEqual({ source: 'linear' })
  })

  it('declines to restore the empty view an unreadable stored value parses to', () => {
    hydrateWorkspaceView('ws-broken', workspaceViewSlice.codec.parse('{not-json'))

    expect(workspaceView('ws-broken')).toBeUndefined()
  })

  it('round-trips both shapes through the slice codec', () => {
    for (const view of [{ source: 'github' }, { taskId: 'task-2' }] as const) {
      expect(workspaceViewSlice.codec.parse(JSON.stringify(workspaceViewSlice.codec.serialize(view)))).toEqual(view)
    }
  })
})
