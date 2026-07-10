import { describe, expect, it } from 'vitest'
import { editorOpen, openFiles } from '../features/editor/editorState'
import { editorViewState, rememberEditorViewState } from '../features/editor/editorViewState'
import { prFilterFor, setPrFilter } from '../features/pullList/filterState'
import { activeTerminal, rememberActiveTerminal } from '../features/terminal/sessions'
import {
  dispatchLayout,
  focusedPane,
  isTerminalMax,
  isTerminalOpen,
  layoutForTask,
  maximizedPane,
  recipeBrowserUrl,
  rememberWorkspaceView,
  setFocusedPane,
  setMaximizedPane,
  setRecipeBrowserUrl,
  setTerminalMax,
  setTerminalOpen,
  workspaceView,
} from '../features/tasks/tasks'
import { clientEvents, consumePaneIntent, openPane, requestTerminalFocusIntent, consumeTerminalFocusIntent } from '../registries/clientEvents'
import { activateScopedStateEviction } from './scopedEviction'
import { completeTaskArchive } from '../features/tasks/archiveLifecycle'

describe('scoped lifecycle eviction', () => {
  it('clears every task-owned keyed collection on archive', () => {
    const off = activateScopedStateEviction()
    const taskId = 'evict-task'
    dispatchLayout(taskId, { type: 'add', pane: 'editor' })
    setRecipeBrowserUrl(taskId, 'http://localhost:3000')
    setTerminalOpen(taskId, true)
    setTerminalMax(taskId, true)
    setFocusedPane(taskId, 'editor')
    setMaximizedPane(taskId, 'editor')
    editorOpen(taskId, 'src/a.ts', false)
    rememberActiveTerminal(taskId, 'session-1')
    openPane(taskId, 'editor', { kind: 'editor:reveal', path: 'src/a.ts', line: 1 })
    requestTerminalFocusIntent(taskId, 'session-1')

    completeTaskArchive(taskId, () => {
      // Mounted task surfaces publish their final cursor/scroll state during disposal. The archive
      // event must run after that final write so eviction remains final.
      rememberEditorViewState(taskId, 'src/a.ts', {} as never)
    })

    expect(layoutForTask(taskId)).toBeUndefined()
    expect(recipeBrowserUrl(taskId)).toBeUndefined()
    expect(isTerminalOpen(taskId)).toBe(false)
    expect(isTerminalMax(taskId)).toBe(false)
    expect(focusedPane(taskId)).toBeUndefined()
    expect(maximizedPane(taskId)).toBeUndefined()
    expect(openFiles(taskId)).toEqual([])
    expect(activeTerminal(taskId)).toBeUndefined()
    expect(consumePaneIntent(taskId, 'editor')).toBeUndefined()
    expect(consumeTerminalFocusIntent(taskId)).toBeUndefined()
    expect(editorViewState(taskId, 'src/a.ts')).toBeUndefined()
    off()
  })

  it('clears workspace view memory and filters on removal', () => {
    const off = activateScopedStateEviction()
    const workspaceId = 'evict-workspace'
    rememberWorkspaceView(workspaceId, { source: 'linear' })
    setPrFilter(workspaceId, { tab: 'closed', filter: 'mine' })
    clientEvents.emit('runtime:workspace-removed', { workspaceId })
    expect(workspaceView(workspaceId)).toBeUndefined()
    expect(prFilterFor(workspaceId)).toEqual({ tab: 'open', filter: '' })
    off()
  })
})
