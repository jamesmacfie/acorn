import { createHash } from 'node:crypto'
import {
  BridgeError,
  dataComparisons,
  selectDataRecords,
  type CoreServices,
  type PluginFetchHandler,
} from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { dataSourceRequestSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import { commitSourceDescription } from '../../shared/commitSource'
import { repositoryFor } from '../history'

type Core = Pick<CoreServices, 'git' | 'projects'>
type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type Project = { id: string; name: string }
type CommitRecord = { recordId: string; data: { authoredAt: number } & Record<string, string | number | boolean> }
type Read = { records: CommitRecord[]; cause: 'host-budget' | 'provider-failure' | null; coveredFrom: number | null }

// %x1e starts each commit, so the --shortstat line that follows it stays with it. %S is the branch
// `--branches` reached the commit through. %aN and %aE apply the repository's mailmap.
const FORMAT = '%x1e%H%x00%P%x00%aN%x00%aE%x00%at%x00%S%x00%s'
// One past the host's record budget, so a project that fills it shows that more remain.
const READ_LIMIT = DATA_LIMITS.selectionRecords + 1

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
      `--max-count=${READ_LIMIT}`,
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
  return { records, failed: false, full: result.truncated || records.length >= READ_LIMIT }
}

/** Every project's commits newest author time first, up to the host's record budget. */
async function readCommits(core: Core, input: QueryInput, signal: AbortSignal): Promise<Read> {
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
  return {
    records: records.slice(0, DATA_LIMITS.selectionRecords),
    cause: failed ? 'provider-failure' : floors.length ? 'host-budget' : null,
    coveredFrom: floors.length ? Math.max(...floors) : null,
  }
}

// A run reads every page within one evaluation time, so its pages share one Git read for the host's
// query time instead of running `git log` again for each 100 records.
const reads = new Map<string, { expires: number; read: Promise<Read> }>()
function retainedRead(input: QueryInput, read: () => Promise<Read>): Promise<Read> {
  const now = Date.now()
  for (const [key, entry] of reads) if (entry.expires <= now) reads.delete(key)
  const key = createHash('sha256')
    .update(JSON.stringify([input.query.scope, input.query.predicate ?? null, input.evaluationTime]))
    .digest('hex')
  const retained = reads.get(key)
  if (retained) return retained.read
  if (reads.size >= 16) reads.delete(reads.keys().next().value!)
  const entry = { expires: now + DATA_LIMITS.queryMs, read: read() }
  entry.read.catch(() => reads.delete(key))
  reads.set(key, entry)
  return entry.read
}

async function commitPage(core: Core, input: QueryInput, signal: AbortSignal) {
  const read = await retainedRead(input, () => readCommits(core, input, signal))
  const selected = selectDataRecords(read.records, input.query)
  const offset = input.cursor ? Number(input.cursor) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(selected.records.length, 1))
    throw new Error('invalid_cursor')
  const records = selected.records.slice(offset, offset + input.pageSize)
  const next = offset + records.length
  return {
    records,
    completeness:
      next < selected.records.length
        ? { kind: 'more' as const, cursor: String(next) }
        : read.cause
          ? { kind: 'incomplete' as const, cause: read.cause }
          : selected.completeness,
    ...(read.coveredFrom === null ? {} : { coveredRange: { start: read.coveredFrom, end: input.evaluationTime } }),
    revision: commitSourceDescription.revision,
    readTime: Date.now(),
  }
}

export function createCommitSourceHandler(core: Core): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    if (
      context.principal.kind !== 'device' &&
      !(context.principal.kind === 'internal' && context.principal.scope === 'service')
    )
      return Response.json({ error: 'forbidden' }, { status: 403 })
    try {
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(commitSourceDescription)
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      return Response.json(await commitPage(core, input, request.signal))
    } catch {
      return Response.json({ error: 'git_commit_source_failed' }, { status: 502 })
    }
  }
}
