// Thin Linear client (mirrors the GitHub client). Personal API key goes raw in Authorization,
// with no "Bearer" prefix, since that one is for OAuth tokens. Returns parsed GraphQL data or throws;
// callers map errors via linearError on the fetch Response. Linear has one endpoint: POST /graphql.

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] }

// Low-level: returns the raw Response so the route can normalize status (e.g. 401 bad key).
export const linearFetch = (apiKey: string, query: string, variables: Record<string, unknown>) =>
  fetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })

export const linearError = (res: Response): { error: string; status: 401 | 502 } | null =>
  res.ok ? null : res.status === 401 || res.status === 403 ? { error: 'linear_reauth', status: 401 } : { error: 'linear_unavailable', status: 502 }

// Parse a GraphQL body, throwing on transport/GraphQL errors so the route's catch maps to 502.
export async function linearData<T>(res: Response): Promise<T> {
  const body = (await res.json()) as GraphQLResponse<T>
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '))
  if (!body.data) throw new Error('linear: empty response')
  return body.data
}

// Validate a key by reading the viewer + workspace name (used when connecting).
export const VIEWER_QUERY = `query { viewer { name organization { name } } }`
export type Viewer = { viewer: { name: string; organization: { name: string } } }

// Projects in the workspace, for the per-repo project picker (docs/workspaces-and-tasks.md § Workspace
// and project).
export const PROJECTS_QUERY = `query { projects(first: 250) { nodes { id name } } }`
export type LinearProjectNode = { id: string; name: string }

// The fields a rail/browse row needs. branchName is Linear's suggested git branch, the promote
// default. `description` is the issue's own prose, capped before it reaches a row: a workflow
// started from a row menu puts the title and this in its `issue` input, and the alternative was a
// second call per issue at the moment somebody opened a menu (docs/workflows.md § Starting a run).
const TRIAGE_FIELDS = `id identifier title url description branchName priority priorityLabel updatedAt
      state { name type color } assignee { name }
      labels { nodes { id name color } }`

// Active issues for a set of projects (the Linear rail source). Excludes completed/canceled so the
// list is signal, not history.
export const PROJECT_ISSUES_QUERY = `query($filter: IssueFilter) {
  issues(filter: $filter, first: 100) {
    nodes {
      ${TRIAGE_FIELDS}
    }
  }
}`
export const projectIssuesFilter = (projectIds: string[]): Record<string, unknown> => ({
  project: { id: { in: projectIds } },
  state: { type: { nin: ['completed', 'canceled'] } },
})

/**
 * The same filter, narrowed by what somebody typed. The palette's search sends this
 * (docs/integrations.md § From the command palette).
 *
 * Provider-side rather than a filter over a fetched page, because the mapping half is a filter Linear
 * supports — `project: { id: { in: … } }` is the one the rail already sends — so the narrowing can ride
 * along with it. Filtering locally would have meant asking for the first hundred active issues and
 * searching those, which cannot find the hundred-and-first and moves more bytes to find fewer rows.
 * The request count is the same either way, and it goes through the same per-connection scheduler and
 * budget the rail does, so no rate-limit policy changes hands.
 *
 * Two clauses, both fields `IssueFilter` has had since the API's beginning: the title, and the number
 * behind an identifier. Deliberately not `searchableContent`, which would also read every description
 * — that is a different question from "find the ticket I am thinking of", and it is the field most
 * likely to differ between plans.
 */
export function projectIssueSearchFilter(projectIds: string[], query: string): Record<string, unknown> {
  const base = projectIssuesFilter(projectIds)
  const text = query.trim()
  if (!text) return base
  const or: Record<string, unknown>[] = [{ title: { containsIgnoreCase: text } }]
  const identifier = parseIdentifier(text.toUpperCase())
  if (identifier) or.push({ team: { key: { eq: identifier.key } }, number: { eq: identifier.number } })
  else {
    // A bare number, with or without the hash somebody pasted it with.
    const number = /^#?(\d{1,9})$/.exec(text)
    if (number) or.push({ number: { eq: Number(number[1]) } })
  }
  // Top-level fields are ANDed and `or` ORs its own list, so this reads: in these projects, still
  // active, and matching one of these.
  return { ...base, or }
}

// The same query with a different filter: active issues assigned to whoever owns the credential,
// across the whole workspace rather than the linked projects. A rail is scoped to the project someone
// is looking at; a dashboard panel is scoped to the person.
export const myIssuesFilter = (): Record<string, unknown> => ({
  assignee: { isMe: { eq: true } },
  state: { type: { nin: ['completed', 'canceled'] } },
})

