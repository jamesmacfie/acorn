import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { acpElicitationResponse, normalizeAcpElicitation, normalizeAcpUpdate } from './acpNormalizer'
import { foldSubagentRoster } from '../sessions/stateMachine'
import type { AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'
import capture from './__fixtures__/claudeSubagentWire.json' with { type: 'json' }
import webCapture from './__fixtures__/claudeWebSearchWire.json' with { type: 'json' }
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

describe('a backgrounded subagent, as the wire reports it', () => {
  // The wire of a `run_in_background: true` Agent call, captured on Claude Code 2.1.241: the spawn
  // carries the flag, then a summary lands at launch with status `async_launched`, then the spawning
  // call's own status goes `completed` while the child is only getting started.
  const agentId = 'toolu_bg'
  const meta = (extra: Record<string, unknown>) => ({ _meta: { claudeCode: extra } })

  const launchInput = {
    sessionUpdate: 'tool_call_update', toolCallId: agentId, title: 'Recon the sessions folder',
    rawInput: { subagent_type: 'general-purpose', run_in_background: true },
    ...meta({ toolName: 'Agent' }),
  } as unknown as SessionUpdate
  const launchSummary = {
    sessionUpdate: 'tool_call_update', toolCallId: agentId,
    ...meta({ toolResponse: { agentId: 'a97', agentType: 'general-purpose', status: 'async_launched' } }),
  } as unknown as SessionUpdate
  const spawnCompleted = {
    sessionUpdate: 'tool_call_update', toolCallId: agentId, status: 'completed', ...meta({ toolName: 'Agent' }),
  } as unknown as SessionUpdate

  const rosterFrom = (updates: SessionUpdate[]) => {
    let roster: import('@acorn/protocol/managedAgents.ts').AgentSubagent[] = []
    for (const update of updates) {
      for (const event of normalizeAcpUpdate(update, 'Claude Code')) {
        if (event.type === 'subagent') roster = foldSubagentRoster(roster, event.subagent, 'turn-1', 1)
      }
    }
    return roster
  }

  it('reads the launch receipt as running, not done', () => {
    const roster = rosterFrom([launchInput, launchSummary])
    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({ status: 'running', background: true })
  })

  it('does not let the spawning call’s own completion settle a background child', () => {
    const roster = rosterFrom([launchInput, launchSummary, spawnCompleted])
    expect(roster[0]?.status).toBe('running')
    expect(roster[0]?.background).toBe(true)
  })

  it('still settles when a real completion summary arrives', () => {
    const done = {
      sessionUpdate: 'tool_call_update', toolCallId: agentId,
      ...meta({ toolResponse: { agentId: 'a97', status: 'completed', totalDurationMs: 51000, totalToolUseCount: 22 } }),
    } as unknown as SessionUpdate
    const roster = rosterFrom([launchInput, launchSummary, spawnCompleted, done])
    expect(roster[0]).toMatchObject({ status: 'completed', durationMs: 51000, toolUseCount: 22 })
  })

  it('leaves a foreground subagent settling on its own completion, as before', () => {
    // Same shape without the background flag: the spawning call’s completion is the child’s finish.
    const fgSpawn = {
      sessionUpdate: 'tool_call_update', toolCallId: 'toolu_fg', title: 'Read one file',
      rawInput: { subagent_type: 'general-purpose', run_in_background: false }, ...meta({ toolName: 'Agent' }),
    } as unknown as SessionUpdate
    const fgDone = {
      sessionUpdate: 'tool_call_update', toolCallId: 'toolu_fg', status: 'completed', ...meta({ toolName: 'Agent' }),
    } as unknown as SessionUpdate
    const roster = rosterFrom([fgSpawn, fgDone])
    expect(roster[0]).toMatchObject({ status: 'completed' })
    expect(roster[0]?.background).toBeUndefined()
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

  // Hand-written against the adapter's source rather than the capture, which is the one shape a
  // capture cannot hold: the fixture's subagents both finished inside the 30-second ping interval.
  // This is what @agentclientprotocol/claude-agent-acp 0.54.1 sends for a `tool_progress` message,
  // transcribed from its `case "tool_progress"` in dist/acp-agent.js. The id is the CLI's own,
  // `${toolUseID}-heartbeat-${n}` from the 30-second interval in the 2.1.269 binary.
  const heartbeat = (toolName: string): AgentNormalizedEvent[] => normalizeAcpUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'agent-1-heartbeat-0',
    status: 'in_progress',
    _meta: { claudeCode: { toolName, toolResponse: { elapsedTimeSeconds: 30 } } },
  } as SessionUpdate, 'Claude Code')

  it('drops a progress heartbeat instead of inventing a call for it', () => {
    // `Agent` is the one that hurt: every ping minted a subagent row that never settled.
    expect(heartbeat('Agent')).toEqual([])
    expect(heartbeat('Bash')).toEqual([])
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

// The form an agent sends when it wants an answer rather than a permission. Shaped exactly as Claude
// Code's adapter builds it: a choice per question, a free-text box beside each one, nothing required.
const askUserQuestion = {
  mode: 'form' as const,
  sessionId: 'acp-session',
  toolCallId: 'toolu_1',
  message: 'Which package manager should I use?',
  requestedSchema: {
    type: 'object' as const,
    properties: {
      question_0: {
        type: 'string',
        title: 'Package manager',
        oneOf: [
          { const: 'pnpm', title: 'pnpm — what the repo already uses' },
          { const: 'npm', title: 'npm' },
        ],
      },
      question_0_custom: {
        type: 'string',
        title: 'Other',
        description: 'Type your own answer instead of choosing an option above (optional).',
      },
    },
  },
}

describe('an ACP form elicitation becomes a question', () => {
  it('turns one property into one question, options and all', () => {
    const event = normalizeAcpElicitation('request-1', askUserQuestion)
    expect(event).toMatchObject({
      type: 'request',
      requestId: 'request-1',
      kind: 'question',
      title: 'Which package manager should I use?',
      options: [{ id: 'decline', label: 'Skip' }],
    })
    const questions = event.type === 'request' ? event.questions ?? [] : []
    expect(questions).toHaveLength(2)
    // One question and no description, so the header would only repeat the prompt.
    expect(questions[0]).toEqual({
      id: 'question_0',
      prompt: 'Package manager',
      options: [
        { id: 'pnpm', label: 'pnpm — what the repo already uses' },
        { id: 'npm', label: 'npm' },
      ],
    })
    // The free-text box beside it is a question of its own, with nothing to pick.
    expect(questions[1].options).toBeUndefined()
  })

  it('names the header only when the property carries a prompt of its own', () => {
    const event = normalizeAcpElicitation('request-2', {
      mode: 'form',
      sessionId: 'acp-session',
      message: 'Please answer the following questions.',
      requestedSchema: {
        type: 'object',
        properties: {
          question_0: {
            type: 'string',
            title: 'Auth',
            description: 'Which sign-in method do you want?',
            enum: ['OAuth', 'Magic link'],
          },
        },
      },
    })
    const [question] = event.type === 'request' ? event.questions ?? [] : []
    expect(question).toEqual({
      id: 'question_0',
      header: 'Auth',
      prompt: 'Which sign-in method do you want?',
      options: [{ id: 'OAuth', label: 'OAuth' }, { id: 'Magic link', label: 'Magic link' }],
    })
  })

  it('marks a multi-select question so the card can take more than one answer', () => {
    const event = normalizeAcpElicitation('request-3', {
      mode: 'form',
      sessionId: 'acp-session',
      message: 'Which checks should run?',
      requestedSchema: {
        type: 'object',
        properties: {
          question_0: {
            type: 'array',
            items: { anyOf: [{ const: 'lint', title: 'Lint' }, { const: 'test', title: 'Test' }] },
          },
        },
      },
    })
    const [question] = event.type === 'request' ? event.questions ?? [] : []
    expect(question.multiple).toBe(true)
    expect(question.options).toEqual([{ id: 'lint', label: 'Lint' }, { id: 'test', label: 'Test' }])
  })
})

describe('an answer goes back in the shape the agent asked for', () => {
  it('sends the option value behind the label a person picked', () => {
    // The card answers with labels, and this label is the flattened "value — description" one.
    expect(acpElicitationResponse(askUserQuestion, {
      answers: { question_0: 'pnpm — what the repo already uses', question_0_custom: '' },
    })).toEqual({ action: 'accept', content: { question_0: 'pnpm' } })
  })

  it('keeps a multi-select an array and a free-text answer a string', () => {
    const request = {
      mode: 'form' as const,
      sessionId: 'acp-session',
      message: 'Which checks should run?',
      requestedSchema: {
        type: 'object' as const,
        properties: {
          checks: { type: 'array', items: { enum: ['lint', 'test'] } },
          why: { type: 'string' },
          count: { type: 'integer' },
          rerun: { type: 'boolean' },
        },
      },
    }
    expect(acpElicitationResponse(request, {
      answers: { checks: ['lint', 'test'], why: 'the build is red', count: '3', rerun: 'Yes' },
    })).toEqual({
      action: 'accept',
      content: { checks: ['lint', 'test'], why: 'the build is red', count: 3, rerun: true },
    })
  })

  it('declines on Skip and cancels on a drained turn', () => {
    expect(acpElicitationResponse(askUserQuestion, { optionId: 'decline' })).toEqual({ action: 'decline' })
    expect(acpElicitationResponse(askUserQuestion, { optionId: 'cancel' })).toEqual({ action: 'cancel' })
  })

  it('leaves an unanswered question out rather than sending an empty one', () => {
    expect(acpElicitationResponse(askUserQuestion, { answers: {} })).toEqual({ action: 'accept', content: {} })
  })
})

describe('Claude’s plan-mode handover', () => {
  const exitPlanMode = (update: Partial<SessionUpdate> = {}): AgentNormalizedEvent[] => normalizeAcpUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'plan-1',
    title: 'Ready to code?',
    kind: 'other',
    rawInput: { plan: '# The plan\n\n- step one\n- step two' },
    _meta: { claudeCode: { toolName: 'ExitPlanMode' } },
    ...update,
  } as SessionUpdate, 'Claude Code')

  it('posts the plan as the agent talking, in the markdown it was written in', () => {
    expect(exitPlanMode()[0]).toEqual({
      type: 'assistant_message',
      text: '# The plan\n\n- step one\n- step two',
      subagentId: undefined,
    })
  })

  // The call keeps its title and outcome; without this the plan also sits under it as JSON with every
  // line break spelled out, which is what sent it here in the first place.
  it('leaves the call itself with no parameters to disclose', () => {
    const tool = exitPlanMode().find((event) => event.type === 'tool')
    expect(tool).toMatchObject({ type: 'tool', tool: { title: 'Ready to code?', input: undefined } })
  })

  it('posts nothing for an update, so the plan cannot arrive twice', () => {
    const events = exitPlanMode({ sessionUpdate: 'tool_call_update', status: 'failed' })
    expect(events.some((event) => event.type === 'assistant_message')).toBe(false)
  })

  it('leaves every other tool’s parameters alone', () => {
    expect(toolEvent({
      sessionUpdate: 'tool_call',
      toolCallId: 'bash-1',
      title: 'Bash',
      rawInput: { plan: 'not a plan' },
      _meta: { claudeCode: { toolName: 'Bash' } },
    }).input).toBe('{\n  "plan": "not a plan"\n}')
  })
})

// Claude Code's web tools, against the wire the adapter actually sends
// (./__fixtures__/claudeWebSearchWire.json, Claude Code 2.1.241 with adapter 0.54.1).
//
// The capture settled two things this work was planned against and found to be wrong. The adapter
// does forward structured search results, on `_meta.claudeCode.toolResponse.results`, so a Claude
// card shows the same sources a Codex one does rather than a wall of prose. And a call arrives in
// three or four updates, only one of which carries the request, so the mapping has to say nothing
// on the others rather than say "empty".
describe('Claude web activity, against the captured wire', () => {
  const tools = webCapture.updates.map((update) => toolEvent(update as unknown as SessionUpdate))
  const folded = (id: string) => tools.filter((tool) => tool.id === id)
    .reduce((card, update) => {
      const [item] = buildConversationItems([
        { id: 'a', sessionId: 's', turnId: 't', seq: 1, event: { type: 'tool', tool: card }, searchText: null, createdAt: 0 },
        { id: 'b', sessionId: 's', turnId: 't', seq: 2, event: { type: 'tool', tool: update }, searchText: null, createdAt: 0 },
      ] as AgentEventRecord[])
      if (item.event.type !== 'tool') throw new Error('expected a tool card')
      return item.event.tool
    })

  it('names the row after what the call did, not after the adapter’s quoted title', () => {
    // The adapter titles this one `"Agent Client Protocol specification" (allowed: …)`.
    expect(tools.map((tool) => tool.title))
      .toEqual(['Search web', 'Search web', 'Fetch page', 'Fetch page', 'Fetch page', 'Fetch page', 'Search web', 'Search web'])
  })

  it('keeps the query and the domain filter of a search', () => {
    expect(tools[1].web).toEqual({
      action: {
        type: 'search',
        queries: ['Agent Client Protocol specification'],
        allowedDomains: ['agentclientprotocol.com'],
      },
    })
  })

  it('keeps the URL and the page prompt of a fetch', () => {
    expect(tools[3].web).toEqual({
      action: { type: 'fetch_page', url: 'https://agentclientprotocol.com/protocol/overview', prompt: 'what is a session' },
    })
  })

  it('reads the sources out of the structured tool response rather than out of its prose', () => {
    expect(tools[6].web?.action).toBeUndefined()
    expect(tools[6].web?.results?.slice(0, 2)).toEqual([
      { url: 'https://agentclientprotocol.com/get-started/introduction', title: 'Introduction - Agent Client Protocol' },
      { url: 'https://agentclientprotocol.com/protocol/v1/overview', title: 'Overview - Agent Client Protocol' },
    ])
  })

  it('folds one call’s updates into one card that has both its request and its sources', () => {
    const search = folded(webCapture.updates[0].toolCallId)
    expect(search).toMatchObject({
      title: 'Search web',
      status: 'completed',
      web: { action: { type: 'search', queries: ['Agent Client Protocol specification'] } },
    })
    expect(search.web?.results).toHaveLength(3)
    // The provider's own summary survives beside the structured half, because it is the answer and
    // the sources are only where the answer came from.
    expect(search.output).toContain('Agent Client Protocol')
  })

  it('leaves the fetched page’s text as the call’s output', () => {
    const fetch = folded(webCapture.updates[2].toolCallId)
    expect(fetch).toMatchObject({
      status: 'completed',
      web: { action: { type: 'fetch_page', prompt: 'what is a session' } },
    })
    expect(fetch.output).toContain('a session represents a conversation')
  })
})

describe('Claude web activity, unit cases', () => {
  it('leaves an ACP call that is not Claude’s generic, however it spells its kind', () => {
    // `fetch` is the kind Claude's own web tools use, and `search` is what another harness may well
    // call a repository grep. Neither is evidence about the web on its own.
    expect(toolEvent({
      sessionUpdate: 'tool_call',
      toolCallId: 'other-1',
      title: 'Search the repository',
      kind: 'search',
      rawInput: { query: 'signIn' },
    }).web).toBeUndefined()
    expect(toolEvent({
      sessionUpdate: 'tool_call',
      toolCallId: 'other-2',
      title: 'Fetch',
      kind: 'fetch',
      _meta: { someOtherHarness: { toolName: 'WebSearch' } },
      rawInput: { query: 'signIn' },
    }).web).toBeUndefined()
  })

  it('settles a search that never carried a usable query', () => {
    const tool = toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'web-1',
      status: 'failed',
      _meta: { claudeCode: { toolName: 'WebSearch' } },
      rawInput: { query: '' },
      content: [{ type: 'content', content: { type: 'text', text: 'Search failed: rate limited' } }],
    })
    expect(tool).toMatchObject({
      title: 'Search web',
      status: 'failed',
      web: { action: { type: 'search', queries: [] } },
      output: 'Search failed: rate limited',
    })
  })

  it('says nothing about the web on an update that reported neither request nor sources', () => {
    // Otherwise the completion update, which carries only a status, would blank the query above it.
    expect(toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'web-1',
      status: 'completed',
      _meta: { claudeCode: { toolName: 'WebSearch' } },
    }).web).toBeUndefined()
  })

  it('reads past result entries that are prose rather than sources', () => {
    // `toolResponse.results` mixes the source objects with the model's own text.
    expect(toolEvent({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'web-1',
      _meta: {
        claudeCode: {
          toolName: 'WebSearch',
          toolResponse: {
            query: 'q',
            results: ['prose', { content: [{ title: 'One', url: 'https://example.com/one' }, { title: 'no url' }] }],
          },
        },
      },
    }).web?.results).toEqual([{ url: 'https://example.com/one', title: 'One' }])
  })
})
