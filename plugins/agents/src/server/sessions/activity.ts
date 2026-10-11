// The one projection from ledger items to the public activity items (docs/managed-agents/session-events.md
// § Activity). The frames and the rebuild read both go through it, so they can't disagree. Loaded on the
// first activity event or read (./lifecycle.ts), to stay inside the service boot budget.
import { and, desc, eq, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { AgentNormalizedEvent, AgentSubagent, AgentToolCall } from '../../contract/wire.ts'
import {
  MAX_ACTIVITY_SUBAGENTS,
  MAX_ACTIVITY_TOOLS,
  type AgentActivityEvent,
  type AgentActivityState,
  type AgentActivitySubagent,
  type AgentActivityTool,
} from '../../contract/lifecycle'
import { parseJson } from './rowMapping'

type ActivityItem = AgentActivityEvent extends infer Item
  ? Item extends unknown
    ? Omit<Item, 'taskId' | 'sessionId'>
    : never
  : never

const MAX_TITLE = 200
const MAX_KIND = 40
const MAX_PATHS = 8
const MAX_PATH = 1024

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

export function activityTool(tool: AgentToolCall, turnId: string | null): AgentActivityTool {
  return {
    toolCallId: tool.id,
    turnId,
    kind: tool.kind ? clip(tool.kind, MAX_KIND) : null,
    // Codex and Claude title a command with its command line. Commands stay with the hooks.
    title: tool.kind === 'execute' ? 'Command' : clip(tool.title || tool.name || 'Tool', MAX_TITLE),
    status: tool.status ?? 'pending',
    paths: (tool.paths ?? []).slice(0, MAX_PATHS).map((path) => clip(path, MAX_PATH)),
    subagentId: tool.subagentId ?? null,
  }
}

export function activitySubagent(subagent: AgentSubagent): AgentActivitySubagent {
  return {
    subagentId: subagent.id,
    turnId: subagent.turnId,
    title: clip(subagent.title, MAX_TITLE),
    role: subagent.role ? clip(subagent.role, MAX_KIND) : null,
    status: subagent.status,
    background: subagent.background ?? false,
  }
}

/**
 * The frame an event earns, or `null`. Only edges: a tool call or subagent update that reports a
 * status (absent means unchanged, so an output chunk sends nothing), and a usage report that carries a
 * context count. `stored` is the call's folded state and `roster` the session's folded subagents, both
 * as committed with the event.
 */
export function activityItem(
  event: AgentNormalizedEvent,
  stored: AgentNormalizedEvent,
  roster: readonly AgentSubagent[],
  turnId: string | null,
): ActivityItem | null {
  if (event.type === 'tool' && stored.type === 'tool' && event.tool.status) {
    return { kind: 'tool', tool: activityTool(stored.tool, turnId) }
  }
  if (event.type === 'subagent' && event.subagent.status) {
    const subagent = roster.find((candidate) => candidate.id === event.subagent.id)
    return subagent ? { kind: 'subagent', subagent: activitySubagent(subagent) } : null
  }
  if (event.type === 'usage' && (event.usage.contextUsed != null || event.usage.contextSize != null)) {
    return {
      kind: 'usage',
      usage: { contextUsed: event.usage.contextUsed ?? null, contextSize: event.usage.contextSize ?? null },
    }
  }
  return null
}

/** The frames' items rebuilt from the ledger: each call's newest stored row is its whole state. */
export async function readActivity(
  db: PluginDatabase,
  ref: { taskId: string; sessionId: string },
): Promise<AgentActivityState | null> {
  const [row] = await db
    .select({ subagentsJson: schema.agentSessions.subagentsJson })
    .from(schema.agentSessions)
    .where(and(eq(schema.agentSessions.id, ref.sessionId), eq(schema.agentSessions.taskId, ref.taskId)))
    .limit(1)
  if (!row) return null
  const toolRows = await db
    .select({ turnId: schema.agentEvents.turnId, eventJson: schema.agentEvents.eventJson })
    .from(schema.agentEvents)
    .where(
      and(
        eq(schema.agentEvents.sessionId, ref.sessionId),
        sql`json_extract(${schema.agentEvents.eventJson}, '$.type') = 'tool'`,
      ),
    )
    .orderBy(desc(schema.agentEvents.seq))
    // Two rows per call at most, the opener and its folded state, so this holds the newest calls.
    .limit(MAX_ACTIVITY_TOOLS * 2)
  const tools = new Map<string, AgentActivityTool>()
  for (const { turnId, eventJson } of toolRows) {
    const event = JSON.parse(eventJson) as AgentNormalizedEvent
    if (event.type !== 'tool' || tools.has(event.tool.id)) continue
    if (tools.size === MAX_ACTIVITY_TOOLS) break
    tools.set(event.tool.id, activityTool(event.tool, turnId))
  }
  const subagents = parseJson<AgentSubagent[]>(row.subagentsJson, [])
  return {
    ...ref,
    tools: [...tools.values()].reverse(),
    subagents: subagents
      .toSorted((a, b) => a.updatedAt - b.updatedAt)
      .slice(-MAX_ACTIVITY_SUBAGENTS)
      .map(activitySubagent),
    usage: {
      contextUsed: await latestUsage(db, ref.sessionId, 'contextUsed'),
      contextSize: await latestUsage(db, ref.sessionId, 'contextSize'),
    },
  }
}

async function latestUsage(
  db: PluginDatabase,
  sessionId: string,
  field: 'contextUsed' | 'contextSize',
): Promise<number | null> {
  const path = `$.usage.${field}`
  const [row] = await db
    .select({ value: sql<number>`json_extract(${schema.agentEvents.eventJson}, ${path})` })
    .from(schema.agentEvents)
    .where(
      and(
        eq(schema.agentEvents.sessionId, sessionId),
        sql`json_extract(${schema.agentEvents.eventJson}, '$.type') = 'usage'`,
        sql`json_extract(${schema.agentEvents.eventJson}, ${path}) IS NOT NULL`,
      ),
    )
    .orderBy(desc(schema.agentEvents.seq))
    .limit(1)
  return row ? Number(row.value) : null
}
