// Background warm-up: after the open PR list loads, batch-fetch each PR's detail + file summaries
// and seed the per-PR query caches so navigating through the list has an instant first paint.
// Patch bodies stay intent-driven in DiffView; warming them here makes the browser parse and
// persist data for PRs the user may never open. Open only — closed PRs stay on-demand.
// Best-effort: any failure just leaves that PR to load on first visit. Abortable, so a repo switch
// cancels the in-flight warm-up (the caller aborts on cleanup).
import type { QueryClient } from '@tanstack/solid-query'
import { fileSummariesKey, pullKey, pullsBatchRoute, type PullBatchItem, type PullBatchRequest } from '../../../core/shared/api'
import { pullsOptions } from '../../../core/client/queries'

const CHUNK = 5 // PRs per batch request (one GitHub GraphQL round-trip server-side)
const CONCURRENCY = 2 // batch requests in flight at once
const ROW_PREFETCH_DELAY_MS = 80
const activeWarmups = new Map<string, Promise<void>>()
const activeRowWarmups = new Map<string, Promise<void>>()

export async function prefetchOpenPulls(qc: QueryClient, owner: string, repo: string, signal: AbortSignal) {
  const warmupKey = `${owner}/${repo}`
  const active = activeWarmups.get(warmupKey)
  if (active) return active

  const run = prefetchOpenPullsOnce(qc, owner, repo, signal)
  activeWarmups.set(warmupKey, run)
  try {
    await run
  } finally {
    if (activeWarmups.get(warmupKey) === run) activeWarmups.delete(warmupKey)
  }
}

async function prefetchOpenPullsOnce(qc: QueryClient, owner: string, repo: string, signal: AbortSignal) {
  const list = await qc.ensureQueryData(pullsOptions(owner, repo, 'open', true))
  if (!list) return
  const chunks: number[][] = []
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK).map((p) => p.number))

  let next = 0
  const worker = async () => {
    while (next < chunks.length && !signal.aborted) {
      const numbers = chunks[next++]!
      try {
        await fetchPullSummaries(qc, owner, repo, numbers, signal)
      } catch {
        return // aborted or network error — stop this worker
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

export function schedulePullSummaryPrefetch(
  qc: QueryClient,
  owner: string,
  repo: string,
  number: number,
): { cancel: () => void } {
  const controller = new AbortController()
  const timer = window.setTimeout(() => {
    void prefetchPullSummary(qc, owner, repo, number, controller.signal).catch(() => {})
  }, ROW_PREFETCH_DELAY_MS)
  return {
    cancel: () => {
      window.clearTimeout(timer)
      controller.abort()
    },
  }
}

export async function prefetchPullSummary(
  qc: QueryClient,
  owner: string,
  repo: string,
  number: number,
  signal: AbortSignal,
) {
  const detailKey = pullKey(owner, repo, String(number))
  const summaryKey = fileSummariesKey(owner, repo, String(number))
  if (qc.getQueryData(detailKey) && qc.getQueryData(summaryKey)) return

  const warmupKey = `${owner}/${repo}#${number}`
  const active = activeRowWarmups.get(warmupKey)
  if (active) return active

  const run = fetchPullSummaries(qc, owner, repo, [number], signal)
  activeRowWarmups.set(warmupKey, run)
  try {
    await run
  } finally {
    if (activeRowWarmups.get(warmupKey) === run) activeRowWarmups.delete(warmupKey)
  }
}

async function fetchPullSummaries(
  qc: QueryClient,
  owner: string,
  repo: string,
  numbers: number[],
  signal: AbortSignal,
) {
  const requestStartedAt = Date.now()
  const res = await fetch(pullsBatchRoute(owner, repo), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numbers, files: 'summary' } satisfies PullBatchRequest),
    signal,
  })
  if (!res.ok) return
  const items = (await res.json()) as PullBatchItem[]
  // Seed summary-level caches. PullDetail's own queries (staleTime 0) still revalidate on
  // visit, so this only makes first paint instant — it doesn't suppress on-visit refresh.
  for (const { number, detail, files } of items) {
    seedIfNotNewer(qc, pullKey(owner, repo, String(number)), detail, requestStartedAt)
    seedIfNotNewer(qc, fileSummariesKey(owner, repo, String(number)), files, requestStartedAt)
  }
}

function seedIfNotNewer<T>(
  qc: QueryClient,
  queryKey: readonly unknown[],
  data: T,
  requestStartedAt: number,
) {
  const state = qc.getQueryState(queryKey)
  if ((state?.dataUpdatedAt ?? 0) > requestStartedAt) return
  qc.setQueryData(queryKey, data)
}
