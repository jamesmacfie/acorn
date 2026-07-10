// Find-in-files over the active task's worktree via ripgrep. Was the `window.acorn.search` preload
// bridge; now a loopback HTTP route, so it works in a plain browser (dev:node) too — no
// desktop bridge required.
import { searchRoute } from '../../../../core/shared/api'
import { writeJson } from '../../../../core/client/apiClient'
import type { SearchOpts, SearchResult } from '../../shared/search'

export type { FileHits, SearchHit, SearchOpts, SearchResult } from '../../shared/search'

export function findInFiles(taskId: string, query: string, opts: SearchOpts): Promise<SearchResult> {
  return writeJson<SearchResult>(searchRoute(taskId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, opts }),
  })
}
