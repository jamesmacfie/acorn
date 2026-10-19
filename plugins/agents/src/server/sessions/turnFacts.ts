import type * as schema from '../../node/schema'
import type { AgentNormalizedEvent, AgentToolCall, AgentUsage } from '../../contract/wire.ts'
import { mergeToolCall } from '../../shared/toolFold'
import { modelAtTurn, usageDeltas } from '../data/usageRecords'

// The numbers of one finished turn (docs/managed-agents/turn-facts.md). Pure, so the tests can feed it
// captured harness traffic. TurnFactsWriter reads the inputs and stores the row.

/** The rules' version. Raise it when a rule changes, and the backfill pass rewrites every older row. */
export const TURN_FACTS_VERSION = 1

export type TurnFacts = typeof schema.agentTurnFacts.$inferInsert

export type TurnFactsInput = {
  turn: {
    id: string
    sessionId: string
    ordinal: number
    source: string
    status: string
    startedAt: number | null
    completedAt: number | null
    effectivePolicyJson: string
  }
  taskId: string
  projectId: string | null
  provider: string
  /** The turn's events in sequence order, as stored. A tool call or file change may span several rows. */
  events: ReadonlyArray<{ seq: number; createdAt: number; event: AgentNormalizedEvent }>
  requests: ReadonlyArray<{ kind: string; createdAt: number; resolvedAt: number | null; blocked: boolean }>
  /** The last running total the session reported before the turn: Codex's tokens, or a harness's cost. */
  usageBefore: AgentUsage | null
}

const SETTLED = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const OUTPUT = new Set(['assistant_message', 'reasoning', 'tool'])
const WAITS_ON_PERSON = new Set(['permission', 'question'])

/** The row for a finished turn, or null when the turn never started or hasn't finished. */
export function computeTurnFacts(input: TurnFactsInput): TurnFacts | null {
  const { turn, events } = input
  if (!SETTLED.has(turn.status) || turn.startedAt == null || turn.completedAt == null) return null
  const { startedAt, completedAt } = turn

  // One call per tool id, folded the way the transcript folds it, in the order the calls started.
  const calls = new Map<string, { seq: number; tool: AgentToolCall }>()
  const paths = new Map<string, Set<string>>()
  const subagents = new Set<string>()
  let firstOutputAt: number | null = null
  let peakContextUsed: number | null = null
  let peakContextSize: number | null = null
  let latestContextSize: number | undefined
  const usage: Array<{ sessionId: string; turnId: string | null; provider: string; usage: AgentUsage }> = []
  if (input.usageBefore)
    usage.push({ sessionId: turn.sessionId, turnId: null, provider: input.provider, usage: input.usageBefore })
  const baseline = usage.length

  for (const { seq, createdAt, event } of events) {
    if (firstOutputAt === null && OUTPUT.has(event.type)) firstOutputAt = createdAt
    if (event.type === 'tool') {
      const call = calls.get(event.tool.id)
      if (call) call.tool = mergeToolCall(call.tool, event.tool)
      else calls.set(event.tool.id, { seq, tool: event.tool })
    } else if (event.type === 'file_change' && event.path) {
      // A change with no id is never folded, so each one is an edit of its own.
      const edits = paths.get(event.path) ?? new Set<string>()
      edits.add(event.changeId ?? `seq:${seq}`)
      paths.set(event.path, edits)
    } else if (event.type === 'subagent') {
      subagents.add(event.subagent.id)
    } else if (event.type === 'usage') {
      usage.push({ sessionId: turn.sessionId, turnId: turn.id, provider: input.provider, usage: event.usage })
      latestContextSize = event.usage.contextSize ?? latestContextSize
      const used = event.usage.contextUsed
      if (used !== undefined && (peakContextUsed === null || used > peakContextUsed)) {
        peakContextUsed = used
        peakContextSize = latestContextSize ?? null
      }
    }
  }

  // Runs are counted per stream, because parallel subagents interleave their calls in one turn. The
  // longest run is the first to reach its length.
  type Stream = { key: string | null; repeating: number; repeatingSeq: number; failing: number; failingSeq: number }
  const streams = new Map<string, Stream>()
  let toolFailures = 0
  let longestFailureRun = 0
  let failureRunSeq: number | null = null
  let repeatedCalls = 0
  let longestRepeatRun = 0
  let repeatRunSeq: number | null = null
  for (const { seq, tool } of [...calls.values()].sort((left, right) => left.seq - right.seq)) {
    const streamId = tool.subagentId ?? ''
    const stream = streams.get(streamId) ?? { key: null, repeating: 0, repeatingSeq: seq, failing: 0, failingSeq: seq }
    streams.set(streamId, stream)
    if (tool.status === 'failed' || (tool.exitCode != null && tool.exitCode !== 0)) {
      toolFailures++
      if (stream.failing++ === 0) stream.failingSeq = seq
      if (stream.failing > longestFailureRun) {
        longestFailureRun = stream.failing
        failureRunSeq = stream.failingSeq
      }
    } else stream.failing = 0
    // The repeated-call warning's identity: kind, MCP name, and input. A call with no input repeats nothing.
    const key = tool.input ? `${tool.kind ?? ''}\0${tool.name ?? ''}\0${tool.input}` : null
    if (key !== null && key === stream.key) stream.repeating++
    else {
      stream.repeating = 1
      stream.repeatingSeq = seq
    }
    stream.key = key
    if (stream.repeating >= 3) repeatedCalls++
    if (stream.repeating >= 3 && stream.repeating > longestRepeatRun) {
      longestRepeatRun = stream.repeating
      repeatRunSeq = stream.repeatingSeq
    }
  }

  const deltas = usageDeltas(usage).slice(baseline)
  const sum = (pick: (row: (typeof deltas)[number]) => number | null) =>
    deltas.reduce((total, row) => total + (pick(row) ?? 0), 0)
  const reported = deltas.filter((row) => row.reportedCostUsd !== null)
  const waits = input.requests.filter((request) => WAITS_ON_PERSON.has(request.kind) && !request.blocked)

  return {
    turnId: turn.id,
    sessionId: turn.sessionId,
    taskId: input.taskId,
    projectId: input.projectId,
    ordinal: turn.ordinal,
    firstSeq: events[0]?.seq ?? null,
    provider: input.provider,
    model: modelAtTurn(turn.effectivePolicyJson),
    source: turn.source,
    status: turn.status,
    startedAt,
    completedAt,
    activeMs: Math.max(0, completedAt - startedAt),
    firstOutputMs: firstOutputAt === null ? null : Math.max(0, firstOutputAt - startedAt),
    approvalWaitMs: waits.reduce(
      (total, request) => total + Math.max(0, (request.resolvedAt ?? completedAt) - request.createdAt),
      0,
    ),
    approvals: waits.length,
    toolCalls: calls.size,
    toolFailures,
    longestFailureRun,
    failureRunSeq,
    repeatedCalls,
    repeatRunSeq,
    filesChanged: paths.size,
    filesRewritten: [...paths.values()].filter((edits) => edits.size >= 3).length,
    subagents: subagents.size,
    peakContextUsed,
    contextSize: peakContextUsed === null ? (latestContextSize ?? null) : peakContextSize,
    inputTokens: sum((row) => row.inputTokens),
    outputTokens: sum((row) => row.outputTokens),
    cacheReadTokens: sum((row) => row.cacheReadTokens),
    cacheWriteTokens: sum((row) => row.cacheWriteTokens),
    reportedCostUsd: reported.length ? reported.reduce((total, row) => total + row.reportedCostUsd!, 0) : null,
    version: TURN_FACTS_VERSION,
  }
}
