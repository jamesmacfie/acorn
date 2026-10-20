import type { DataSourcePage, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { PROJECT_STATUS_TYPES, projectSourceDescription } from '../../shared/projectSource'
import { dateFilter, epoch, graph, pageFields, readAllRecords, sourceFilters, type Page } from './sourceRead'

type Project = {
  id: string
  name: string
  url: string
  status: { name: string; type: string }
  lead: { name: string } | null
  teams: { nodes: { name: string }[] }
  progress: number
  targetDate: string | null
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}
// Fifty projects a page, each with its first 25 teams, keeps a page well inside Linear's query
// complexity limit.
const projectFields =
  'id name url status { name type } lead { name } teams(first: 25) { nodes { name } } progress targetDate startedAt completedAt updatedAt'

export async function readProjects(
  token: string,
  query: DataSourceQuery,
  signal: AbortSignal,
): Promise<DataSourcePage> {
  const and: Record<string, unknown>[] = []
  for (const filter of sourceFilters(projectSourceDescription, query)) {
    if (filter.pointer === '/status/type') {
      if (!PROJECT_STATUS_TYPES.some((type) => type === filter.value)) throw new Error('invalid_status')
      and.push({ status: { type: { eq: filter.value } } })
    } else and.push(dateFilter(filter))
  }
  return readAllRecords(
    projectSourceDescription,
    query,
    async (after) =>
      (
        await graph<{ projects: Page<Project> }>(
          token,
          `query($filter: ProjectFilter, $after: String) { projects(first: 50, after: $after, filter: $filter) { nodes { ${projectFields} } ${pageFields} } }`,
          { filter: and.length ? { and } : null, after },
          signal,
        )
      ).projects,
    (project) => ({
      recordId: project.id,
      data: {
        id: project.id,
        name: project.name,
        url: project.url,
        status: { name: project.status.name, type: project.status.type },
        lead: project.lead?.name ?? null,
        teams: project.teams.nodes.map((team) => team.name),
        progress: Math.round(project.progress * 1000) / 10,
        targetDate: project.targetDate,
        startedAt: epoch(project.startedAt),
        completedAt: epoch(project.completedAt),
        updatedAt: epoch(project.updatedAt),
      },
      action: { verb: 'openUrl' as const, url: project.url },
    }),
  )
}
