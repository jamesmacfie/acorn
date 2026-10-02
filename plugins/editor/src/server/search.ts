// The task ID is the authority; callers never choose ripgrep's working directory.
import type { CoreServices } from '@acorn/plugin-api/node'
import type { SearchBridge, SearchOpts } from './routes/search'
import type { SearchResult } from '../shared/search'
import { SearchFailure } from '../shared/search'
import { runRipgrep } from './searchProcess'
export { parseRgJson } from './searchResults'

export type SearchCoreServices = Pick<CoreServices, 'tasks'>

export async function searchInFiles(core: SearchCoreServices, taskId: string, query: string, opts: SearchOpts, signal?: AbortSignal): Promise<SearchResult> {
  if (signal?.aborted) throw new SearchFailure('cancelled', 'Search was cancelled.')
  const root = await core.tasks.root(taskId)
  if (signal?.aborted) throw new SearchFailure('cancelled', 'Search was cancelled.')
  if (!root) throw new SearchFailure('unavailable_root', 'The task has no searchable worktree.')
  if (!query) return { files: [], truncated: false }
  const args = ['--json', '--no-config']
  if (!opts.regex) args.push('--fixed-strings')
  if (!opts.caseSensitive) args.push('--ignore-case')
  if (opts.wholeWord) args.push('--word-regexp')
  args.push('--', query, '.')
  return runRipgrep(root, args, { signal })
}

export const searchBridge = (core: SearchCoreServices): SearchBridge => ({
  findInFiles: (taskId, query, opts, request) => searchInFiles(core, taskId, query, opts, request?.signal),
})
