// "Saved database queries" in the agent composer, as the two routes the manifest's `agentContexts`
// descriptor names.
//
// This used to be a client contribution over rows the renderer already held. What travels here is SQL a
// person wrote down and a note they wrote beside it. No credential enters this file: the connection URL
// is resolved per connect in main/database.ts and never persisted, so there's nothing to redact.
//
// What the host doesn't let this file decide: `source` (bound from the plugin id), the capture time,
// and the byte measurement the 512 KiB composer ceiling is checked against.
import { MAX_PLUGIN_AGENT_CONTEXT_OPTIONS } from '@acorn/protocol/agentContext.ts'
import type { AgentContextOption, PluginAgentContextSnapshotBody } from '@acorn/protocol/agentContext.ts'
import type { DbSavedQuery } from '../shared/database'

// The composer's option list is capped by the host's parser. Bound it here too, so a project with
// thousands of saved queries answers a list rather than one the host silently rejects whole.
export const MAX_CONTEXT_QUERIES = MAX_PLUGIN_AGENT_CONTEXT_OPTIONS

// A single query's SQL is bounded going into the table (20k), and this is the second bound: what one
// snapshot may contribute to a prompt.
const MAX_SNAPSHOT_SQL = 20_000

export const savedQueryOption = (query: DbSavedQuery): AgentContextOption => ({
  id: query.id,
  label: query.name,
  description: query.notes || query.sql.slice(0, 120),
})

export const savedQuerySnapshot = (query: DbSavedQuery): PluginAgentContextSnapshotBody => ({
  // Stable rather than time-stamped: the composer replaces a snapshot by contextId, so re-capturing the
  // same query updates it instead of attaching it twice. The compiled contribution this replaces put
  // `Date.now()` here, so every capture stacked up in a draft. The host prefixes the plugin id.
  contextId: query.id,
  label: `Database · ${query.name}`,
  content: [
    `# Saved database query: ${query.name}`,
    query.notes ?? '',
    '```sql',
    query.sql.slice(0, MAX_SNAPSHOT_SQL),
    '```',
  ].join('\n'),
  resourceId: query.id,
  provenance: 'Saved query text and notes; database URL and credentials never leave the node',
  deepLink: { pane: 'database' },
  freshness: 'live',
  sensitivity: 'private',
})
