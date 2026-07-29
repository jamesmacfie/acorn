import { describe, expect, it } from 'vitest'
import { editorOpen, openFiles } from '../../plugins/editor/client/editorState'
import { editorViewState, rememberEditorViewState } from '../../plugins/editor/client/editorViewState'
import { prFilterFor, setPrFilter } from '../../plugins/github/client/pullList/filterState'
import { rememberReviewDiffScroll, reviewDiffScroll } from '../../plugins/github/client/reviewViewState'
import { activeTerminal, rememberActiveTerminal } from '../../core/client/tasks/agentSessions'
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
} from '../../core/client/tasks/tasks'
import { clientEvents, consumePaneIntent, openPane, requestTerminalFocusIntent, consumeTerminalFocusIntent } from '../../core/client/registries/clientEvents'
import { activateScopedStateEviction } from './scopedEviction'
import { completeTaskArchive } from '../../core/client/tasks/archiveLifecycle'

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
    const reviewScope = { taskId, routeKey: 'oak/acorn#42' }
    rememberReviewDiffScroll(reviewScope, {
      top: 4_800,
      left: 0,
      viewMode: 'unified',
      filesSignature: 'src/a.ts:sha',
    })
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
    expect(reviewDiffScroll(reviewScope)).toBeUndefined()
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
