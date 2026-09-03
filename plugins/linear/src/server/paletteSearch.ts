import { MAX_COMMAND_SEARCH_ITEMS, type CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { LinearProjectIssue } from '../shared/api'
import { linearRailItemId } from '../shared/rail'
import { priorityMeta, sortLinearIssues } from '../shared/triage'

// One matched issue, as the palette draws it.
//
// There is no ranking here, and that is the decision this file records. Linear answers the query
// itself — the route sends the reader's word to the API as part of the same filter that names the
// mapped projects — so re-scoring what came back would be this side second-guessing a provider that
// already ordered its own results
// (docs/future/command-palette/command-catalog.md § Search implementation notes). What is left is
// merging the answers of several connections, and they merge in the order the rail beside them uses:
// priority first, then most recently updated (../shared/triage.ts).

/** The connection an issue came from, carried beside it rather than folded into `LinearProjectIssue`:
 *  the rail's wire shape has no room for a label and does not need one, and this is the only reader
 *  that does. */
export type LinearSearchRow = { issue: LinearProjectIssue; connectionLabel: string }

// The bounds @acorn/protocol/commands.ts holds a row to, applied here because the host drops an
// oversized row outright and a Linear title is free text.
const TITLE = 300
const SUBTITLE = 300
const BADGE = 80

/**
 * One row's display facts and the identity the project surface is addressed by.
 *
 * The id is the rail's own `<connection>:<identifier>`, and that is what stops a collision: a Linear
 * key is unique inside its workspace and no further, so two connected workspaces whose teams share a
 * prefix both have an `ENG-42` (../shared/rail.ts). The surface parses the pair back out, which is
 * how a rail row has always addressed one.
 */
export const linearSearchItem = ({ issue, connectionLabel }: LinearSearchRow): CommandSearchItem => {
  const priority = priorityMeta(issue.priority, issue.priorityLabel)
  return {
    id: linearRailItemId({ connectionId: issue.integrationId, identifier: issue.identifier }),
    title: issue.title.slice(0, TITLE) || issue.identifier,
    subtitle: [issue.identifier, issue.state?.name, connectionLabel]
      .filter(Boolean).join(' · ').slice(0, SUBTITLE),
    ...(priority.level === 'none' ? {} : { badge: priority.label.slice(0, BADGE) }),
    ref: issue.identifier,
  }
}

/** Every connection's answer as one list, in the rail's order, capped at what the host will draw. */
export function linearSearchItems(rows: readonly LinearSearchRow[]): CommandSearchItem[] {
  return sortLinearIssues(rows.map((row) => ({ ...row, priority: row.issue.priority, updatedAt: row.issue.updatedAt })))
    .slice(0, MAX_COMMAND_SEARCH_ITEMS)
    .map(linearSearchItem)
}
