import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, clientEvents, wsOnNodeEvent, wsOnReconnect } from '@acorn/plugin-api/client'
import type { Commit, HistoryFilter, HistoryPage } from '../shared/api'
import { historyKey, historyOptions } from './historyClient'
import { createGitViewSignal } from './viewState'

export function createHistoryModel(projectId: Accessor<string>, initialRef: Accessor<string | null>, owner: Accessor<string | null> = () => null) {
  const client = useQueryClient()
  const state = <T,>(name: string, initial: Accessor<T>) => createGitViewSignal(projectId, () => `history:${initialRef()}:${name}`, initial, owner)
  const [ref, setRef] = state<string | null>('ref', initialRef)
  const [field, setField] = state<HistoryFilter['field']>('field', () => 'message')
  const [query, setQuery] = state('query', () => '')
  const filter = createMemo<HistoryFilter>(() => ({ ref: ref(), field: field(), query: query().trim() }))
  const first = createQuery(() => historyOptions(projectId(), filter()))
  const pageKey = () => `history:${initialRef()}:pages:${JSON.stringify(filter())}`
  const [extra, setExtra] = createGitViewSignal<HistoryPage[]>(projectId, pageKey, () => [], owner)
  const [dropped, setDropped] = createGitViewSignal(projectId, () => `${pageKey()}:dropped`, () => false, owner)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [moreError, setMoreError] = createSignal('')
  const pages = createMemo(() => extra().length ? extra() : first.data ? [first.data] : [])
  const commits = createMemo<Commit[]>(() => pages().flatMap((page) => page.commits))
  const next = () => pages().at(-1)?.nextCursor ?? null
  let request: AbortController | undefined
  let generation = 0
  const ownerScope = createMemo(() => JSON.stringify([activeNodeId(), projectId(), owner(), initialRef()]))
  const scope = createMemo(() => `${ownerScope()}:${JSON.stringify(filter())}`)
  createEffect(on(scope, () => {
    generation++
    request?.abort()
    setMoreError(''); setLoadingMore(false)
  }))
  createEffect(() => {
    const firstPage = first.data
    const retained = extra()
    if (firstPage && retained.length && retained[0]!.observation !== firstPage.observation) { setExtra([]); setDropped(false) }
  })
  const refresh = () => {
    generation++
    request?.abort()
    setExtra([]); setDropped(false); setMoreError(''); setLoadingMore(false)
    void client.invalidateQueries({ queryKey: historyKey(projectId(), filter()) })
  }
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
      if (serial === generation) setExtra((previous) => {
        const all = [...(previous.length ? previous : first.data ? [first.data] : []), page]
        if (all.length > 10) setDropped(true)
        return all.slice(-10)
      })
    } catch (error) {
      if (serial === generation) setMoreError(error instanceof Error ? error.message : String(error))
    } finally { if (serial === generation) setLoadingMore(false) }
  }
  const viewKey = () => JSON.stringify([activeNodeId(), projectId(), owner(), filter()])
  return { viewKey, ref, setRef, field, setField, query, setQuery, filter, first, pages, commits, next, dropped, loadMore, loadingMore, moreError, refresh }
}
export type HistoryModel = ReturnType<typeof createHistoryModel>
