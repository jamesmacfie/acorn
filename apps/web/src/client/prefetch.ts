// Background warm-up: after the open PR list loads, batch-fetch each PR's detail + files and seed
// the per-PR query caches so navigating through the list is instant. Open only — closed PRs stay
// on-demand. Best-effort: any failure just leaves that PR to load on first visit. Abortable, so a
// repo switch cancels the in-flight warm-up (the caller aborts on cleanup).
import type { QueryClient } from '@tanstack/solid-query'
import { filesKey, pullKey, pullsBatchRoute, type PullBatchItem } from '../shared/api'
import { pullsOptions } from './queries'

const CHUNK = 5 // PRs per batch request (one GitHub GraphQL round-trip server-side)
const CONCURRENCY = 2 // batch requests in flight at once

export async function prefetchOpenPulls(qc: QueryClient, owner: string, repo: string, signal: AbortSignal) {
  const list = await qc.ensureQueryData(pullsOptions(owner, repo, 'open', true))
  const chunks: number[][] = []
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK).map((p) => p.number))

  let next = 0
  const worker = async () => {
    while (next < chunks.length && !signal.aborted) {
      const numbers = chunks[next++]!
      try {
        const res = await fetch(pullsBatchRoute(owner, repo), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numbers }),
          signal,
        })
        if (!res.ok) continue
        const items = (await res.json()) as PullBatchItem[]
        // Seed both caches. PullDetail's own queries (staleTime 0) still revalidate on visit, so
        // this only makes the first paint instant — it doesn't suppress the on-visit refresh.
        for (const { number, detail, files } of items) {
          qc.setQueryData(pullKey(owner, repo, String(number)), detail)
          qc.setQueryData(filesKey(owner, repo, String(number)), files)
        }
      } catch {
        return // aborted or network error — stop this worker
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}
