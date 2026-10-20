import {
  BridgeError,
  createDataSelectionPager,
  createDataSourceHandler,
  DATA_READ_LIMIT,
  dataComparisons,
  selectDataRecords,
  type CoreServices,
  type PluginFetchHandler,
} from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { DataSourcePage, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import { commitSourceDescription } from '../../shared/commitSource'
import { repositoryFor } from '../history'

type Core = Pick<CoreServices, 'git' | 'projects'>
type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type Project = { id: string; name: string }
type CommitRecord = { recordId: string; data: { authoredAt: number } & Record<string, string | number | boolean> }

// %x1e starts each commit, so the --shortstat line that follows it stays with it. %S is the branch
// `--branches` reached the commit through. %aN and %aE apply the repository's mailmap.
const FORMAT = '%x1e%H%x00%P%x00%aN%x00%aE%x00%at%x00%S%x00%s'

/** The projects a scope reaches: a workspace's, one project, or with neither, every project on the Node.
 *  Only device and service principals call this source, so a whole-Node read is the person's own view. */
async function scopeProjects(core: Core, scope: QueryInput['query']['scope']): Promise<Project[]> {
  if (scope.workspaceId)
    return (await core.projects.byWorkspace(scope.workspaceId)).filter(
      (project) => project.path && (!scope.projectId || project.id === scope.projectId),
    )
  const ids = scope.projectId ? [scope.projectId] : (await core.projects.checkouts()).map((checkout) => checkout.id)
  const projects = await Promise.all(ids.map((id) => core.projects.byId(id)))
  return projects.filter((project) => project !== null && project.path !== null) as Project[]
}

/** The latest lower bound the query puts on the author time, in milliseconds. */
function authoredSince(predicate: DataPredicate | undefined): number | null {
  let since: number | null = null
  for (const part of dataComparisons(predicate)) {
    const value = part.right?.address.from === 'literal' ? part.right.address.value : null
    if (
      part.left.address.from === 'item' &&
      part.left.address.pointer === '/authoredAt' &&
      (part.operator === 'gt' || part.operator === 'gte') &&
      typeof value === 'number'
    )
      since = Math.max(since ?? value, value)
  }
  return since
}

function parseCommits(project: Project, output: string): CommitRecord[] {
  return output
    .split('\x1e')
    .slice(1)
    .flatMap((entry) => {
      const [header = '', ...rest] = entry.split('\n')
      const [sha, parents, authorName, authorEmail, at, branch, subject] = header.split('\0')
      if (!sha || subject === undefined) return []
      const stat = rest.join(' ')
      const number = (pattern: RegExp) => Number(pattern.exec(stat)?.[1] ?? 0)
      return [
        {
          recordId: `${project.id}:${sha}`,
          data: {
            sha,
            subject,
            authorName: authorName!,
            authorEmail: authorEmail!,
            authoredAt: Number(at) * 1000,
            projectId: project.id,
            projectName: project.name,
            branch: branch!,
            filesChanged: number(/(\d+) files? changed/),
            linesAdded: number(/(\d+) insertions?\(\+\)/),
            linesRemoved: number(/(\d+) deletions?\(-\)/),
            merge: parents!.includes(' '),
          },
        },
      ]
    })
}

/** One project's commits, newest commit time first, or null when its folder isn't a Git repository. */
async function projectCommits(core: Core, project: Project, since: number | null, signal: AbortSignal) {
  let root: string
  try {
    root = await repositoryFor(core, project.id, signal)
  } catch (error) {
    if (error instanceof BridgeError) return null
    throw error
  }
  const result = await core.git.git(
    [
      'log',
      '--branches',
      `--max-count=${DATA_READ_LIMIT}`,
      '--shortstat',
      `--format=${FORMAT}`,
      // Git compares this to the commit time, which is never before the author time unless a clock was
      // wrong, so it only narrows. The query's own comparison then applies to the author time.
      ...(since === null ? [] : [`--since=@${Math.floor(since / 1000)}`]),
    ],
    // C locale, because Git translates the --shortstat line.
    { cwd: root, env: { LC_ALL: 'C' }, timeoutMs: 30_000, maxOutputBytes: 16 << 20, signal },
  )
  signal.throwIfAborted()
  if (result.code !== 0 || result.timedOut) return { records: [], failed: true, full: false }
  const records = parseCommits(project, result.stdout)
  // A cut stream ends mid-commit, so its last record may lack its stat.
  if (result.truncated) records.pop()
  return { records, failed: false, full: result.truncated || records.length >= DATA_READ_LIMIT }
}

/** Every project's commits newest author time first, up to the host's record budget, selected by the query. */
async function readCommits(core: Core, input: QueryInput, signal: AbortSignal): Promise<DataSourcePage> {
  const since = authoredSince(input.query.predicate)
  const projects = await scopeProjects(core, input.query.scope)
  const records: CommitRecord[] = []
  let failed = false
  // The oldest author time each read covers in full: a project that filled its read may hold older ones.
  const floors: number[] = []
  // Four projects at a time keeps a large workspace from spawning a Git process per project at once.
  for (let index = 0; index < projects.length; index += 4) {
    for (const read of await Promise.all(
      projects.slice(index, index + 4).map((project) => projectCommits(core, project, since, signal)),
    )) {
      if (!read) continue
      failed ||= read.failed
      records.push(...read.records)
      if (read.full && read.records.length) floors.push(Math.min(...read.records.map((r) => r.data.authoredAt)))
    }
  }
  records.sort((left, right) => right.data.authoredAt - left.data.authoredAt)
  if (records.length > DATA_LIMITS.selectionRecords)
    floors.push(records[DATA_LIMITS.selectionRecords - 1]!.data.authoredAt)
  const selected = selectDataRecords(records.slice(0, DATA_LIMITS.selectionRecords), input.query)
  return {
    ...selected,
    ...(failed || floors.length
      ? { completeness: { kind: 'incomplete', cause: failed ? 'provider-failure' : 'host-budget' } }
      : {}),
    ...(floors.length ? { coveredRange: { start: Math.max(...floors), end: input.evaluationTime } } : {}),
    revision: commitSourceDescription.revision,
    readTime: Date.now(),
  }
}

// A run's pages share one Git read, instead of running `git log` again for each 100 records. The
// handler is made for every request, so the pager lives here.
const pager = createDataSelectionPager()

export const createCommitSourceHandler = (core: Core): PluginFetchHandler =>
  createDataSourceHandler({
    description: commitSourceDescription,
    failure: 'git_commit_source_failed',
    query: (input, context, signal) => pager(context.userId, input, () => readCommits(core, input, signal)),
  })
