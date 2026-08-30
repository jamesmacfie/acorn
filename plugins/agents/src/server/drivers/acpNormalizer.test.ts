import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { normalizeAcpUpdate } from './acpNormalizer'
import type { AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'
import capture from './__fixtures__/claudeSubagentWire.json' with { type: 'json' }
import { buildConversationItems } from '../../client/sessions/conversationItems'
import type { AgentEventRecord } from '@acorn/protocol/managedAgents.ts'

const toolEvent = (update: SessionUpdate) => {
  const [event] = normalizeAcpUpdate(update, 'Claude Code')
  if (event?.type !== 'tool') throw new Error('expected a tool event')
  return event.tool
}

describe('ACP tool call normalization', () => {
  it('carries inline text content through as the call output', () => {
    expect(toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'bash-1',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'first' } },
        { type: 'content', content: { type: 'text', text: 'second' } },
      ],
    })).toMatchObject({ id: 'bash-1', status: 'completed', output: 'first\nsecond' })
  })

  it('unwraps the markdown fence a command\u2019s output arrives in', () => {
    expect(toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'bash-1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '```console\nline one\nline two\n```' } }],
    }).output).toBe('line one\nline two')
  })

  it('leaves text that is not a whole fence alone', () => {
    expect(toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'bash-1',
      content: [{ type: 'content', content: { type: 'text', text: 'plain output' } }],
    }).output).toBe('plain output')
  })

  it('leaves the status absent when the update does not report one', () => {
    expect(toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'bash-1',
      content: [{ type: 'content', content: { type: 'text', text: 'more output' } }],
    }).status).toBeUndefined()
  })

  it('defaults a new call to pending and maps in_progress to running', () => {
    expect(toolEvent({ sessionUpdate: 'tool_call', toolCallId: 'bash-1', title: 'Bash' }).status).toBe('pending')
    expect(toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'bash-1',
      status: 'in_progress',
    }).status).toBe('running')
  })

  // Without this a running call has nothing to disclose, because output only lands on the completion
  // update, so its card cannot honour the reader's fold setting until the call is over.
  it('carries a call’s parameters through as its input', () => {
    expect(toolEvent({
      sessionUpdate: 'tool_call',
      toolCallId: 'bash-1',
      title: 'ls -la /tmp',
      rawInput: { command: 'ls -la /tmp', description: 'List files' },
    }).input).toBe('{\n  "command": "ls -la /tmp",\n  "description": "List files"\n}')
  })

  it('sends no input for parameters there is nothing to show for', () => {
    for (const rawInput of [undefined, null, {}, 'a string', ['an', 'array'], 42]) {
      expect(toolEvent({ sessionUpdate: 'tool_call', toolCallId: 'bash-1', title: 'Bash', rawInput }).input)
        .toBeUndefined()
    }
  })
})

// Driven by a real capture rather than hand-written shapes. `_meta.claudeCode` is an extension bag, so
// hand-writing what we hope is in it only tests our hopes; the fixture is what Claude Code 2.1.241
// with adapter 0.54.1 actually sent for a two-subagent fan-out.
const captured = capture.updates as SessionUpdate[]
const normalizedCapture = captured.flatMap((update) => normalizeAcpUpdate(update, 'Claude Code'))
const subagents = normalizedCapture.flatMap((event) => event.type === 'subagent' ? [event.subagent] : [])
const tools = normalizedCapture.flatMap((event) => event.type === 'tool' ? [event.tool] : [])

