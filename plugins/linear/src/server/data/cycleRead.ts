import type {
  DataSourceOptions,
  DataSourcePage,
  DataSourceQuery,
  DataSourceRequest,
} from '@acorn/protocol/dataSources.ts'
import { cycleSourceDescription, cycleTitle } from '../../shared/cycleSource'
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

type Cycle = {
  id: string
  number: number
  name: string | null
  startsAt: string
  endsAt: string
  completedAt: string | null
  progress: number
  isActive: boolean
  isFuture: boolean
  issueCountHistory: number[]
  completedIssueCountHistory: number[]
  team: { id: string; key: string; name: string }
}
const cycleFields =
  'id number name startsAt endsAt completedAt progress isActive isFuture issueCountHistory completedIssueCountHistory team { id key name }'
// Each status as a Linear filter, matching how a record's status is derived from the same flags.
const statusFilters: Record<string, Record<string, unknown>> = {
  active: { isActive: { eq: true } },
  upcoming: { isFuture: { eq: true } },
  past: { isActive: { eq: false }, isFuture: { eq: false } },
}

export async function readCycleOptions(
  token: string,
  input: Extract<DataSourceRequest, { operation: 'options' }>,
  signal: AbortSignal,
): Promise<DataSourceOptions> {
  if (input.target !== 'field' || input.pointer !== '/team/id') throw new Error('unsupported_options')
  const { teams } = await graph<{ teams: Page<{ id: string; name: string }> }>(
    token,
    `query($first: Int!, $after: String, $filter: TeamFilter) { teams(first: $first, after: $after, filter: $filter) { nodes { id name } ${pageFields} } }`,
    { first: input.pageSize, after: input.cursor ?? null, filter: { name: { containsIgnoreCase: input.search } } },
    signal,
  )
  return optionsPage(teams, input.cursor)
}

export async function readCycles(token: string, query: DataSourceQuery, signal: AbortSignal): Promise<DataSourcePage> {
  const and: Record<string, unknown>[] = []
  for (const filter of sourceFilters(cycleSourceDescription, query)) {
    if (filter.pointer === '/team/id') {
      if (typeof filter.value !== 'string') throw new Error('invalid_team')
      and.push({ team: { id: { eq: filter.value } } })
    } else if (filter.pointer === '/status') {
      const status = typeof filter.value === 'string' ? statusFilters[filter.value] : undefined
      if (!status) throw new Error('invalid_status')
      and.push(status)
    } else and.push(dateFilter(filter))
  }
  // Linear has no address field on a cycle, so the record builds the one its app uses from the
  // workspace's URL key, read alongside each page.
  let urlKey = ''
  return readAllRecords(
    cycleSourceDescription,
    query,
    async (after) => {
      const data = await graph<{ organization: { urlKey: string }; cycles: Page<Cycle> }>(
        token,
        `query($filter: CycleFilter, $after: String) { organization { urlKey } cycles(first: 100, after: $after, filter: $filter, includeArchived: true) { nodes { ${cycleFields} } ${pageFields} } }`,
        { filter: and.length ? { and } : null, after },
        signal,
      )
      urlKey = data.organization.urlKey
      return data.cycles
    },
    (cycle) => {
      const issues = cycle.issueCountHistory
      const url = `https://linear.app/${encodeURIComponent(urlKey)}/team/${encodeURIComponent(cycle.team.key)}/cycle/${cycle.number}`
      return {
        recordId: cycle.id,
        data: {
          id: cycle.id,
          number: cycle.number,
          title: cycleTitle(cycle),
          url,
          team: { id: cycle.team.id, key: cycle.team.key, name: cycle.team.name },
          status: cycle.isActive ? 'active' : cycle.isFuture ? 'upcoming' : 'past',
          startsAt: epoch(cycle.startsAt),
          endsAt: epoch(cycle.endsAt),
          completedAt: epoch(cycle.completedAt),
          progress: Math.round(cycle.progress * 1000) / 10,
          issueCount: issues.at(-1) ?? null,
          completedIssueCount: cycle.completedIssueCountHistory.at(-1) ?? null,
          addedIssueCount: issues.length ? issues.at(-1)! - issues[0]! : null,
        },
        action: { verb: 'openUrl' as const, url },
      }
    },
  )
}
