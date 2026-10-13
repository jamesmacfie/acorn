import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEventRecord,
  AgentInputPart,
  AgentRequest,
  AgentSessionSnapshot,
} from '@acorn/plugin-agents/contract/wire.ts'
import type { BridgeAgentHint } from '@acorn/protocol/extensionBridge.ts'
import { agentHints, bridgeRequest, bridgeSessionRead } from './agents'

const record = (seq: number, event: AgentEventRecord['event'], extra: Partial<AgentEventRecord> = {}) =>
  ({
    id: `e${seq}`,
    sessionId: 's1',
    turnId: 't1',
    seq,
    schemaVersion: 1,
    createdAt: seq,
    event,
    ...extra,
  }) as AgentEventRecord

const snapshot = (events: AgentEventRecord[], turns: Partial<AgentSessionSnapshot['turns'][number]>[] = []) =>
  ({
    session: {
      id: 's1',
      taskId: 'task',
      title: 'Chat',
      providerId: 'claude',
      profileId: 'claude-code',
      kind: 'interactive',
      runtimeState: 'ready',
      attention: 'none',
      lastEventSeq: 9,
      archivedAt: null,
      updatedAt: 5,
      config: { large: 'x'.repeat(1000) },
    },
    turns,
    events,
    requests: [],
  }) as unknown as AgentSessionSnapshot

describe('session pages for the sidebar', () => {
  it('keeps messages, tool summaries, and errors, and drops tool output and subagent streams', () => {
    const read = bridgeSessionRead(
      'n1',
      snapshot([
        record(1, { type: 'user_message', text: 'hi' }),
        record(2, { type: 'reasoning', text: 'thinking' }),
        record(
          3,
          {
            type: 'tool',
            tool: { id: 'tool-1', title: 'Run tests', status: 'completed', output: 'x'.repeat(10_000) },
          },
          { foldedThroughSeq: 6 },
        ),
        record(7, { type: 'assistant_message', text: 'done', messageId: 'm1', append: true }),
        record(8, { type: 'assistant_message', text: 'child', subagentId: 'sub' }),
        record(9, { type: 'error', code: 'x', message: 'Broke', retryable: false }),
      ]),
      0,
    )
    expect(read.records.map((row) => row.event)).toEqual([
      { type: 'user_message', text: 'hi' },
      { type: 'tool', toolId: 'tool-1', title: 'Run tests', status: 'completed' },
      { type: 'assistant_message', text: 'done', messageId: 'm1', append: true },
      { type: 'error', message: 'Broke' },
    ])
    expect(read.records[1]).toMatchObject({ seq: 3, foldedThroughSeq: 6 })
    expect(read.reach).toBe(9)
    expect(read.session).not.toHaveProperty('config')
  })

  it('reaches past the events it leaves out, and lists only queued turns', () => {
    const read = bridgeSessionRead(
      'n1',
      snapshot(
        [record(4, { type: 'reasoning', text: 'thinking' })],
        [
          { id: 'done', status: 'completed', input: [{ type: 'text', text: 'old' }] },
          { id: 'next', status: 'queued', input: [{ type: 'text', text: 'later' }] },
        ],
      ),
      3,
    )
    expect(read.records).toEqual([])
    expect(read.reach).toBe(4)
    expect(read.queued).toEqual([{ id: 'next', text: 'later', attachments: [] }])
  })

  it('lists what the person turn sent, without the lines that name it for the agent', () => {
    const input: AgentInputPart[] = [
      { type: 'text', text: 'Look' },
      { type: 'image', attachmentId: 'a1', alt: 'Screenshot of Docs' },
      { type: 'attachment', attachmentId: 'a2' },
    ]
    const read = bridgeSessionRead(
      'n1',
      snapshot(
        [
          record(1, { type: 'user_message', text: 'Look\n\n[Attachment: a1]\n\n[Attachment: a2]' }),
          record(2, { type: 'user_message', text: 'Continue.\n\n[Attachment: a1]', automatic: true }),
        ],
        [
          { id: 't1', status: 'completed', input },
          { id: 'next', status: 'queued', input },
        ],
      ),
      0,
    )
    const sent = [
      { id: 'a1', image: true, name: 'Screenshot of Docs' },
      { id: 'a2', image: false, name: null },
    ]
    expect(read.records.map((row) => row.event)).toEqual([
      { type: 'user_message', text: 'Look', attachments: sent },
      { type: 'user_message', text: 'Continue.\n\n[Attachment: a1]' },
    ])
    expect(read.queued).toEqual([{ id: 'next', text: 'Look', attachments: sent }])
  })
})

