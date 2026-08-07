// Linear's wire contract (docs/integrations.md): issues, projects and their comment threads.
//
// Types, route builders and query keys together, following the docker/http convention — the plugin
// that owns the namespace owns the shape of what crosses it. Moved verbatim out of
// @acorn/protocol/api.ts: route strings and query keys are byte-identical, because the persisted
// query cache has no buster and a changed key value would orphan a user's IndexedDB.

export type LinearIssueState = { name: string; type: string; color: string } | null
export type LinearIssueSummary = { identifier: string; title: string; url: string; state: LinearIssueState; assignee: string | null }
export type LinearComment = { id: string; author: string | null; body: string; createdAt: number | null; parentId: string | null }
// One activity-feed entry. `icon` is a kind key (created|state|assignee|label|title) the client
// maps to a glyph; `color` tints state changes.
export type LinearActivity = { id: string; actor: string | null; text: string; createdAt: number | null; icon: string; color?: string }
export type LinearLabel = { id: string; name: string; color: string }
export type LinearAttachment = { id: string; title: string; subtitle: string | null; url: string; sourceType: string | null }
// A lightweight reference to another issue (parent, sub-issue, or relation target).
export type LinearRelatedIssue = { id: string; identifier: string; title: string; state: LinearIssueState }
// A typed link between issues. `kind` is direction-aware (blocked-by is the inverse of blocks);
// `label` is the ready-to-render string ("Blocked by", "Blocks", "Duplicate of", "Related").
export type LinearRelationKind = 'blocks' | 'blocked-by' | 'duplicate' | 'duplicated-by' | 'related'
export type LinearRelation = { id: string; kind: LinearRelationKind; label: string; issue: LinearRelatedIssue }
// New detail fields are OPTIONAL: fresh fetches always populate them, but short-TTL cached rows
// written before this change stay valid (self-heal on next fetch), and the strict public schema
// tolerates their absence. See docs plan. Summary fields (above) stay lean for PR-reference resolution.
export type LinearIssueDetail = LinearIssueSummary & {
  id: string
  description: string | null
  comments: LinearComment[]
  activity: LinearActivity[]
  labels?: LinearLabel[]
  createdAt?: number | null
  updatedAt?: number | null
  creator?: string | null
  priority?: number | null
  priorityLabel?: string | null
  estimate?: number | null
  dueDate?: string | null
  branchName?: string | null
  team?: { key: string; name: string } | null
  project?: { id: string; name: string } | null
  cycle?: { number: number; endsAt: string | null } | null
  attachments?: LinearAttachment[]
  parent?: LinearRelatedIssue | null
  children?: LinearRelatedIssue[]
  relations?: LinearRelation[]
}
export type LinearCommentRequest = { body: string; parentId?: string }
export type LinearIssuesRequest = { identifiers: string[] }
export type LinearIssuesResponse = { issues: LinearIssueSummary[] }
// Linear projects + project-scoped issue browse (docs/workspaces-and-tasks.md — Linear source per repo). Each
// project carries which connection it came from, so the picker can span multiple Linear integrations.
export type LinearProject = { integrationId: string; integrationLabel: string; id: string; name: string }
export type LinearProjectsResponse = { projects: LinearProject[] }
// Browse-row triage fields ride the live /project-issues fetch (internal only, not the public
// schema), so they are required here.
export type LinearProjectIssue = LinearIssueSummary & {
  integrationId: string
  branchName: string | null
  priority: number | null
  priorityLabel: string | null
  updatedAt: number | null
  labels: LinearLabel[]
}
export type LinearProjectIssuesResponse = { issues: LinearProjectIssue[] }

export const linearIssuesRoute = '/v2/p/linear/issues'
export const linearProjectsRoute = '/v2/p/linear/projects'
export const linearProjectIssuesRoute = (integrationId: string, projectIds: string[]) =>
  `/v2/p/linear/project-issues?integration=${encodeURIComponent(integrationId)}&ids=${encodeURIComponent(projectIds.join(','))}`
const connectionQuery = (connectionId?: string) => (connectionId ? `&integration=${encodeURIComponent(connectionId)}` : '')
export const linearIssueRoute = (identifier: string, connectionId?: string) =>
  `/v2/p/linear/issues/${encodeURIComponent(identifier)}?refresh=1${connectionQuery(connectionId)}`
export const linearCommentsRoute = (identifier: string, connectionId?: string) =>
  `/v2/p/linear/issues/${encodeURIComponent(identifier)}/comments${connectionId ? `?integration=${encodeURIComponent(connectionId)}` : ''}`

export const linearIssuesKey = (identifiers: string[]) => ['linear-issues', ...[...identifiers].sort()] as const
export const linearProjectsKey = ['linear-projects'] as const
export const linearProjectIssuesKey = (integrationId: string, projectIds: string[]) =>
  ['linear-project-issues', integrationId, ...[...projectIds].sort()] as const
export const linearIssueKey = (identifier: string, connectionId?: string) =>
  ['linear-issue', connectionId ?? 'unscoped', identifier] as const
