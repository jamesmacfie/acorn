import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { extname, sep } from 'node:path'
import {
  createDataSelectionPager,
  createDataSourceHandler,
  selectDataRecords,
  type CoreServices,
  type PluginFetchHandler,
} from '@acorn/plugin-api/node'
import type { DataSourcePage, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import { codeMatchSourceDescription, MATCH_TEXT_CHARS } from '../shared/codeMatchSource'
import { EDITOR_FILE_TARGET, fileTargetItem } from '../shared/fileTarget'
import { runRipgrep } from './searchProcess'

type Core = Pick<CoreServices, 'projects' | 'tasks'>
type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type Project = { id: string; name: string; path: string }
type Parameters = { pattern: string; regex?: boolean; glob?: string; caseSensitive?: boolean }

const TIMEOUT_MS = 30_000

/** The project folders a scope reaches: a workspace's, or one project. A query naming neither fails,
 *  so the source never searches every folder on the Node. Folders missing from disk are left out,
 *  because ripgrep fails a whole search over one missing path. */
async function scopeProjects(core: Core, scope: QueryInput['query']['scope']): Promise<Project[]> {
  const projects = scope.workspaceId
    ? (await core.projects.byWorkspace(scope.workspaceId)).filter(
        (project) => !scope.projectId || project.id === scope.projectId,
      )
    : scope.projectId
      ? [await core.projects.byId(scope.projectId)]
      : null
  if (!projects) throw new Error('code_matches_scope_required')
  const withFolders = projects.flatMap((project) =>
    project?.path ? [{ id: project.id, name: project.name, path: project.path }] : [],
  )
  const present = await Promise.all(
    withFolders.map((project) =>
      stat(project.path).then(
        (entry) => entry.isDirectory(),
        () => false,
      ),
    ),
  )
  return withFolders.filter((_project, index) => present[index])
}

/** Every match across the projects, newest-modified file first, up to the host's record budget. */
async function readMatches(core: Core, input: QueryInput, signal: AbortSignal): Promise<DataSourcePage> {
  const { pattern, regex, glob, caseSensitive } = input.query.scope.parameters as Parameters
  if (!pattern) throw new Error('code_matches_pattern_required')
  const projects = await scopeProjects(core, input.query.scope)
  const args = ['--json', '--no-config', '--sortr', 'modified']
  if (!regex) args.push('--fixed-strings')
  if (!caseSensitive) args.push('--ignore-case')
  // A file type, not --glob: a positive --glob brings back files .gitignore lists, and a type doesn't.
  if (glob) args.push('--type-add', `codematches:${glob}`, '--type', 'codematches')
  args.push('--', pattern, ...projects.map((project) => project.path))
  const result = projects.length
    ? await runRipgrep(projects[0]!.path, args, {
        signal,
        timeoutMs: TIMEOUT_MS,
        partialOnTimeout: true,
        maxHits: DATA_LIMITS.selectionRecords,
      })
    : { files: [], truncated: false }
  // A press opens the file in a task on the project folder the search read: one with no branch of its
  // own, or one made on that checkout, which keeps the checkout's branch name. A worktree task's files
  // can differ.
  const tasks = await core.tasks.active()
  const taskFor = new Map(
    projects.map((project) => [
      project.id,
      tasks.find(
        (task) => task.projectId === project.id && (task.branch === null || task.worktreePath === project.path),
      )?.id,
    ]),
  )
  // Deepest folder first, so a project inside another project's folder claims its own files.
  const byDepth = [...projects].sort((left, right) => right.path.length - left.path.length)
  const records: DataSourcePage['records'] = []
  const seen = new Set<string>()
  for (const file of result.files) {
    const project = byDepth.find((candidate) => file.path.startsWith(candidate.path + sep))
    if (!project) continue
    const path = file.path
      .slice(project.path.length + 1)
      .split(sep)
      .join('/')
    const folder = path.split('/').slice(0, -1).slice(0, 2).join('/') || '.'
    const extension = extname(path).slice(1).toLowerCase()
    const taskId = taskFor.get(project.id)
    for (const hit of file.hits) {
      // A nested project's folder is searched twice, once from each root, so a match can repeat.
      const recordId = createHash('sha256').update(`${project.id}\0${path}\0${hit.line}\0${hit.col}`).digest('hex')
      if (seen.has(recordId)) continue
      seen.add(recordId)
      const item = fileTargetItem(path, hit.line)
      records.push({
        recordId,
        data: {
          project: project.id,
          projectName: project.name,
          path,
          folder,
          extension,
          line: hit.line,
          text: hit.preview.slice(0, MATCH_TEXT_CHARS),
        },
        ...(taskId ? { taskId } : {}),
        ...(item.length <= 200 ? { target: { kind: EDITOR_FILE_TARGET, item } } : {}),
      })
    }
  }
  const selected = selectDataRecords(records, input.query, { readOrder: true })
  return {
    ...selected,
    ...(result.truncated ? { completeness: { kind: 'incomplete', cause: 'host-budget' } } : {}),
    revision: codeMatchSourceDescription.revision,
    readTime: Date.now(),
  }
}

// A run's pages share one search, instead of running ripgrep again for each 100 records. The handler
// is made for every request, so the pager lives here.
const pager = createDataSelectionPager()

export const createCodeMatchSourceHandler = (core: Core): PluginFetchHandler =>
  createDataSourceHandler({
    description: codeMatchSourceDescription,
    failure: 'code_match_source_failed',
    query: (input, context, signal) => pager(context.userId, input, () => readMatches(core, input, signal)),
  })
