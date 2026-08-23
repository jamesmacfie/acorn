// Find-in-files over the active task's worktree through ripgrep. A loopback HTTP route, so it works
// in a plain browser under dev:node with no desktop bridge.
import { searchRoute } from '../../contract/api'
import { writeJson } from '@acorn/plugin-api/client'
import type { SearchOpts, SearchResult } from '../../shared/search'

export type { FileHits, SearchHit, SearchOpts, SearchResult } from '../../shared/search'

export function findInFiles(taskId: string, query: string, opts: SearchOpts): Promise<SearchResult> {
  return writeJson<SearchResult>(searchRoute(taskId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, opts }),
  })
}
