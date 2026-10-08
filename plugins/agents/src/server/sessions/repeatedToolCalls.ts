import type { PluginNotice } from '@acorn/protocol/notices.ts'
import type { AgentNormalizedEvent, AgentSession, AgentToolCall } from '../../contract/wire.ts'
import { AGENT_REPEATED_TOOL_CALL_CHOICES } from '../../shared/sessionDefaults'

// Counts identical tool calls in a row, so the runtime can warn that an agent may be stuck
// (docs/managed-agents/repeated-tool-calls.md). Identical means the same kind, MCP name,
// and input. The title is left out because Claude's first event for a call titles it differently from
// the update that follows.
//
// A call counts once, on the first event that carries its input. Claude's ACP adapter announces a call
// with empty input and fills it in on an update, and Codex repeats the input on completion, so
// counting on the first event of any kind would either miss the input or count a call twice.
//
// Each subagent keeps its own streak, because parallel children interleave their calls in one stream.
// In memory, like the live provider processes: a turn runs inside the node that started it. The engine
// loads this module on the first tool call, so a boot pays nothing for it.

type Streak = { key: string; count: number; title: string }

type TurnCalls = {
  turnId: string
  counted: Set<string>
  streaks: Map<string, Streak>
}

export type RepeatedCall = { count: number; title: string }

export class RepeatedToolCalls {
  readonly #sessions = new Map<string, TurnCalls>()

  /** The streak this event extended, or null when it counted no new call. */
  observe(sessionId: string, turnId: string, tool: AgentToolCall): RepeatedCall | null {
    if (tool.input == null || tool.input === '') return null
    let calls = this.#sessions.get(sessionId)
    if (calls?.turnId !== turnId) {
      calls = { turnId, counted: new Set(), streaks: new Map() }
      this.#sessions.set(sessionId, calls)
    }
    if (calls.counted.has(tool.id)) return null
    calls.counted.add(tool.id)
    const key = `${tool.kind ?? ''}\0${tool.name ?? ''}\0${tool.input}`
    const stream = tool.subagentId ?? ''
    const previous = calls.streaks.get(stream)
    const streak = previous?.key === key
      ? { key, count: previous.count + 1, title: tool.title || previous.title }
      : { key, count: 1, title: tool.title }
    calls.streaks.set(stream, streak)
    return { count: streak.count, title: streak.title }
  }

  /** Drops a session's counts when its turn settles. */
  forget(sessionId: string): void {
    this.#sessions.delete(sessionId)
  }
}

// The smallest streak any choice warns at, so a shorter one doesn't read the setting.
const MIN_WARNING = Math.min(...AGENT_REPEATED_TOOL_CALL_CHOICES.flatMap((choice) => choice.calls ? [choice.calls] : []))

export type RepeatedToolCallPorts = {
  /** The owner's "Warn when an agent repeats a tool call", where 0 is off. */
  limit(): Promise<number>
  record(sessionId: string, turnId: string, event: AgentNormalizedEvent): Promise<unknown>
  session(sessionId: string): Promise<AgentSession>
  notice?(notice: PluginNotice): void
}

/**
 * Warns once per streak when an agent makes the same tool call the owner's number of times in a row:
 * a transcript line and a bell row, never a stop, because waiting and polling tools repeat on purpose.
 * The setting is read only once a streak could reach the smallest choice, so an ordinary turn reads
 * nothing.
 */
export class RepeatedToolCallWarnings {
  readonly #calls = new RepeatedToolCalls()

  constructor(private readonly ports: RepeatedToolCallPorts) {}

  async observe(sessionId: string, turnId: string, tool: AgentToolCall): Promise<void> {
    const repeated = this.#calls.observe(sessionId, turnId, tool)
    if (!repeated || repeated.count < MIN_WARNING) return
    const limit = await this.ports.limit()
    if (!limit || repeated.count !== limit) return
    const call = repeated.title ? `“${repeated.title}”` : 'the same tool call'
    await this.ports.record(sessionId, turnId, {
      type: 'diagnostic',
      level: 'warning',
      message: `The agent has run ${call} ${limit} times in a row with the same input. It may be stuck. If it isn't making progress, stop the turn.`,
    })
    const session = await this.ports.session(sessionId)
    this.ports.notice?.({
      taskId: session.taskId,
      title: 'An agent may be stuck',
      detail: `“${session.title}” has made the same tool call ${limit} times in a row.`,
      target: { kind: 'managed-agent', resourceId: session.id },
    })
  }

  forget(sessionId: string): void {
    this.#calls.forget(sessionId)
  }
}
