// Agent-surfaces model (docs/terminal-and-agents.md): pure mappers from headless stream-json events to the ONE
// AgentState enum (05 — never redeclared) and to activity-feed items, plus roster composition
// (PTY sessions + workflow steps merged into one list). Unit tested; AgentsPanel is thin glue.
import type { AgentState, TerminalSession } from '../../../core/shared/terminal'
import type { WorkflowRunRow, WorkflowStepRow } from '../../terminal/client/terminalClient'

export type StreamEvent = Record<string, unknown> & { type?: string }

// The 15 §status table: system/init → starting; assistant/tool activity → working; permission
// request → blocked; result → done.
export function streamJsonToAgentState(event: StreamEvent): AgentState {
  switch (event.type) {
    case 'system':
      return 'starting'
    case 'assistant':
    case 'tool_use':
    case 'tool_result':
    case 'user':
      return 'working'
    case 'permission_request':
    case 'permission':
      return 'blocked'
    case 'result':
      return 'done'
    default:
      return 'unknown'
  }
}

export type FeedItem =
  | { kind: 'message'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; text: string }
  | { kind: 'tool_result'; text: string }
  | { kind: 'result'; text: string; costUsd: number | null }
  | { kind: 'status'; text: string }

type ContentBlock = { type?: string; text?: string; thinking?: string; name?: string; input?: unknown; content?: unknown }

const short = (v: unknown, cap = 120): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s && s.length > cap ? `${s.slice(0, cap)}…` : (s ?? '')
}

// One stream-json event → zero or more feed items (an assistant message may carry text + tool_use).
export function streamJsonToFeedItems(event: StreamEvent): FeedItem[] {
  if (event.type === 'system') {
    const model = (event as { model?: string }).model
    return [{ kind: 'status', text: `session started${model ? ` (${model})` : ''}` }]
  }
  if (event.type === 'assistant' || event.type === 'user') {
    const content = ((event as { message?: { content?: ContentBlock[] } }).message?.content ?? []) as ContentBlock[]
    const items: FeedItem[] = []
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) items.push({ kind: 'message', text: block.text.trim() })
      else if (block.type === 'thinking' && block.thinking?.trim()) items.push({ kind: 'thinking', text: short(block.thinking.trim(), 200) })
      else if (block.type === 'tool_use') items.push({ kind: 'tool_call', text: `${block.name ?? 'tool'} ${short(block.input, 80)}` })
      else if (block.type === 'tool_result') items.push({ kind: 'tool_result', text: short(block.content, 120) })
    }
    return items
  }
  if (event.type === 'result') {
    const cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null
    return [{ kind: 'result', text: typeof event.result === 'string' ? event.result : 'done', costUsd: cost }]
  }
  return []
}

export const feedFromEvents = (events: StreamEvent[]): FeedItem[] => events.flatMap(streamJsonToFeedItems)

// Parse a step row's persisted result into its feed + terminal-resume handle.
export function stepFeed(step: WorkflowStepRow): { items: FeedItem[]; costUsd: number | null } {
  try {
    const parsed = JSON.parse(step.resultJson ?? '{}') as { events?: StreamEvent[] }
    return { items: feedFromEvents(parsed.events ?? []), costUsd: step.costUsd }
  } catch {
    return { items: [], costUsd: step.costUsd }
  }
}

// Open-in-terminal (15 P2): the resume command for a step's captured session id, per profile —
// the same seam the headless argv templates use. Runs through the drawer's $SHELL -lc path.
export function resumeCommandFor(step: { profileId: string | null; sessionId: string | null; resumeCommand?: string | null }): string | null {
  if (!step.sessionId) return null
  if (/[^A-Za-z0-9_-]/.test(step.sessionId)) return null // session ids are opaque tokens; never shell metachars
  return typeof step.resumeCommand === 'string' ? step.resumeCommand : null
}

// --- Roster (15 §panel): PTY sessions + workflow steps for one task, merged + ordered:
// needs-you first (blocked/waiting-gate), then active, then the rest, newest first.
export type RosterRow =
  | { kind: 'session'; id: string; title: string; state: AgentState; session: TerminalSession }
  | { kind: 'step'; id: string; title: string; state: AgentState; step: WorkflowStepRow; run: WorkflowRunRow | undefined; gate: boolean }

const stepState = (s: WorkflowStepRow): AgentState =>
  s.status === 'running'
    ? 'working'
    : s.status === 'waiting-gate'
      ? 'blocked'
      : s.status === 'done' || s.status === 'cancelled' || s.status === 'skipped'
        ? 'done'
        : s.status === 'failed' || s.status === 'safety-rail'
          ? 'blocked'
          : 'unknown'

const urgency = (state: AgentState): number => (state === 'blocked' || state === 'permission' ? 0 : state === 'working' || state === 'starting' ? 1 : 2)

export function buildRoster(taskId: string, sessions: TerminalSession[], steps: WorkflowStepRow[], runs: WorkflowRunRow[]): RosterRow[] {
  const runById = new Map(runs.map((r) => [r.id, r]))
  const sessionRows: RosterRow[] = sessions
    .filter((s) => s.taskId === taskId)
    .map((s) => ({ kind: 'session', id: s.id, title: s.title, state: s.agentState, session: s }))
  const stepRows: RosterRow[] = steps
    .filter((s) => s.status !== 'pending' && s.status !== 'skipped')
    .map((s) => ({
      kind: 'step',
      id: s.id,
      title: `${runById.get(s.runId)?.name ?? 'workflow'} · ${s.name}`,
      state: stepState(s),
      step: s,
      run: runById.get(s.runId),
      gate: s.status === 'waiting-gate',
    }))
  return [...sessionRows, ...stepRows].sort((a, b) => {
    const u = urgency(a.state) - urgency(b.state)
    if (u !== 0) return u
    const at = a.kind === 'session' ? a.session.createdAt : a.step.updatedAt
    const bt = b.kind === 'session' ? b.session.createdAt : b.step.updatedAt
    return bt - at
  })
}
