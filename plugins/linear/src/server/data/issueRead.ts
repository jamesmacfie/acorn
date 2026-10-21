import { DATA_LIMITS } from '@acorn/plugin-api/node'
import type {
  DataSourceOptions,
  DataSourcePage,
  DataSourceQuery,
  DataSourceRequest,
} from '@acorn/protocol/dataSources.ts'
import { issueSourceDescription, PRIORITIES } from '../../shared/issueSource'
import { cycleTitle } from '../../shared/cycleSource'
import {
  dateFilter,
  epoch,
  graph,
  optionsPage,
  pageFields,
  readAllRecords,
  sourceFilters,
  type Page,
} from './sourceRead'

type Choice = { id: string; name: string }
type Issue = {
  id: string
  identifier: string
  title: string
  url: string
  description: string | null
  project: { id: string }
  state: { id: string; name: string; type: string }
  team: Choice
  labels: { nodes: { name: string }[] }
  cycle: { id: string; number: number; name: string | null } | null
  assignee: { name: string; isMe: boolean } | null
  priority: number
  estimate: number | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
const issueFields =
  'id identifier title url description project { id } state { id name type } team { id name } labels(first: 25) { nodes { name } } cycle { id number name } assignee { name isMe } priority estimate createdAt updatedAt completedAt'
const projectId = (query: { parameters: Record<string, unknown> }) => {
  const id = query.parameters.project
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('project_required')
  return id
}

async function projectTeams(token: string, project: string, signal: AbortSignal) {
  const ids: string[] = []
  let after: string | null = null
  const seen = new Set<string>()
  for (let page = 0; page < DATA_LIMITS.queryPages; page++) {
    const data: { project: { teams: Page<Choice> } | null } = await graph(
      token,
      `query($project: String!, $after: String) { project(id: $project) { teams(first: 100, after: $after) { nodes { id name } ${pageFields} } } }`,
      { project, after },
      signal,
    )
    if (!data.project) throw new Error('project_unavailable')
    ids.push(...data.project.teams.nodes.map((team) => team.id))
    if (!data.project.teams.pageInfo.hasNextPage) return ids
    after = data.project.teams.pageInfo.endCursor
    if (!after || seen.has(after)) throw new Error('invalid_cursor')
    seen.add(after)
  }
  throw new Error('project_teams_incomplete')
}

export async function readIssueOptions(
  token: string,
  input: Extract<DataSourceRequest, { operation: 'options' }>,
  signal: AbortSignal,
): Promise<DataSourceOptions> {
  let page: Page<Choice>
  const variables = { first: input.pageSize, after: input.cursor ?? null, filter: {} as Record<string, unknown> }
  if (input.target === 'parameter' && input.pointer === '/project') {
    variables.filter = { name: { containsIgnoreCase: input.search } }
    page = (
      await graph<{ projects: Page<Choice> }>(
        token,
        `query($first: Int!, $after: String, $filter: ProjectFilter) { projects(first: $first, after: $after, filter: $filter) { nodes { id name } ${pageFields} } }`,
        variables,
        signal,
      )
    ).projects
  } else if (input.target === 'field' && input.pointer === '/state/id') {
    const teams = await projectTeams(token, projectId(input.scope), signal)
    variables.filter = { team: { id: { in: teams } }, name: { containsIgnoreCase: input.search } }
    page = (
      await graph<{ workflowStates: Page<Choice> }>(
        token,
        `query($first: Int!, $after: String, $filter: WorkflowStateFilter) { workflowStates(first: $first, after: $after, filter: $filter) { nodes { id name } ${pageFields} } }`,
        variables,
        signal,
      )
    ).workflowStates
  } else if (input.target === 'field' && input.pointer === '/team/id') {
    const teams = await projectTeams(token, projectId(input.scope), signal)
    variables.filter = { id: { in: teams }, name: { containsIgnoreCase: input.search } }
    page = (
      await graph<{ teams: Page<Choice> }>(
        token,
        `query($first: Int!, $after: String, $filter: TeamFilter) { teams(first: $first, after: $after, filter: $filter) { nodes { id name } ${pageFields} } }`,
        variables,
        signal,
      )
    ).teams
  } else if (input.target === 'field' && input.pointer === '/labels') {
    // An issue's labels are names, so each choice is one. Two teams can each have a label of one name.
    variables.filter = { name: { containsIgnoreCase: input.search } }
    const labels = (
      await graph<{ issueLabels: Page<Choice> }>(
        token,
        `query($first: Int!, $after: String, $filter: IssueLabelFilter) { issueLabels(first: $first, after: $after, filter: $filter) { nodes { id name } ${pageFields} } }`,
        variables,
        signal,
      )
    ).issueLabels
    const names = [...new Set(labels.nodes.map((label) => label.name))]
    page = { ...labels, nodes: names.map((name) => ({ id: name, name })) }
  } else throw new Error('unsupported_options')
  return optionsPage(page, input.cursor)
}

export async function readIssues(token: string, query: DataSourceQuery, signal: AbortSignal): Promise<DataSourcePage> {
  const project = projectId(query.scope)
  const teams = await projectTeams(token, project, signal)
  const and: Record<string, unknown>[] = [{ project: { id: { eq: project } } }]
  for (const filter of sourceFilters(issueSourceDescription, query)) {
    if (filter.pointer === '/state/id') {
      if (typeof filter.value !== 'string') throw new Error('invalid_state')
      const { workflowState } = await graph<{ workflowState: { team: { id: string } } | null }>(
        token,
        'query($id: String!) { workflowState(id: $id) { team { id } } }',
        { id: filter.value },
        signal,
      )
      if (!workflowState || !teams.includes(workflowState.team.id)) throw new Error('state_not_in_project')
      and.push({ state: { id: { eq: filter.value } } })
    } else if (filter.pointer === '/team/id') {
      if (typeof filter.value !== 'string') throw new Error('invalid_team')
      if (!teams.includes(filter.value)) throw new Error('team_not_in_project')
      and.push({ team: { id: { eq: filter.value } } })
    } else if (filter.pointer === '/labels') {
      if (typeof filter.value !== 'string') throw new Error('invalid_label')
      and.push({ labels: { some: { name: { eq: filter.value } } } })
    } else if (filter.pointer === '/assignedToViewer') {
      if (typeof filter.value !== 'boolean') throw new Error('invalid_assignee_filter')
      // Only true narrows Linear's read. An unassigned issue has no assignee to compare, so the exact
      // check after the read decides false.
      if (filter.value) and.push({ assignee: { isMe: { eq: true } } })
    } else and.push(dateFilter(filter))
  }
  return readAllRecords(
    issueSourceDescription,
    query,
    async (after) =>
      (
        await graph<{ issues: Page<Issue> }>(
          token,
          `query($filter: IssueFilter, $after: String) { issues(first: 100, after: $after, filter: $filter, includeArchived: true) { nodes { ${issueFields} } ${pageFields} } }`,
          { filter: { and }, after },
          signal,
        )
      ).issues,
    (issue) => {
      if (issue.project.id !== project) throw new Error('invalid_issue')
      return {
        recordId: issue.id,
        data: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          description: issue.description,
          projectId: issue.project.id,
          state: { id: issue.state.id, name: issue.state.name, category: issue.state.type },
          team: { id: issue.team.id, name: issue.team.name },
          labels: issue.labels.nodes.map((label) => label.name),
          cycleId: issue.cycle?.id ?? null,
          cycle: issue.cycle ? cycleTitle(issue.cycle) : null,
          assignee: issue.assignee?.name ?? null,
          assignedToViewer: issue.assignee?.isMe ?? false,
          priority: PRIORITIES[issue.priority] ?? 'none',
          estimate: issue.estimate,
          createdAt: epoch(issue.createdAt),
          updatedAt: epoch(issue.updatedAt),
          completedAt: epoch(issue.completedAt),
        },
        action: { verb: 'openUrl' as const, url: issue.url },
        target: { kind: 'linear.issue', item: issue.identifier },
      }
    },
  )
}
