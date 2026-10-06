import { and, eq, or } from 'drizzle-orm'
import type { DataSourceDescription, DataSourceQuery, DataSourceScope } from '@acorn/protocol/dataSources.ts'
import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import { getDb, schema } from '../db'
import { DataSourceError } from './validation'

type ProjectScope = NonNullable<DataSourceDescription['projectScope']>
export type WorkspaceSourceProjects = { kind: ProjectScope['kind']; projects: Map<string, Set<string>> }

const containerId = (value: string, kind: ProjectScope['kind']) => kind === 'repository' ? value.toLowerCase() : value

/** External IDs are scoped to the workspace and account. A workspace-wide link has no task owner. */
export async function workspaceSourceProjects(env: Env, scope: DataSourceScope, mapping: ProjectScope): Promise<WorkspaceSourceProjects | undefined> {
  if (!scope.workspaceId) return undefined
  const db = getDb(env)
  const projects = new Map<string, Set<string>>()
  const add = (externalId: string, projectId?: string) => {
    const id = containerId(externalId, mapping.kind)
    const matches = projects.get(id) ?? new Set<string>()
    if (projectId) matches.add(projectId)
    projects.set(id, matches)
  }
  const local = await db.select({ id: schema.projects.id, owner: schema.projects.githubOwner, name: schema.projects.githubName })
    .from(schema.projects).where(and(eq(schema.projects.workspaceId, scope.workspaceId),
      scope.projectId ? eq(schema.projects.id, scope.projectId) : undefined))
  const localIds = new Set(local.map(project => project.id))
  if (mapping.kind === 'repository') {
    for (const project of local) if (project.owner && project.name) add(`${project.owner}/${project.name}`, project.id)
  }
  if (scope.connectionId) {
    const links = await db.select().from(schema.workspaceExternalProjects)
      .where(and(eq(schema.workspaceExternalProjects.workspaceId, scope.workspaceId),
        eq(schema.workspaceExternalProjects.integrationId, scope.connectionId),
        scope.projectId ? or(eq(schema.workspaceExternalProjects.projectId, ''), eq(schema.workspaceExternalProjects.projectId, scope.projectId)) : undefined))
    for (const link of links) if (!link.projectId || localIds.has(link.projectId)) add(link.externalId, link.projectId || undefined)
  }
  return { kind: mapping.kind, projects }
}

/** A workspace query can select a subset of its links, but cannot widen to the whole account. */
export function workspaceSourceQuery(query: DataSourceQuery, description: DataSourceDescription, linked: WorkspaceSourceProjects): DataSourceQuery {
  const mapping = description.projectScope!
  const key = mapping.parameter.slice(1)
  const parameter = description.parameters.properties?.[key]
  const selected = readDataPointer(query.scope.parameters, mapping.parameter)
  const ids = [...linked.projects.keys()]
  let value: DataValue
  if (parameter?.type === 'array') {
    if (selected !== MISSING && (!Array.isArray(selected) || selected.some(id => typeof id !== 'string'))) throw new DataSourceError('invalid-request')
    value = selected === MISSING ? ids : (selected as string[]).map(id => containerId(id, linked.kind)).filter(id => linked.projects.has(id))
  } else {
    const id = typeof selected === 'string' ? containerId(selected, linked.kind) : undefined
    if (!id || !linked.projects.has(id)) throw new DataSourceError('invalid-request', { reason: 'Choose a project linked to this workspace.' })
    value = id
  }
  return { ...query, scope: { ...query.scope, parameters: { ...query.scope.parameters, [key]: value } } }
}

/** Only an exact, unique local owner can be used to create a task. */
export function recordProjectId(data: DataValue, mapping: ProjectScope, linked: WorkspaceSourceProjects): string | undefined {
  const value = readDataPointer(data, mapping.record)
  if (typeof value !== 'string') throw new DataSourceError('invalid-response')
  const projects = linked.projects.get(containerId(value, linked.kind))
  if (!projects) throw new DataSourceError('invalid-response', { reason: 'The source returned a record outside this workspace.' })
  return projects.size === 1 ? [...projects][0] : undefined
}
