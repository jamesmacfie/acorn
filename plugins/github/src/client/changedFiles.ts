import { createQuery } from '@tanstack/solid-query'
import { useChangedFiles } from '@acorn/change-request-ui/views'
import { fileSummariesOptions } from './queries'

// A pull's changed files in the summaries query's order, and the `?file=` scroll target over them.
// The palette search, `[` and `]` cycling, and the file list all read this one order.
export function usePullChangedFiles(
  route: () => { owner: string; repo: string; number: string } | null,
  options: { router?: boolean } = {},
) {
  const query = createQuery(() => {
    const r = route()
    return fileSummariesOptions(r?.owner ?? '', r?.repo ?? '', r?.number ?? '', !!r)
  })
  return useChangedFiles(() => query.data?.files ?? [], options)
}
