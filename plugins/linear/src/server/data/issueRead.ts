import { dataComparisons, DATA_LIMITS, selectDataRecords } from '@acorn/plugin-api/node'
import type { DataSourceOptions, DataSourcePage, DataSourceQuery, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { issueSourceDescription } from '../../shared/issueSource'
import { linearData, linearFetch } from '../index'

type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
type Choice = { id: string; name: string }
type Issue = { id: string; identifier: string; title: string; url: string; description: string | null;
  project: { id: string }; state: { id: string; name: string; type: string }; createdAt: string; updatedAt: string }
const pageFields = 'pageInfo { hasNextPage endCursor }'
const issueFields = 'id identifier title url description project { id } state { id name type } createdAt updatedAt'
export const projectId = (query: { parameters: Record<string, unknown> }) => {
  const id = query.parameters.project
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('project_required')
  return id
}
async function graph<T>(token: string, query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const response = await linearFetch(token, query, variables, signal)
  if (!response.ok) throw new Error('linear_unavailable')
  return linearData<T>(response)
}

async function projectTeams(token: string, project: string, signal: AbortSignal) {
  const ids: string[] = []
  let after: string | null = null
  const seen = new Set<string>()
  for (let page = 0; page < DATA_LIMITS.queryPages; page++) {
    const data: { project: { teams: Page<Choice> } | null } = await graph(token,
      `query($project: String!, $after: String) { project(id: $project) { teams(first: 100, after: $after) { nodes { id name } ${pageFields} } } }`, { project, after }, signal)
    if (!data.project) throw new Error('project_unavailable')
    ids.push(...data.project.teams.nodes.map(team => team.id))
    if (!data.project.teams.pageInfo.hasNextPage) return ids
    after = data.project.teams.pageInfo.endCursor
    if (!after || seen.has(after)) throw new Error('invalid_cursor')
    seen.add(after)
  }
  throw new Error('project_teams_incomplete')
}

export async function readIssueOptions(token: string, input: Extract<DataSourceRequest, { operation: 'options' }>, signal: AbortSignal): Promise<DataSourceOptions> {
  let page: Page<Choice>
  const variables = { first: input.pageSize, after: input.cursor ?? null, filter: {} as Record<string, unknown> }
  if (input.target === 'parameter' && input.pointer === '/project') {
    variables.filter = { name: { containsIgnoreCase: input.search } }
    page = (await graph<{ projects: Page<Choice> }>(token,
      `query($first: Int!, $after: String, $filter: ProjectFilter) { projects(first: $first, after: $after, filter: $filter) { nodes { id name } ${pageFields} } }`, variables, signal)).projects
  } else if (input.target === 'field' && input.pointer === '/state/id') {
    const teams = await projectTeams(token, projectId(input.scope), signal)
    variables.filter = { team: { id: { in: teams } }, name: { containsIgnoreCase: input.search } }
    page = (await graph<{ workflowStates: Page<Choice> }>(token,
      `query($first: Int!, $after: String, $filter: WorkflowStateFilter) { workflowStates(first: $first, after: $after, filter: $filter) { nodes { id name } ${pageFields} } }`, variables, signal)).workflowStates
  } else throw new Error('unsupported_options')
  if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === input.cursor)) throw new Error('invalid_cursor')
  return { options: page.nodes.map(node => ({ id: node.id, label: node.name.slice(0, 80) })), exhausted: !page.pageInfo.hasNextPage,
    ...(page.pageInfo.hasNextPage ? { nextCursor: page.pageInfo.endCursor! } : {}) }
}

export async function readIssues(token: string, query: DataSourceQuery, signal: AbortSignal): Promise<DataSourcePage> {
  const project = projectId(query.scope)
  const teams = await projectTeams(token, project, signal)
  const and: Record<string, unknown>[] = [{ project: { id: { eq: project } } }]
  for (const comparison of dataComparisons(query.predicate)) {
    const left = comparison.left.address, right = comparison.right?.address
    if (left.from !== 'item' || right?.from !== 'literal') throw new Error('invalid_operand')
    if (!issueSourceDescription.fields.find(field => field.pointer === left.pointer)?.query?.operators.includes(comparison.operator)) throw new Error('unsupported_filter')
    if (left.pointer === '/state/id') {
      if (typeof right.value !== 'string') throw new Error('invalid_state')
      const { workflowState } = await graph<{ workflowState: { team: { id: string } } | null }>(token,
        'query($id: String!) { workflowState(id: $id) { team { id } } }', { id: right.value }, signal)
      if (!workflowState || !teams.includes(workflowState.team.id)) throw new Error('state_not_in_project')
      and.push({ state: { id: { eq: right.value } } })
    } else {
      if (typeof right.value !== 'number') throw new Error('invalid_date')
      and.push({ [left.pointer.slice(1)]: { [comparison.operator]: new Date(right.value).toISOString() } })
    }
  }
  for (const sort of query.sort) if (!issueSourceDescription.fields.find(field => field.pointer === sort.pointer)?.query?.sortable) throw new Error('unsupported_sort')
  const records: DataSourcePage['records'] = []
  const ids = new Set<string>(), cursors = new Set<string>()
  let after: string | null = null, bytes = 0
  for (let page = 0; page < DATA_LIMITS.queryPages; page++) {
    const { issues }: { issues: Page<Issue> } = await graph(token,
      `query($filter: IssueFilter, $after: String) { issues(first: 100, after: $after, filter: $filter, includeArchived: true) { nodes { ${issueFields} } ${pageFields} } }`, { filter: { and }, after }, signal)
    for (const issue of issues.nodes) {
      if (ids.has(issue.id) || issue.project.id !== project) throw new Error('invalid_issue')
      ids.add(issue.id)
      const record = { recordId: issue.id, data: { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url,
        description: issue.description, projectId: issue.project.id, state: { id: issue.state.id, name: issue.state.name, category: issue.state.type },
        createdAt: Date.parse(issue.createdAt), updatedAt: Date.parse(issue.updatedAt) }, action: { verb: 'openUrl' as const, url: issue.url } }
      const size = Buffer.byteLength(JSON.stringify(record))
      if (size > DATA_LIMITS.recordBytes || !Number.isFinite(record.data.createdAt) || !Number.isFinite(record.data.updatedAt)) throw new Error('invalid_record')
      bytes += size
      if (records.length >= DATA_LIMITS.selectionRecords || bytes > DATA_LIMITS.selectionBytes) return { records: [], revision: '1', readTime: Date.now(), completeness: { kind: 'incomplete', cause: 'upstream-cap' } }
      records.push(record)
    }
    if (!issues.pageInfo.hasNextPage) return { ...selectDataRecords(records, query), revision: '1', readTime: Date.now() }
    after = issues.pageInfo.endCursor
    if (!after || cursors.has(after)) throw new Error('invalid_cursor')
    cursors.add(after)
  }
  return { records: [], revision: '1', readTime: Date.now(), completeness: { kind: 'incomplete', cause: 'upstream-cap' } }
}
