import { describe, expect, it } from 'vitest'
import type { AgentEventRecord } from '@acorn/protocol/managedAgents.ts'
import { buildConversationItems, findSubagentItem, visibleConversationItems } from './conversationItems'

const event = (seq: number, value: AgentEventRecord['event'], turnId: string | null = 'turn'): AgentEventRecord => ({
  id: String(seq),
  sessionId: 'session',
  turnId,
  seq,
  schemaVersion: 1,
  event: value,
  searchText: null,
  createdAt: seq,
})

describe('conversation projection', () => {
  it('coalesces only matching append deltas', () => {
    const items = buildConversationItems([
      event(1, { type: 'assistant_message', text: 'hello', messageId: 'a' }),
      event(2, { type: 'assistant_message', text: ' world', messageId: 'a', append: true }),
      event(3, { type: 'assistant_message', text: 'separate', messageId: 'b', append: true }),
    ])
    expect(items.map((item) => item.event.type === 'assistant_message' ? item.event.text : '')).toEqual([
      'hello world',
      'separate',
    ])
  })

  it('folds a tool call\u2019s updates into one card and keeps the last reported status', () => {
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'bash-1', title: 'Bash', kind: 'execute', status: 'pending' } }),
      event(2, { type: 'assistant_message', text: 'running it', messageId: 'a' }),
      event(3, { type: 'tool', tool: { id: 'bash-1', title: '', status: 'completed', output: 'done\n' } }),
      // Output with no status: ACP only sends a status when it changes, so this must not reopen the run.
      event(4, { type: 'tool', tool: { id: 'bash-1', title: '', output: 'done\ntrailing' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['tool', 'assistant_message'])
    const [card] = items
    expect(card.event.type === 'tool' && card.event.tool).toEqual({
      id: 'bash-1',
      parentId: undefined,
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      input: undefined,
      output: 'done\ntrailing',
      paths: undefined,
    })
    expect(card.lastSeq).toBe(4)
  })

  it('folds a turn\u2019s usage updates into one line, including a trailing one with no turn', () => {
    const items = buildConversationItems([
      event(1, { type: 'usage', usage: { contextUsed: 94_358, contextSize: 1_000_000 } }),
      event(2, { type: 'usage', usage: { cost: { amount: 2.8301, currency: 'USD' } } }, null),
    ])
    expect(items.length).toBe(1)
    const [line] = items
    expect(line.event.type === 'usage' && line.event.usage).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      cachedInputTokens: undefined,
      contextUsed: 94_358,
      contextSize: 1_000_000,
      cost: { amount: 2.8301, currency: 'USD' },
    })
  })

  it('starts a new usage line for a new turn', () => {
    const items = buildConversationItems([
      event(1, { type: 'usage', usage: { contextUsed: 10 } }, 'turn-1'),
      event(2, { type: 'usage', usage: { contextUsed: 20 } }, 'turn-2'),
    ])
    expect(items.map((item) => item.event.type === 'usage' ? item.event.usage.contextUsed : null)).toEqual([10, 20])
  })

  it('folds full plan snapshots within a turn and keeps another turn separate', () => {
    const items = buildConversationItems([
      event(1, {
        type: 'plan',
        entries: [
          { id: 'plan-0', text: 'Inspect the boundary', status: 'in_progress' },
          { id: 'plan-1', text: 'Make the change', status: 'pending' },
        ],
      }, 'turn-1'),
      event(2, { type: 'assistant_message', text: 'The boundary is clear.', messageId: 'a' }, 'turn-1'),
      event(3, {
        type: 'plan',
        entries: [
          { id: 'plan-0', text: 'Inspect the boundary', status: 'completed' },
          { id: 'plan-1', text: 'Make the change', status: 'in_progress' },
        ],
      }, 'turn-1'),
      event(4, {
        type: 'plan',
        entries: [{ id: 'plan-0', text: 'Review the result', status: 'in_progress' }],
      }, 'turn-2'),
    ])

    expect(items.map((item) => item.event.type)).toEqual(['plan', 'assistant_message', 'plan'])
    expect(items[0].event.type === 'plan' && items[0].event.entries).toEqual([
      { id: 'plan-0', text: 'Inspect the boundary', status: 'completed' },
      { id: 'plan-1', text: 'Make the change', status: 'in_progress' },
    ])
    expect(items[0].lastSeq).toBe(3)
    expect(items[2].turnId).toBe('turn-2')
  })

  it('nests a subagent\u2019s run inside its own card', () => {
    const items = buildConversationItems([
      event(1, { type: 'assistant_message', text: 'delegating', messageId: 'a' }),
      event(2, { type: 'subagent', subagent: { id: 'sub-1', title: 'Read alpha', status: 'running' } }),
      // The spawning call belongs to the subagent it starts, so the prompt and the report read as the
      // subagent's own rather than as a tool the parent ran.
      event(3, { type: 'tool', tool: { id: 'sub-1', title: 'Read alpha', input: 'go', subagentId: 'sub-1' } }),
      event(4, { type: 'tool', tool: { id: 'grep-1', title: 'Grep', status: 'pending', subagentId: 'sub-1' } }),
      event(5, { type: 'tool', tool: { id: 'own-1', title: 'Bash', status: 'pending' } }),
      event(6, { type: 'subagent', subagent: { id: 'sub-1', status: 'completed', model: 'opus' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['assistant_message', 'subagent', 'tool'])
    const [, card] = items
    expect(card.event.type === 'subagent' && card.event.subagent)
      .toMatchObject({ id: 'sub-1', title: 'Read alpha', status: 'completed', model: 'opus' })
    expect(card.children?.map((child) => child.event.type === 'tool' ? child.event.tool.id : null))
      .toEqual(['sub-1', 'grep-1'])
    expect(card.lastSeq).toBe(6)
  })

  it('folds an untagged mid-call update into the subagent that opened the call', () => {
    // Claude's adapter tags a subagent's `tool_call` and its final `tool_call_update` with the owning
    // agent and leaves the one in between untagged. This used to be looked up per stream, so that
    // middle update could not find its card and opened a second one at the top level, titled with the
    // raw tool id because a mid-call update carries no title either. Seven of them in a two-subagent
    // capture.
    const items = buildConversationItems([
      event(1, { type: 'subagent', subagent: { id: 'sub-1', title: 'Worker' } }),
      event(2, { type: 'tool', tool: { id: 'read-1', title: 'Read alpha.txt', status: 'pending', subagentId: 'sub-1' } }),
      event(3, { type: 'tool', tool: { id: 'read-1', title: '', output: 'alpha' } }),
      event(4, { type: 'tool', tool: { id: 'read-1', title: '', status: 'completed', subagentId: 'sub-1' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['subagent'])
    expect(items[0].children).toHaveLength(1)
    expect(items[0].children?.[0].event.type === 'tool' && items[0].children?.[0].event.tool)
      .toMatchObject({ id: 'read-1', title: 'Read alpha.txt', status: 'completed', output: 'alpha' })
  })

  it('keeps a tool card in the stream that opened it, whichever way the attribution drifts', () => {
    // The mirror case: an update that gains an attribution the opening call did not have must not open a
    // phantom card inside the subagent. A tool call id is provider-minted and unique, so the same id is
    // always the same call, and whoever opened it owns it.
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'bash-1', title: 'Parent bash', status: 'pending' } }),
      event(2, { type: 'subagent', subagent: { id: 'sub-1', title: 'Worker' } }),
      event(3, { type: 'tool', tool: { id: 'bash-1', title: '', status: 'completed', subagentId: 'sub-1' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['tool', 'subagent'])
    expect(items[0].event.type === 'tool' && items[0].event.tool)
      .toMatchObject({ title: 'Parent bash', status: 'completed' })
    expect(items[1].children).toHaveLength(0)
  })

  it('appends a subagent\u2019s prose inside its card, not after the parent\u2019s', () => {
    const items = buildConversationItems([
      event(1, { type: 'assistant_message', text: 'parent says', messageId: 'p' }),
      event(2, { type: 'subagent', subagent: { id: 'sub-1', title: 'Worker' } }),
      event(3, { type: 'assistant_message', text: 'Te', messageId: 'c', append: true, subagentId: 'sub-1' }),
      event(4, { type: 'assistant_message', text: 'al', messageId: 'c', append: true, subagentId: 'sub-1' }),
    ])
    expect(items[0].event.type === 'assistant_message' && items[0].event.text).toBe('parent says')
    expect(items[1].children?.length).toBe(1)
    expect(items[1].children?.[0].event.type === 'assistant_message' && items[1].children?.[0].event.text).toBe('Teal')
  })

  it('puts a subagent\u2019s file change in the subagent\u2019s run', () => {
    // A subagent's run has to show what it changed, not only which tool it ran. The diff used to render
    // in the parent's stream while the Edit call that produced it sat inside the subagent's card.
    const items = buildConversationItems([
      event(1, { type: 'subagent', subagent: { id: 'sub-1', title: 'Worker' } }),
      event(2, { type: 'tool', tool: { id: 'edit-1', title: 'Edit src/a.ts', subagentId: 'sub-1' } }),
      event(3, { type: 'file_change', path: 'src/a.ts', summary: 'Claude Code updated a file.', subagentId: 'sub-1' }),
      event(4, { type: 'file_change', path: 'src/b.ts', summary: 'the parent updated a file.' }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['subagent', 'file_change'])
    expect(items[0].children?.map((child) => child.event.type)).toEqual(['tool', 'file_change'])
    expect(items[1].event.type === 'file_change' && items[1].event.path).toBe('src/b.ts')
  })

  it('keeps an orphan visible at the top level', () => {
    // A truncated replay can start mid-stream, with a subagent's tool call arriving before any card to
    // hang it on. Dropping it would silently lose work the agent really did.
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'grep-1', title: 'Grep', subagentId: 'missing' } }),
    ])
    expect(items.map((item) => item.event.type)).toEqual(['tool'])
  })

  it('appends tool output deltas', () => {
    const items = buildConversationItems([
      event(1, { type: 'tool', tool: { id: 'cmd', title: 'Command', status: 'running', output: 'one' } }),
      event(2, { type: 'tool', tool: { id: 'cmd', title: '', output: '-two', outputAppend: true } }),
    ])
    const [card] = items
    expect(card.event.type === 'tool' && card.event.tool.output).toBe('one-two')
  })
})

describe('a subagent\u2019s run on its own', () => {
  // What the main window renders when a sub-row is selected: the card's children as the top level, so a
  // long child run is read at full width instead of inside a box in its parent's stream.
  const built = () => buildConversationItems([
    event(1, { type: 'assistant_message', text: 'delegating', messageId: 'a' }),
    event(2, { type: 'subagent', subagent: { id: 'sub-1', title: 'Read alpha', status: 'running' } }),
    event(3, { type: 'tool', tool: { id: 'sub-1', title: 'Read alpha', input: 'go', subagentId: 'sub-1' } }),
    event(4, { type: 'assistant_message', text: 'Teal', messageId: 'c', subagentId: 'sub-1' }),
    event(5, { type: 'session_state', state: 'ready' }),
  ])

  it('finds the card a selection names', () => {
    const card = findSubagentItem(built(), 'sub-1')
    expect(card?.event.type === 'subagent' && card.event.subagent.title).toBe('Read alpha')
    expect(card?.children?.map((child) => child.event.type)).toEqual(['tool', 'assistant_message'])
  })

  it('has nothing to show for a subagent that is not there', () => {
    // Selecting a sub-row under another session loads that snapshot afterwards, so the transcript must
    // fall back to the session's own stream rather than render blank.
    expect(findSubagentItem(built(), 'missing')).toBeUndefined()
  })

  it('hides the same events at both levels', () => {
    // One shared predicate. Two lists disagreeing would show a session_state row inside a subagent card
    // and not outside it.
    expect(visibleConversationItems(built()).map((item) => item.event.type))
      .toEqual(['assistant_message', 'subagent'])
    const card = findSubagentItem(built(), 'sub-1')
    expect(visibleConversationItems(card?.children ?? []).map((item) => item.event.type))
      .toEqual(['tool', 'assistant_message'])
  })
})

describe('what a request leaves in the thread', () => {
  const items = () => buildConversationItems([
    event(1, { type: 'request', requestId: 'ask-1', kind: 'question', title: 'Which one?', questions: [] }),
    event(2, { type: 'request', requestId: 'allow-1', kind: 'permission', title: 'Allow the tests?', options: [] }),
    event(3, { type: 'request_resolved', requestId: 'ask-1', resolution: { answers: { pick: 'first' } } }),
  ])

  it('keeps the question and drops the permission', () => {
    const visible = visibleConversationItems(items())
    expect(visible).toHaveLength(1)
    expect(visible[0].event).toMatchObject({ type: 'request', requestId: 'ask-1' })
  })

  it('draws no card for the answer itself, which belongs to the question it answered', () => {
    expect(visibleConversationItems(items()).some((item) => item.event.type === 'request_resolved')).toBe(false)
  })

  it('seats the question where it was asked, so the thread reads in order', () => {
    const ordered = visibleConversationItems(buildConversationItems([
      event(1, { type: 'assistant_message', text: 'Before' }),
      event(2, { type: 'request', requestId: 'ask-1', kind: 'question', title: 'Which one?', questions: [] }),
      event(3, { type: 'assistant_message', text: 'After' }),
    ]))
    expect(ordered.map((item) => item.event.type)).toEqual(['assistant_message', 'request', 'assistant_message'])
  })
})
