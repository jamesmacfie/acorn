import { createHash, randomUUID } from 'node:crypto'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { compareDataValues, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import {
  dataSourceRequestSchema,
  type DataSourceDescription,
  type DataSourcePage,
} from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import { bbPages, BITBUCKET_PROVIDER, type BitbucketSession } from '../bitbucketApi'

// One handler shape for both Bitbucket sources: a read over the repositories a panel names, then the
// query's filter, sort, `take`, and pages over the result. Each source says how it reads one
// repository. GitLab's sources have the same shape (plugins/gitlab/src/server/data/projectSource.ts).

type SourceRecord = DataSourcePage['records'][number]
// More than this many repositories in one panel is a panel nobody can read, and each costs requests
// against Bitbucket's hourly limit.
const MAX_REPOSITORIES = 5

export type RepositorySource = {
  description: DataSourceDescription
  /** One repository's records, and whether Bitbucket held more than the read took. */
  read: (
    session: BitbucketSession,
    repository: string,
    signal: AbortSignal,
  ) => Promise<{ records: SourceRecord[]; truncated: boolean }>
}

function matches(data: SourceRecord['data'], predicate: DataPredicate): boolean {
  if (predicate.kind !== 'comparison')
    return predicate.kind === 'all'
      ? predicate.predicates.every((part) => matches(data, part))
      : predicate.predicates.some((part) => matches(data, part))
  if (predicate.left.address.from !== 'item' || predicate.right?.address.from !== 'literal')
    throw new Error('unsupported_filter')
  try {
    return compareDataValues(
      readDataPointer(data, predicate.left.address.pointer),
      predicate.operator,
      predicate.right.address.from === 'literal' ? predicate.right.address.value : MISSING,
    )
  } catch {
    return false
  }
}

/** The person's repositories whose full name holds the search, for the `/repositories` parameter's
 *  picker. */
async function repositoryOptions(session: BitbucketSession, search: string, pageSize: number, signal: AbortSignal) {
  const filter = search ? `&q=${encodeURIComponent(`full_name ~ "${search.replace(/["\\]/g, '')}"`)}` : ''
  const listed = await bbPages<{ full_name: string }>(
    session,
    `/repositories?role=member&sort=-updated_on&pagelen=${Math.min(pageSize, 100)}${filter}`,
    1,
    signal,
  )
  if (!listed.ok) throw new Error('bitbucket_unavailable')
  return {
    options: listed.value.values.map((repository) => ({
      id: repository.full_name.toLowerCase(),
      label: repository.full_name,
    })),
    exhausted: true,
  }
}

type Selection = { key: string; page: DataSourcePage; expires: number }

export function createRepositorySourceHandler(source: RepositorySource): PluginFetchHandler {
  const selections = new Map<string, Selection>()
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (
        context.principal.kind !== 'device' &&
        !(context.principal.kind === 'internal' && context.principal.scope === 'service')
      )
        return Response.json({ error: 'forbidden' }, { status: 403 })
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(source.description)
      if (input.operation !== 'options' && input.operation !== 'query')
        return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      if (!scope.connectionId) throw new Error('connection_required')
      if (input.operation === 'options' && (input.target !== 'parameter' || input.pointer !== '/repositories'))
        throw new Error('unsupported_options')
      const requested = input.operation === 'query' ? scope.parameters.repositories : []
      if (
        !Array.isArray(requested) ||
        requested.length > MAX_REPOSITORIES ||
        requested.some((item) => typeof item !== 'string')
      )
        throw new Error('invalid_repositories')
      const repositories = (requested as string[]).map((repository) => repository.toLowerCase())

      for (const [id, held] of selections) if (held.expires < Date.now()) selections.delete(id)
      const key = createHash('sha256')
        .update(
          JSON.stringify({ userId: context.userId, scope, query: input.operation === 'query' ? input.query : null }),
        )
        .digest('hex')
      const cursor = input.operation === 'query' && input.cursor ? /^([\w-]+):(\d+)$/.exec(input.cursor) : null
      if (input.operation === 'query' && input.cursor && !cursor) throw new Error('invalid_cursor')
      const held = cursor ? selections.get(cursor[1]!) : undefined
      if (cursor && (!held || held.key !== key)) throw new Error('invalid_cursor')

      const answers = await context.providers.withConnections(BITBUCKET_PROVIDER, async (connection, auth) => {
        if (connection.id !== scope.connectionId) return undefined
        const session = { auth }
        if (input.operation === 'options')
          return { options: await repositoryOptions(session, input.search, input.pageSize, request.signal) }
        if (held) return { page: held.page }
        const records: SourceRecord[] = []
        let truncated = false
        for (const repository of repositories) {
          const read = await source.read(session, repository, request.signal)
          records.push(...read.records)
          truncated ||= read.truncated
        }
        const now = Date.now()
        const page: DataSourcePage = {
          records,
          revision: source.description.revision,
          readTime: now,
          completeness: truncated ? { kind: 'incomplete', cause: 'upstream-cap' } : { kind: 'complete' },
        }
        return { page }
      })
      const answer = answers[0]
      if (!answer) throw new Error('connection_unavailable')
      if ('options' in answer) return Response.json(answer.options)
      if (input.operation !== 'query') throw new Error('invalid_operation')

      let records = answer.page.records
      if (input.query.predicate) records = records.filter((record) => matches(record.data, input.query.predicate!))
      records = [...records].sort((left, right) => {
        for (const sort of input.query.sort) {
          const a = readDataPointer(left.data, sort.pointer)
          const b = readDataPointer(right.data, sort.pointer)
          if (a === b) continue
          if (typeof a !== 'number' || typeof b !== 'number') throw new Error('unsupported_sort')
          return (a - b) * (sort.direction === 'asc' ? 1 : -1)
        }
        return left.recordId.localeCompare(right.recordId)
      })
      if (input.query.take) records = records.slice(0, input.query.take)
      const offset = cursor ? Number(cursor[2]) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > records.length) throw new Error('invalid_cursor')
      const selected = records.slice(offset, offset + input.pageSize)
      const more = offset + selected.length < records.length
      let id = cursor?.[1]
      if (more && !id) {
        if (selections.size >= 16) throw new Error('selection_budget')
        id = randomUUID()
        selections.set(id, { key, page: answer.page, expires: Date.now() + DATA_LIMITS.queryMs })
      }
      return Response.json({
        ...answer.page,
        records: selected,
        completeness: more ? { kind: 'more', cursor: `${id}:${offset + selected.length}` } : answer.page.completeness,
      })
    } catch {
      // Provider bodies and credentials never become source error details.
      return Response.json({ error: 'bitbucket_source_failed' }, { status: 502 })
    }
  }
}
