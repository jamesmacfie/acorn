import { createSignal } from 'solid-js'
import { activeNodeId, clientEvents, onScopeEvicted, openPane } from '@acorn/plugin-api/client'
import type { SearchOpts, SearchResult } from '../../shared/search'
import { pathContains } from '../editorState'

export type SearchState = {
  query: string
  opts: SearchOpts
  results?: SearchResult
  error: string
  scopeChanged: boolean
  includeText: string
  excludeText: string
  scrollOffset: number
}

const empty = (): SearchState => ({
  query: '',
  opts: {},
  error: '',
  scopeChanged: false,
  includeText: '',
  excludeText: '',
  scrollOffset: 0,
})
const keyOf = (taskId: string, nodeId: string | null) => JSON.stringify([nodeId, taskId])
const [states, setStates] = createSignal<ReadonlyMap<string, SearchState>>(new Map())

export const taskSearchState = (taskId: string, nodeId = activeNodeId()): SearchState =>
  states().get(keyOf(taskId, nodeId)) ?? empty()

export function updateTaskSearchState(
  taskId: string,
  change: (state: SearchState) => SearchState,
  nodeId = activeNodeId(),
): void {
  setStates((current) => {
    const next = new Map(current)
    const key = keyOf(taskId, nodeId)
    next.set(key, change(current.get(key) ?? empty()))
    return next
  })
}

export function findInFolder(taskId: string, folder: string, nodeId = activeNodeId()): void {
  if (nodeId !== activeNodeId()) return
  updateTaskSearchState(
    taskId,
    (state) => ({
      ...state,
      opts: { ...state.opts, folder: folder || undefined },
      results: undefined,
      error: '',
      scopeChanged: false,
    }),
    nodeId,
  )
  openPane(taskId, 'editor', { kind: 'editor:search' }, 'add')
}

export function searchScopePathChanged(taskId: string, path: string, nodeId = activeNodeId()): void {
  updateTaskSearchState(
    taskId,
    (state) =>
      state.opts.folder && pathContains(path, state.opts.folder)
        ? {
            ...state,
            scopeChanged: true,
            results: undefined,
            error: 'The folder scope changed. Clear folder scope to search the task.',
          }
        : state,
    nodeId,
  )
}

const evict = (taskId: string, nodeId: string | null) => {
  setStates((current) => {
    const next = new Map(current)
    next.delete(keyOf(taskId, nodeId))
    return next
  })
}
onScopeEvicted((event) => {
  if (event.scope === 'task') evict(event.taskId, activeNodeId())
})
clientEvents.on('runtime:task-archived', ({ taskId }) => evict(taskId, activeNodeId()))
clientEvents.on('runtime:node-removed', ({ nodeId }) => {
  setStates((current) => new Map([...current].filter(([key]) => JSON.parse(key)[0] !== nodeId)))
})
