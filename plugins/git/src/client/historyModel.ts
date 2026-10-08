import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, clientEvents, wsOnNodeEvent, wsOnReconnect } from '@acorn/plugin-api/client'
import type { Commit, HistoryFilter, HistoryPage } from '../shared/api'
import { historyKey, historyOptions } from './historyClient'

export function createHistoryModel(projectId: Accessor<string>, initialRef: Accessor<string | null>) {
  const client = useQueryClient()
  const [ref, setRef] = createSignal<string | null>(initialRef())
  const [field, setField] = createSignal<HistoryFilter['field']>('message')
  const [query, setQuery] = createSignal('')
  const filter = createMemo<HistoryFilter>(() => ({ ref: ref(), field: field(), query: query().trim() }))
  const first = createQuery(() => historyOptions(projectId(), filter()))
  const [extra, setExtra] = createSignal<HistoryPage[]>([])
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [moreError, setMoreError] = createSignal('')
  const pages = createMemo(() => extra().length ? extra() : first.data ? [first.data] : [])
  const commits = createMemo<Commit[]>(() => pages().flatMap((page) => page.commits))
  const next = () => pages().at(-1)?.nextCursor ?? null
  let request: AbortController | undefined
  let generation = 0
  const scope = createMemo(() => `${activeNodeId()}:${projectId()}:${JSON.stringify(filter())}`)
  createEffect(on(scope, () => {
    generation++
    request?.abort()
    setExtra([]); setMoreError(''); setLoadingMore(false)
  }))
  const refresh = () => { generation++; request?.abort(); setExtra([]); void client.invalidateQueries({ queryKey: historyKey(projectId(), filter()) }) }
  const off = [wsOnNodeEvent('worktree:status-changed', refresh), wsOnReconnect(refresh), clientEvents.on('tasks:changed', refresh)]
  onCleanup(() => { generation++; request?.abort(); off.forEach((dispose) => dispose()) })
  const loadMore = async () => {
    const cursor = next()
    if (!cursor || loadingMore()) return
    const serial = generation
    request = new AbortController()
    setLoadingMore(true); setMoreError('')
    try {
      const page = await historyOptions(projectId(), filter(), cursor).queryFn({ signal: request.signal })
      if (serial === generation) setExtra((previous) => [...(previous.length ? previous : first.data ? [first.data] : []), page].slice(-10))
    } catch (error) {
      if (serial === generation) setMoreError(error instanceof Error ? error.message : String(error))
    } finally { if (serial === generation) setLoadingMore(false) }
  }
  return { ref, setRef, field, setField, query, setQuery, filter, first, pages, commits, next, loadMore, loadingMore, moreError, refresh }
}
export type HistoryModel = ReturnType<typeof createHistoryModel>
