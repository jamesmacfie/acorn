// The task ID is the authority; callers never choose ripgrep's working directory.
import type { CoreServices } from '@acorn/plugin-api/node'
import type { SearchBridge, SearchOpts } from './routes/search'
import type { SearchResult } from '../shared/search'
import { SearchFailure } from '../shared/search'
import { listFilteredPaths, runRipgrep } from './searchProcess'
import { stat } from 'node:fs/promises'
import { resolveInRoot } from '@acorn/plugin-api/node'
export { parseRgJson } from './searchResults'

export type SearchCoreServices = { tasks: Pick<CoreServices['tasks'], 'root'> }

export async function searchInFiles(core: SearchCoreServices, taskId: string, query: string, opts: SearchOpts, signal?: AbortSignal): Promise<SearchResult> {
  if (signal?.aborted) throw new SearchFailure('cancelled', 'Search was cancelled.')
  const patterns = [...(opts.include ?? []), ...(opts.exclude ?? [])]
  if ((opts.include?.length ?? 0) > 20 || (opts.exclude?.length ?? 0) > 20
    || patterns.some((pattern) => !pattern || pattern.length > 256)
    || patterns.reduce((bytes, pattern) => bytes + Buffer.byteLength(pattern), 0) > 4096
    || opts.include?.some((pattern) => pattern.startsWith('!')))
    throw new SearchFailure('invalid_filter', 'Search filters exceed limits or contain an include exclusion.')
  const root = await core.tasks.root(taskId)
  if (signal?.aborted) throw new SearchFailure('cancelled', 'Search was cancelled.')
  if (!root) throw new SearchFailure('unavailable_root', 'The task has no searchable worktree.')
  const folder = opts.folder ?? '.'
  const target = resolveInRoot(root, folder)
  if (!target) throw new SearchFailure('invalid_scope', 'The folder scope is outside this task.')
  try {
    if (!(await stat(target)).isDirectory()) throw new SearchFailure('invalid_scope', 'The folder scope is not a directory. Clear folder scope to search the task.')
  } catch (error) {
    if (error instanceof SearchFailure) throw error
    throw new SearchFailure('invalid_scope', 'The folder scope is unavailable. Clear folder scope to search the task.')
  }
  if (signal?.aborted) throw new SearchFailure('cancelled', 'Search was cancelled.')
  if (!query) return { files: [], truncated: false }
  const allowedPaths = opts.include?.length || opts.exclude?.length
    ? await listFilteredPaths(root, folder, opts.include ?? [], opts.exclude ?? [], signal) : undefined
  if (signal?.aborted) throw new SearchFailure('cancelled', 'Search was cancelled.')
  if (await core.tasks.root(taskId) !== root) throw new SearchFailure('unavailable_root', 'The task worktree changed during search.')
  const args = ['--json', '--no-config']
  if (!opts.regex) args.push('--fixed-strings')
  if (!opts.caseSensitive) args.push('--ignore-case')
  if (opts.wholeWord) args.push('--word-regexp')
  // The filename pass owns the final include/exclude set. Hand the same bounded globs
  // to the text pass too, so it does not scan large files that cannot contribute a hit.
  for (const pattern of opts.include ?? []) args.push('--glob', pattern)
  for (const pattern of opts.exclude ?? []) args.push('--glob', pattern.startsWith('!') ? pattern : `!${pattern}`)
  // Ripgrep still parses a regex when no filename survives the filters. Search closed stdin in
  // that case so an invalid expression remains an error without scanning excluded files.
  args.push('--', query, allowedPaths && !allowedPaths.size ? '-' : folder)
  const result = await runRipgrep(root, args, { signal, allowedPaths })
  if (await core.tasks.root(taskId) !== root) throw new SearchFailure('unavailable_root', 'The task worktree changed during search.')
  return result
}

export const searchBridge = (core: SearchCoreServices): SearchBridge => ({
  findInFiles: (taskId, query, opts, request) => searchInFiles(core, taskId, query, opts, request?.signal),
})
