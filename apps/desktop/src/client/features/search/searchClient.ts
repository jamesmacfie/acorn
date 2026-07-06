// Typed accessor for the preload's `window.acorn.search` bridge — project-wide find-in-files over
// the active task's worktree via ripgrep. Mirrors editorClient.ts.
import type { SearchOpts, SearchResult } from '../../../shared/search'

export type { FileHits, SearchHit, SearchOpts, SearchResult } from '../../../shared/search'

export type SearchApi = {
  findInFiles(taskId: string, query: string, opts: SearchOpts): Promise<SearchResult>
}

export const searchApi = (): SearchApi | null => window.acorn?.search ?? null
