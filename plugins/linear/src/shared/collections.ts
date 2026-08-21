import type {
  PluginCollectionEnumValue,
  PluginCollectionResponse,
  PluginCollectionRowBody,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import type { LinearProjectIssue } from './api'
import { priorityMeta, type PriorityLevel } from './triage'

// Linear issues expressed as a collection (@acorn/protocol/collections.ts): typed records the host
// draws with its own components, so they can sit on one board beside github's pull requests without
// either plugin knowing the other exists.
//
// The manifest declares no static schema, because a Linear status is `{ name, type, color }` where
// only `type` is stable across workspaces (docs/dashboards.md § Self-describing responses, and the
// cold case).

export const LINEAR_ISSUES_COLLECTION_ID = 'issues-mine'

// Linear's workflow-state types, the only part of a status that means the same thing in every
// workspace and therefore the only part a cross-source board can group by. Declaration order is group
// order: left to right the way an issue moves.
const STATE_TYPES = [
  { id: 'triage', label: 'Triage', tone: 'warn' },
  { id: 'backlog', label: 'Backlog', tone: 'muted' },
  { id: 'unstarted', label: 'Todo', tone: 'muted' },
  { id: 'started', label: 'In progress', tone: 'accent' },
  { id: 'completed', label: 'Done', tone: 'ok' },
  { id: 'canceled', label: 'Cancelled', tone: 'muted' },
] as const satisfies PluginCollectionEnumValue[]

const PRIORITIES = [
  { id: 'urgent', label: 'Urgent', tone: 'bad' },
  { id: 'high', label: 'High', tone: 'warn' },
  { id: 'medium', label: 'Medium', tone: 'accent' },
  { id: 'low', label: 'Low', tone: 'muted' },
  { id: 'none', label: 'No priority', tone: 'muted' },
] as const satisfies { id: PriorityLevel; label: string; tone: string }[]

/** The workspace's own name for each state type, where these issues showed one. First name wins: two
 *  connected workspaces that disagree about what `started` is called cannot both be right on one
 *  column header, and the grouping, which is what the column is, is the type either way. */
const stateValues = (issues: readonly LinearProjectIssue[]): PluginCollectionEnumValue[] => {
  const named = new Map<string, string>()
  for (const issue of issues) {
    if (issue.state && !named.has(issue.state.type)) named.set(issue.state.type, issue.state.name)
  }
  return STATE_TYPES.map((value) => ({ ...value, label: named.get(value.id) ?? value.label }))
}

const schemaFor = (issues: readonly LinearProjectIssue[]): PluginCollectionSchema => ({
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'identifier', name: 'Issue', type: 'text' },
    { id: 'status', name: 'Status', type: 'enum', role: 'status', values: stateValues(issues) },
    { id: 'priority', name: 'Priority', type: 'enum', values: [...PRIORITIES] },
    { id: 'assignee', name: 'Assignee', type: 'person', role: 'assignee' },
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
    { id: 'url', name: 'Link', type: 'link', role: 'url' },
  ],
})

/** One issue as a row. `id` carries the connection: Linear team keys make `ENG-42` look globally
 *  unique and it is not (docs/integrations.md § Linear; the same reason shared/rail.ts's row id does). */
const rowFor = (issue: LinearProjectIssue): PluginCollectionRowBody => ({
  id: `${issue.integrationId}:${issue.identifier}`,
  values: {
    title: issue.title,
    identifier: issue.identifier,
    // The type, not the name: the name is the label on the column and lives on the field, the type is
    // what the row belongs to. Writing the name here would make every workspace its own set of groups.
    status: issue.state?.type ?? null,
    priority: priorityMeta(issue.priority, issue.priorityLabel).level,
    assignee: issue.assignee,
    updated: issue.updatedAt,
    url: issue.url,
  },
  // Linear's detail pane needs a routed project and this row has none, which is why the verb is
  // `openUrl`: it is in the context-free set precisely because it needs nothing from its click site.
  //
  // That does not mean the click leaves the app: the host resolves the URL against the recognisers
  // before opening a browser (docs/dashboards.md § Provenance, and what a row may not claim).
  action: { verb: 'openUrl', url: issue.url },
})

export const linearIssuesCollection = (issues: readonly LinearProjectIssue[]): PluginCollectionResponse => ({
  schema: schemaFor(issues),
  rows: issues.map(rowFor),
})
