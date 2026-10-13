import { parseRailItemId, railItemId, type PluginRailItem } from '@acorn/protocol/api.ts'
import type { LinearProjectIssue } from './api'

// The encoding is the host's (protocol's `railItemId`); these two name its halves for Linear. The
// connection has to travel with the identifier because Linear issue keys are not globally unique
// across connections (docs/integrations/linear.md § Linear).
export type LinearRailTarget = { connectionId: string; identifier: string }

export const linearRailItemId = (target: LinearRailTarget): string => railItemId(target.connectionId, target.identifier)

export function parseLinearRailItemId(value: string): LinearRailTarget | null {
  const parts = parseRailItemId(value)
  return parts && { connectionId: parts[0], identifier: parts[1] }
}

// One rail row, including the promotion seed the host acts on when the row's +Task is used.
//
// The `task` block asks less than rollbar's because an issue carries `branchName`, Linear's own
// suggestion, so the row names the branch and the host's modal has nothing left to demand.
// `connection` is the name of the workspace the issue came from, and is passed only when the list
// holds rows from more than one connected Linear. Two workspaces can both have an ENG-42, so without
// it those rows read identically; with one connection it would be a column repeating itself.
// Linear's own state vocabulary, which is a fixed API value rather than the workflow name a team
// chose, so this map holds for every workspace. The rail source filters completed and canceled out
// (../server/index.ts), and they are here because the same row shape is reachable from a link.
//
// It earns its place twice over: the icon gives the expanded list a leading mark, and it is the only
// thing a collapsed row has room to show beside the key.
//
// Every name here is in the host's eager icon set. The census only scans names spelled in the client
// tree, so a name reached through this map is not checked for us: picking one the set lacks would
// render the word `circle-help` in a frame rather than a glyph
// (client-core/kit/tokens/iconNodes.eager.json, client-core/scripts/icon-census.mjs).
const STATE_GLYPH: Record<string, string> = {
  triage: 'circle-question-mark',
  backlog: 'circle-dashed',
  unstarted: 'circle',
  started: 'circle-dot',
  completed: 'circle-check',
  canceled: 'circle-x',
}

// What a task promoted from an issue starts with, from the rail's +Task and from the browser
// extension's handoff alike. Linear's own suggested branch, or the identifier when it has none.
// `origin: 'linear'` must stay: `ownsTaskOrigin` matches the exact plugin id, and changing it splits
// one provider's task history in two.
export const linearTaskFields = (issue: { identifier: string; title: string; branchName?: string | null }) => ({
  origin: 'linear',
  title: `${issue.identifier} ${issue.title}`,
  branch: issue.branchName || issue.identifier.toLowerCase(),
})

export function linearRailItem(issue: LinearProjectIssue, connection?: string): PluginRailItem {
  // The state glyph, the title, and the key. One column, because the host reserves a track per field
  // and a second one leaves the title a few letters in a 300-pixel list. The state's name would repeat
  // what the glyph already says. Assignee, priority, and labels are a click away in the detail pane.
  return {
    id: linearRailItemId({ connectionId: issue.integrationId, identifier: issue.identifier }),
    title: issue.title,
    fields: connection ? [issue.identifier, connection] : [issue.identifier],
    ...(issue.state?.type && STATE_GLYPH[issue.state.type] ? { icon: STATE_GLYPH[issue.state.type] } : {}),
    // The key, not the first of `fields`, even though they are the same string today. `fields` is
    // what lines up in columns; this is what identifies the row when there is room for nothing else.
    short: issue.identifier,
    task: {
      ...linearTaskFields(issue),
      // The issue's description, already capped by the route (docs/workflows/starting-runs.md § Starting a run).
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