// A single issue-history event. Linear records each change with from/to fields; one event may
// carry several changes (state + assignee at once). Labels arrive as IDs, resolved to names via
// the issue's current label set where possible. actor is the user; botActor covers integrations.
export type LinearHistoryNode = {
  id: string
  createdAt: string
  actor: { name: string } | null
  botActor: { name: string } | null
  fromState: { name: string } | null
  toState: { name: string; color?: string } | null
  fromAssignee: { name: string } | null
  toAssignee: { name: string } | null
  addedLabelIds: string[] | null
  removedLabelIds: string[] | null
  fromTitle: string | null
  toTitle: string | null
}

// A minimal issue node used for parent/children/relation targets.
export type LinearRelatedNode = {
  id: string
  identifier: string
  title: string
  state: { name: string; type: string; color: string } | null
}

// Linear issue node as queried below. Detail-only fields are optional (absent on the summary query).
export type LinearNode = {
  id: string
  identifier: string
  title: string
  url: string
  description?: string | null
  branchName?: string | null
  priority?: number | null
  priorityLabel?: string | null
  estimate?: number | null
  dueDate?: string | null
  createdAt?: string
  updatedAt?: string
  state: { name: string; type: string; color: string } | null
  assignee: { name: string } | null
  creator?: { name: string } | null
  team?: { key: string; name: string } | null
  project?: { id: string; name: string } | null
  cycle?: { number: number; endsAt: string | null } | null
  labels?: { nodes: { id: string; name: string; color: string }[] }
  attachments?: { nodes: { id: string; title: string | null; subtitle: string | null; url: string; sourceType: string | null }[] }
  parent?: LinearRelatedNode | null
  children?: { nodes: LinearRelatedNode[] }
  relations?: { nodes: { id: string; type: string; relatedIssue: LinearRelatedNode | null }[] }
  inverseRelations?: { nodes: { id: string; type: string; issue: LinearRelatedNode | null }[] }
  comments?: { nodes: { id: string; body: string; createdAt: string; user: { name: string } | null; parent: { id: string } | null }[] }
  history?: { nodes: LinearHistoryNode[] }
}

// One GraphQL call for a whole referenced set: OR over (team key, number) pairs parsed from the
// identifiers. Summary fields only.
export const ISSUES_QUERY = `query($filter: IssueFilter) {
  issues(filter: $filter, first: 50) {
    nodes { id identifier title url state { name type color } assignee { name } }
  }
}`

// Full detail for the side panel: description, comments (threaded via parent), activity history,
// plus context fields (priority/estimate/cycle/team/project), external attachments, and the issue
// graph (parent, sub-issues, relations). All ride this one request.
export const ISSUE_DETAIL_QUERY = `query($filter: IssueFilter) {
  issues(filter: $filter, first: 1) {
    nodes {
      id identifier title url description branchName priority priorityLabel estimate dueDate createdAt updatedAt
      state { name type color } assignee { name } creator { name }
      team { key name }
      project { id name }
      cycle { number endsAt }
      labels { nodes { id name color } }
      attachments(first: 25) { nodes { id title subtitle url sourceType } }
      parent { id identifier title state { name type color } }
      children(first: 50) { nodes { id identifier title state { name type color } } }
      relations(first: 25) { nodes { id type relatedIssue { id identifier title state { name type color } } } }
      inverseRelations(first: 25) { nodes { id type issue { id identifier title state { name type color } } } }
      comments(first: 50) { nodes { id body createdAt user { name } parent { id } } }
      history(first: 50) {
        nodes {
          id createdAt actor { name } botActor { name }
          fromState { name } toState { name color }
          fromAssignee { name } toAssignee { name }
          addedLabelIds removedLabelIds fromTitle toTitle
        }
      }
    }
  }
}`

// Resolve just the issue UUID (needed for commentCreate, which keys off the internal id).
export const ISSUE_ID_QUERY = `query($filter: IssueFilter) { issues(filter: $filter, first: 1) { nodes { id } } }`

// Create a comment (optionally a threaded reply via parentId). Returns the new comment id.
export const COMMENT_CREATE = `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }`

// "ENG-123" → { key: 'ENG', number: 123 }; null if it isn't a valid identifier.
export function parseIdentifier(id: string): { key: string; number: number } | null {
  const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(id)
  return m ? { key: m[1], number: Number(m[2]) } : null
}

export function issuesFilter(identifiers: string[]): Record<string, unknown> | null {
  const byTeam = new Map<string, number[]>()
  for (const id of identifiers) {
    const p = parseIdentifier(id)
    if (!p) continue
    byTeam.set(p.key, [...(byTeam.get(p.key) ?? []), p.number])
  }
  if (!byTeam.size) return null
  const perTeam = [...byTeam].map(([key, numbers]) => ({ team: { key: { eq: key } }, number: { in: numbers } }))
  return perTeam.length === 1 ? perTeam[0] : { or: perTeam }
}
