import { describe, expect, it } from 'vitest'
import {
  dispatchLayout,
  focusedPane,
  maximizedPane,
  setFocusedPane,
  setMaximizedPane,
  selectedSource,
  setSelectedSource,
  toggleFocusedPaneMax,
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