describe('agent hints', () => {
  afterEach(() => vi.useRealTimers())

  it('gathers a burst of frames into one hint naming each session and task once', () => {
    vi.useFakeTimers()
    const sent: BridgeAgentHint[] = []
    const hints = agentHints((hint) => sent.push(hint), 100)
    hints.note('n1', { channel: 'agent:event', event: { sessionId: 's1' } })
    hints.note('n1', { channel: 'agent:event', event: { sessionId: 's1' } })
    hints.note('n1', { channel: 'agent:session', session: { id: 's2', taskId: 't1' } })
    hints.note('n1', { channel: 'term:status', sessionId: 'other' })
    expect(sent).toEqual([])
    vi.advanceTimersByTime(100)
    expect(sent).toEqual([{ nodeId: 'n1', sessions: ['s1', 's2'], tasks: ['t1'], missed: false, requests: false }])
  })

  it('says a request changed, from the lifecycle frame that also reports expiry', () => {
    vi.useFakeTimers()
    const sent: BridgeAgentHint[] = []
    const hints = agentHints((hint) => sent.push(hint), 100)
    hints.note('n1', {
      channel: 'plugin:agents:request-changed',
      taskId: 't1',
      sessionId: 's1',
      requestId: 'r1',
      kind: 'question',
      status: 'expired',
    })
    hints.note('n1', { channel: 'plugin:agents:turn-changed', taskId: 't2', sessionId: 's2' })
    vi.advanceTimersByTime(100)
    expect(sent).toEqual([{ nodeId: 'n1', sessions: ['s1'], tasks: ['t1'], missed: false, requests: true }])
  })

  it('says frames were missed when the Node shed them', () => {
    vi.useFakeTimers()
    const sent: BridgeAgentHint[] = []
    const hints = agentHints((hint) => sent.push(hint), 100)
    hints.note('n1', { channel: 'ws:shed' })
    vi.advanceTimersByTime(100)
    expect(sent).toEqual([{ nodeId: 'n1', sessions: [], tasks: [], missed: true, requests: false }])
  })
})

const request = (extra: Partial<AgentRequest> = {}): AgentRequest => ({
  id: 'row',
  sessionId: 's1',
  turnId: 't1',
  providerRequestId: 'r1',
  kind: 'permission',
  status: 'pending',
  title: 'Run make',
  detail: 'make clean',
  payload: {
    options: [
      { id: 'allow_once', label: 'Allow', kind: 'allow_once' },
      { id: 'reject_once', label: 'Reject', kind: 'reject_once' },
    ],
    questions: [],
  },
  resolution: null,
  expiresAt: null,
  createdAt: 1,
  resolvedAt: null,
  ...extra,
})

