// Agent-surfaces model (docs/terminal-and-agents.md): pure mappers from headless stream-json events
// to the AgentState enum and to activity-feed items.
//
// The roster that merged PTY sessions with workflow steps went with the sidebar section that drew it
// (docs/future/workflows/README.md, decision 14): a run's steps are the run pane's, and a PTY session
// is the terminal drawer's.
import type { AgentState } from '@acorn/protocol/terminal.ts'

export type StreamEvent = Record<string, unknown> & { type?: string }

// system/init to starting, assistant and tool activity to working, permission request to blocked,
// result to done.
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