describe('Claude subagent attribution, against the captured wire', () => {
  it('finds both subagents and never emits one as a plain tool call', () => {
    const ids = new Set(subagents.map((subagent) => subagent.id))
    expect(ids.size).toBe(2)
    // A spawning call belongs to the subagent it starts, so no `Agent` call is left unattributed.
    for (const id of ids) {
      expect(tools.filter((tool) => tool.id === id).every((tool) => tool.subagentId === id)).toBe(true)
    }
  })

  it('attributes every tool call a subagent made to that subagent', () => {
    const ids = new Set(subagents.map((subagent) => subagent.id))
    const attributed = tools.filter((tool) => tool.subagentId && !ids.has(tool.id))
    // Seven inner calls in the capture: ToolSearch, Bash and Read across the two subagents.
    expect(attributed.length).toBeGreaterThanOrEqual(6)
    for (const tool of attributed) expect(ids.has(tool.subagentId!)).toBe(true)
  })

  it('folds the completion summary onto the subagent that produced it', () => {
    // Field by field, because the summary update carries no title and the titled update carries no
    // summary. Whoever consumes these merges them; here we only check both halves arrived.
    const summaries = subagents.filter((subagent) => subagent.providerAgentRef)
    expect(summaries.length).toBe(2)
    for (const summary of summaries) {
      expect(summary).toMatchObject({ status: 'completed', role: 'general-purpose' })
      expect(summary.model).toBeTruthy()
      expect(summary.usage?.contextUsed).toBeGreaterThan(0)
      expect(summary.durationMs).toBeGreaterThan(0)
      expect(summary.toolUseCount).toBeGreaterThan(0)
    }
  })

  it('titles each row from the spawning call\u2019s description', () => {
    expect(subagents.flatMap((subagent) => subagent.title ? [subagent.title] : []))
      .toEqual(['Read alpha.txt first line', 'Read beta.txt first line'])
  })

  it('never seeds a row with the bare tool name', () => {
    // The initial tool_call is titled "Task" and the refining update replaces it with the description.
    // Passing the placeholder through would flicker every row through "Task" first.
    expect(subagents.map((subagent) => subagent.title)).not.toContain('Task')
    expect(subagents.map((subagent) => subagent.title)).not.toContain('Agent')
  })

  it('leaves the parent\u2019s own prose unattributed', () => {
    // This CLI never forwards a subagent's own text, so anything tagged here would be a bug in the
    // reader rather than a feature of the wire.
    const prose = normalizedCapture.filter((event): event is Extract<AgentNormalizedEvent, { type: 'assistant_message' }> =>
      event.type === 'assistant_message')
    expect(prose.length).toBeGreaterThan(0)
    expect(prose.every((event) => event.subagentId === undefined)).toBe(true)
  })
})

describe('Claude subagent attribution, unit cases', () => {
  const spawn = (toolName: string): AgentNormalizedEvent[] => normalizeAcpUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'agent-1',
    title: 'Task',
    kind: 'think',
    _meta: { claudeCode: { toolName } },
  } as SessionUpdate, 'Claude Code')

  it('treats the older Task name as the same tool', () => {
    for (const toolName of ['Agent', 'Task']) {
      expect(spawn(toolName)[0]).toMatchObject({ type: 'subagent', subagent: { id: 'agent-1', status: 'pending' } })
    }
  })

  it('leaves an unrelated tool alone', () => {
    const events = normalizeAcpUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'bash-9',
      title: 'ls',
      _meta: { claudeCode: { toolName: 'Bash' } },
    } as SessionUpdate, 'Claude Code')
    expect(events.some((event) => event.type === 'subagent')).toBe(false)
    expect(events[0]).toMatchObject({ type: 'tool', tool: { id: 'bash-9', subagentId: undefined } })
  })

  it('ignores a foreign harness\u2019s own metadata namespace', () => {
    const events = normalizeAcpUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Something',
      _meta: { someOtherHarness: { toolName: 'Agent', parentToolUseId: 'x' } },
    } as SessionUpdate, 'Other')
    expect(events.some((event) => event.type === 'subagent')).toBe(false)
    expect(events[0]).toMatchObject({ type: 'tool', tool: { subagentId: undefined } })
  })

  it('reads a failed subagent out of the summary rather than the status', () => {
    const [event] = normalizeAcpUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'agent-1',
      _meta: { claudeCode: { toolResponse: { agentId: 'a1', status: 'error' } } },
    } as SessionUpdate, 'Claude Code')
    expect(event).toMatchObject({ type: 'subagent', subagent: { status: 'failed', providerAgentRef: 'a1' } })
  })
})

describe('the captured fan-out as a transcript', () => {
  // End to end over the real capture: normalize every update, then project it the way the transcript
  // does. This is what catches an attribution the projection cannot act on, which unit cases on either
  // side of the seam both pass.
  const projected = () => {
    let seq = 0
    const records: AgentEventRecord[] = normalizedCapture.map((event) => ({
      id: String(++seq),
      sessionId: 'session',
      turnId: 'turn-1',
      seq,
      schemaVersion: 1,
      event,
      searchText: null,
      createdAt: seq,
    }))
    return buildConversationItems(records)
  }

  it('leaves no orphan tool card at the top level', () => {
    // The bug: the adapter leaves a subagent's mid-call update untagged, and a per-stream fold could not
    // place it, so seven cards appeared at the top titled with a raw tool id.
    const orphans = projected().filter((item) =>
      item.event.type === 'tool' && item.event.tool.title.startsWith('toolu_'))
    expect(orphans).toEqual([])
  })

  it('puts one card per subagent at the top and the rest inside them', () => {
    const items = projected()
    const cards = items.filter((item) => item.event.type === 'subagent')
    expect(cards).toHaveLength(2)
    // Every tool the two subagents ran, nested: three for one, four for the other, plus each spawn call.
    expect(cards.map((card) => card.children?.length)).toEqual([4, 5])
    expect(items.some((item) => item.event.type === 'tool')).toBe(false)
  })
})