describe('requests for the sidebar', () => {
  it('keeps the option ids a button sends, and marks a refusal', () => {
    expect(bridgeRequest(request())).toEqual({
      requestId: 'r1',
      kind: 'permission',
      status: 'pending',
      title: 'Run make',
      detail: 'make clean',
      options: [
        { id: 'allow_once', label: 'Allow', reject: false },
        { id: 'reject_once', label: 'Reject', reject: true },
      ],
      questions: [],
      approval: null,
      answer: null,
      sentNote: null,
      unsupported: null,
    })
  })

  it('keeps a form, with option labels, multiple choice, and secret fields', () => {
    const narrowed = bridgeRequest(
      request({
        kind: 'question',
        payload: {
          options: [{ id: 'decline', label: 'Skip', kind: 'reject_once' }],
          questions: [
            { id: 'colour', header: 'Colour', prompt: 'Which one?', options: [{ id: '0', label: 'Blue' }] },
            {
              id: 'parts',
              prompt: 'Which parts?',
              multiple: true,
              options: [{ id: 'a', label: 'A', description: 'First' }],
            },
            { id: 'token', prompt: 'API token', secret: true },
          ],
        },
      }),
    )
    expect(narrowed.questions).toEqual([
      {
        id: 'colour',
        header: 'Colour',
        prompt: 'Which one?',
        options: [{ label: 'Blue', description: null }],
        multiple: false,
        secret: false,
      },
      {
        id: 'parts',
        header: null,
        prompt: 'Which parts?',
        options: [{ label: 'A', description: 'First' }],
        multiple: true,
        secret: false,
      },
      { id: 'token', header: null, prompt: 'API token', options: [], multiple: false, secret: true },
    ])
    expect(narrowed.unsupported).toBeNull()
  })

  it('names the button a settled request was answered with, and never a form answer', () => {
    expect(bridgeRequest(request({ status: 'resolved', resolution: { optionId: 'reject_once' } })).answer).toBe(
      'Reject',
    )
    const answered = bridgeRequest(
      request({
        kind: 'question',
        status: 'resolved',
        payload: { options: [], questions: [{ id: 'token', prompt: 'API token', secret: true }] },
        resolution: { answers: { token: 'hunter2' } },
      }),
    )
    expect(answered.answer).toBeNull()
    expect(JSON.stringify(answered)).not.toContain('hunter2')
  })

  it('describes app access in the agents plugin words, with its warning', () => {
    const narrowed = bridgeRequest(
      request({
        payload: {
          options: [
            { id: 'accept', label: 'Allow for this session', kind: 'allow_once' },
            { id: 'acceptAlways', label: 'Always allow', kind: 'allow_always' },
            { id: 'decline', label: 'Decline', kind: 'reject_once' },
          ],
          questions: [],
          approval: {
            connector: 'Computer Use',
            app: { name: 'Notes', id: 'com.apple.Notes' },
            scopes: ['session', 'always'],
            warning: 'Notes can read your notes.',
          },
        },
        status: 'resolved',
        resolution: { optionId: 'acceptAlways' },
      }),
    )
    expect(narrowed.approval).toEqual({
      target: 'Notes (com.apple.Notes)',
      scopeNote: expect.stringContaining('Always allow lets Computer Use use any app with this identifier'),
      warning: 'Notes can read your notes.',
    })
    expect(narrowed.answer).toBe('Always allow')
    expect(narrowed.sentNote).toContain('saves the grant itself')
  })

  it.each([
    ['a kind the extension does not answer', { kind: 'workflow_gate' as const }, 'workflow gate'],
    ['an option it cannot read', { payload: { options: [{ id: 'allow' }], questions: [] } }, "choices don't read"],
    [
      'app access without a scope',
      {
        payload: {
          options: [{ id: 'accept', label: 'Allow' }],
          approval: { connector: 'X', app: { id: 'a', name: 'A' }, scopes: [] },
        },
      },
      "app access doesn't read",
    ],
    ['nothing to send', { payload: { options: [], questions: [] } }, 'no answer'],
  ])('shows %s with a reason instead of an answer', (_name, extra, reason) => {
    const narrowed = bridgeRequest(request(extra as Partial<AgentRequest>))
    expect(narrowed.unsupported).toContain(reason)
    expect(narrowed.title).toBe('Run make')
  })

  it('reads every open request, then only the most recently settled', () => {
    const settled = Array.from({ length: 12 }, (_, index) =>
      request({ providerRequestId: `old-${index}`, status: 'resolved', resolvedAt: index }),
    )
    const read = bridgeSessionRead(
      'n1',
      {
        ...snapshot([]),
        requests: [
          ...settled,
          request({ providerRequestId: 'open-1' }),
          request({ providerRequestId: 'open-2', status: 'resolving' }),
        ],
      },
      0,
    )
    expect(read.requests.map((row) => row.requestId)).toEqual([
      'open-1',
      'open-2',
      ...Array.from({ length: 10 }, (_, index) => `old-${11 - index}`),
    ])
  })
})
