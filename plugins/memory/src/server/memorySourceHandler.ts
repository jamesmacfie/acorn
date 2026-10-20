import { selectDataRecords, type CoreServices, type PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { MemoryRow, MemoryScope } from '../contract/library'
import { memorySourceDescription } from '../shared/memorySource'

// The Memories data source (docs/data-sources.md). It reads the library through the same list the
// Memory page uses, and keeps each memory's frontmatter, never its body.

type ListMemories = (projectId: string | null, scope?: MemoryScope) => Promise<MemoryRow[]>
type Projects = Pick<CoreServices['projects'], 'byId' | 'byWorkspace'>
type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>

/** The projects a scope reaches. A project in a workspace scope must be one of that workspace's. */
async function scopeProjects(projects: Projects, scope: QueryInput['query']['scope']) {
  if (scope.workspaceId) {
    const inWorkspace = await projects.byWorkspace(scope.workspaceId)
    if (!scope.projectId) return inWorkspace
    const project = inWorkspace.find((candidate) => candidate.id === scope.projectId)
    if (!project) throw new Error('project_outside_workspace')
    return [project]
  }
  if (!scope.projectId) throw new Error('workspace_required')
  const project = await projects.byId(scope.projectId)
  if (!project) throw new Error('project_not_found')
  return [project]
}

function memoryRecord(row: MemoryRow, projectName: string | null) {
  // The store records `owner`, `import`, or `agent:<session id>`. A hand-edited file may carry anything.
  const agent = row.updatedBy?.startsWith('agent:')
  return {
    recordId: `${row.scope}:${row.projectId ?? ''}:${row.name}`,
    data: {
      name: row.name,
      description: row.description,
      type: row.type,
      scope: row.scope,
      projectId: row.projectId,
      projectName,
      writtenBy: agent ? 'agent' : row.updatedBy === 'owner' || row.updatedBy === 'import' ? row.updatedBy : null,
      sessionId: agent ? row.updatedBy!.slice('agent:'.length) || null : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      superseded: !!row.supersededBy,
    },
    // Only a project memory has a place in the Memory page, which shows one project's library.
    ...(row.scope === 'project' && row.projectId
      ? { target: { kind: 'memory.entry', item: `${row.projectId}/${row.name}` } }
      : {}),
  }
}

/**
 * One page of the scope's memories. Private memories apply in every project, so they're read once
 * beside the projects' own. The budget keeps the most recently updated memories. Each page reads the
 * library again, because the store has no cursor and a library is small.
 */
async function memoryPage(input: QueryInput, list: ListMemories, projects: Projects) {
  const reached = await scopeProjects(projects, input.query.scope)
  const names = new Map(reached.map((project) => [project.id, project.name]))
  const rows = [
    ...(await list(null, 'private')),
    ...(await Promise.all(reached.map((project) => list(project.id, 'project')))).flat(),
  ].sort((left, right) => right.updatedAt - left.updatedAt)
  const kept = rows.slice(0, DATA_LIMITS.selectionRecords)
  const truncated = rows.length > kept.length
  const selection = selectDataRecords(
    kept.map((row) => memoryRecord(row, row.projectId ? (names.get(row.projectId) ?? null) : null)),
    input.query,
  )
  const offset = input.cursor ? Number(input.cursor) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > selection.records.length)
    throw new Error('invalid_cursor')
  const records = selection.records.slice(offset, offset + input.pageSize)
  const next = offset + records.length
  return {
    records,
    completeness:
      next < selection.records.length
        ? { kind: 'more' as const, cursor: String(next) }
        : truncated
          ? { kind: 'incomplete' as const, cause: 'host-budget' as const }
          : selection.completeness,
    ...(truncated ? { coveredRange: { start: kept.at(-1)!.updatedAt, end: Date.now() } } : {}),
  }
}

export function createMemorySourceHandler(list: ListMemories, projects: Projects): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    if (
      context.principal.kind !== 'device' &&
      !(context.principal.kind === 'internal' && context.principal.scope === 'service')
    )
      return Response.json({ error: 'forbidden' }, { status: 403 })
    try {
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(memorySourceDescription)
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const page = await memoryPage(input, list, projects)
      return Response.json({ ...page, revision: memorySourceDescription.revision, readTime: Date.now() })
    } catch {
      return Response.json({ error: 'memory_source_failed' }, { status: 502 })
    }
  }
}
