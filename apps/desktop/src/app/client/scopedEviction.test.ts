import { describe, expect, it } from 'vitest'
import { editorOpen, openFiles } from '@acorn/plugin-editor/client/editorState.ts'
import { editorTreeDirectoryOpen, setEditorTreeDirectoryOpen } from '@acorn/plugin-editor/client/editorTreeState.ts'
import { editorViewState, rememberEditorViewState } from '@acorn/plugin-editor/client/editorViewState.ts'
import { prFilterFor, setPrFilter } from '@acorn/plugin-github/client/pullList/filterState.ts'
import { rememberReviewDiffScroll, reviewDiffScroll } from '@acorn/plugin-github/client/reviewViewState.ts'
import { activeTerminal, rememberActiveTerminal, sessions } from '@acorn/client-core/tasks/agentSessions.ts'
import { managedAgentStore } from '@acorn/plugin-agents/client/managedStore.ts'
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
} from '@acorn/client-core/tasks/tasks.ts'
import { clientEvents, consumePaneIntent, openPane, requestTerminalFocusIntent, consumeTerminalFocusIntent } from '@acorn/client-core/registries/clientEvents.ts'
import { activateScopedStateEviction } from './scopedEviction'
import { completeTaskArchive } from '@acorn/client-core/tasks/archiveLifecycle.ts'

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
    setEditorTreeDirectoryOpen(taskId, 'src', true)
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
    expect(editorTreeDirectoryOpen(taskId, 'src')).toBe(false)
    expect(reviewDiffScroll(reviewScope)).toBeUndefined()
    expect(activeTerminal(taskId)).toBeUndefined()
    expect(consumePaneIntent(taskId, 'editor')).toBeUndefined()
    expect(consumeTerminalFocusIntent(taskId)).toBeUndefined()
    expect(editorViewState(taskId, 'src/a.ts')).toBeUndefined()
    off()
  })

  it('clears the live per-node rosters when the active node changes', () => {
    // The per-node QueryClient partition covers cached queries and nothing else. These three live in
    // module-level signals, so before this they carried node A's data into node B's shell — against ids
    // two nodes may hold in common by construction.
    const off = activateScopedStateEviction()
    rememberActiveTerminal('task-on-a', 'session-1')
    managedAgentStore.upsertSession({
      id: 'agent-1', taskId: 'task-on-a', provider: 'claude', title: 'On node A',
      state: 'idle', createdAt: 1, updatedAt: 1, archivedAt: null,
    } as never)
    expect(managedAgentStore.sessions()).toHaveLength(1)

    clientEvents.emit('runtime:node-switched', { from: 'node-a', to: 'node-b' })

    expect(managedAgentStore.sessions()).toEqual([])
    expect(activeTerminal('task-on-a')).toBeUndefined()
    expect(sessions()).toEqual([])
    off()
  })

  it('leaves the rosters alone when a node is merely removed', () => {
    // `runtime:node-removed` drops that node's cache; it must not also wipe the ACTIVE node's live
    // rosters, which is what a single shared handler would have done.
    const off = activateScopedStateEviction()
    rememberActiveTerminal('task-on-a', 'session-1')
    clientEvents.emit('runtime:node-removed', { nodeId: 'some-other-node' })
    expect(activeTerminal('task-on-a')).toBe('session-1')
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
