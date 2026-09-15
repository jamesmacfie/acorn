import { parseRailItemId, railItemId, type PluginRailItem } from '@acorn/protocol/api.ts'
import type { LinearProjectIssue } from './api'

// The encoding is the host's (protocol/api.ts § railItemId); these two name its halves for Linear. The
// connection has to travel with the identifier because Linear issue keys are not globally unique
// across connections (docs/integrations.md § Linear).
export type LinearRailTarget = { connectionId: string; identifier: string }

export const linearRailItemId = (target: LinearRailTarget): string =>
  railItemId(target.connectionId, target.identifier)

export function parseLinearRailItemId(value: string): LinearRailTarget | null {
  const parts = parseRailItemId(value)
  return parts && { connectionId: parts[0], identifier: parts[1] }
}

// One rail row, including the promotion seed the host acts on when the row's +Task is used.
//
// The `task` block asks less than rollbar's because an issue carries `branchName`, Linear's own
// suggestion, so the row names the branch and the host's modal has nothing left to demand.
// `origin: 'linear'` must stay: `ownsTaskOrigin` matches the exact plugin id, and changing it splits
// one provider's task history in two.
// `connection` is the name of the workspace the issue came from, and is passed only when the list
// holds rows from more than one connected Linear. Two workspaces can both have an ENG-42, so without
// it those rows read identically; with one connection it would be a column repeating itself.
export function linearRailItem(issue: LinearProjectIssue, connection?: string): PluginRailItem {
  // Title, key, status, row actions, the shape github's PR list has. Two columns, so the reserved tracks
  // leave room to read the title. Assignee, priority, and labels are a click away in the detail pane.
  //
  // Positional, and never filtered: an issue with no state keeps the empty cell, or its key slides
  // under the next row's state.
  return {
    id: linearRailItemId({ connectionId: issue.integrationId, identifier: issue.identifier }),
    title: issue.title,
    fields: connection
      ? [issue.identifier, issue.state?.name ?? '', connection]
      : [issue.identifier, issue.state?.name ?? ''],
    task: {
      origin: 'linear',
      title: `${issue.identifier} ${issue.title}`,
      branch: issue.branchName || issue.identifier.toLowerCase(),
      // The issue's description, already capped by the route (docs/workflows.md § Starting a run).
      // Nothing draws it; a workflow started from this row's menu puts it in its `issue` input.
      ...(issue.description ? { body: issue.description } : {}),
      link: {
        connectionId: issue.integrationId,
        identifier: issue.identifier,
        ref: { displayId: issue.identifier, url: issue.url },
      },
    },
  }
}
