import {
  createDataSourceHandler,
  pageDataRecords,
  withinDataBudget,
  type CoreServices,
  type PluginFetchHandler,
} from '@acorn/plugin-api/node'
import type { DataSourceRequest } from '@acorn/protocol/dataSources.ts'
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
  const kept = withinDataBudget(rows)
  return pageDataRecords(
    input,
    {
      records: kept.rows.map((row) => memoryRecord(row, row.projectId ? (names.get(row.projectId) ?? null) : null)),
      truncated: kept.truncated,
    },
    { timePointer: '/updatedAt' },
  )
}

export const createMemorySourceHandler = (list: ListMemories, projects: Projects): PluginFetchHandler =>
  createDataSourceHandler({
    description: memorySourceDescription,
    failure: 'memory_source_failed',
    query: (input) => memoryPage(input, list, projects),
  })
