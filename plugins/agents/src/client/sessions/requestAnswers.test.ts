import { describe, expect, it } from 'vitest'
import type { AgentNormalizedEvent, AgentRequest } from '@acorn/protocol/managedAgents.ts'
import { askedQuestions } from './requestAnswers'

const asked = (questions: Extract<AgentNormalizedEvent, { type: 'request' }>['questions']) => ({
  type: 'request' as const,
  requestId: 'request-1',
  kind: 'question' as const,
  title: 'Which one?',
  questions,
})

const row = (resolution: unknown, status: AgentRequest['status'] = 'resolved'): AgentRequest => ({
  id: 'row-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  providerRequestId: 'request-1',
  kind: 'question',
  status,
  title: 'Which one?',
  detail: null,
  payload: {},
  resolution,
  expiresAt: null,
  createdAt: 0,
  resolvedAt: 1,
})

describe('what the agent asked, and what it was not told', () => {
  const question = asked([{
    id: 'pick',
    header: 'Package manager',
    prompt: 'Which one should I use?',
    options: [
      { id: 'pnpm', label: 'pnpm', description: 'what the repo already uses' },
      { id: 'npm', label: 'npm' },
      { id: 'yarn', label: 'yarn' },
    ],
  }])

  it('names the answer and keeps the roads not taken', () => {
    expect(askedQuestions(question, row({ answers: { pick: 'pnpm' } }))).toEqual([{
      prompt: 'Package manager: Which one should I use?',
      chosen: ['pnpm'],
      alternatives: [{ label: 'npm' }, { label: 'yarn' }],
    }])
  })

  it('keeps every answer to a multi-select, and the rest as alternatives', () => {
    const [entry] = askedQuestions(question, row({ answers: { pick: ['pnpm', 'npm'] } }))
    expect(entry.chosen).toEqual(['pnpm', 'npm'])
    expect(entry.alternatives).toEqual([{ label: 'yarn' }])
  })

  it('says nothing was chosen when the question was skipped', () => {
    const [entry] = askedQuestions(question, row({ optionId: 'decline' }))
    expect(entry.chosen).toEqual([])
    expect(entry.alternatives).toHaveLength(3)
  })

  it('leaves out a free-text box nobody typed in', () => {
    // What Claude pairs with every choice: an "Other" field whose prompt is its own placeholder text.
    const withOther = asked([
      { id: 'pick', prompt: 'Which drink?', options: [{ id: 'tea', label: 'Tea' }] },
      { id: 'pick_custom', prompt: 'Other: type your own answer (optional).' },
    ])
    expect(askedQuestions(withOther, row({ answers: { pick: 'Tea' } })).map((entry) => entry.prompt))
      .toEqual(['Which drink?'])
    // Unless they used it, in which case it is the answer.
    expect(askedQuestions(withOther, row({ answers: { pick_custom: 'Earl Grey' } })))
      .toContainEqual({ prompt: 'Other: type your own answer (optional).', chosen: ['Earl Grey'], alternatives: [] })
  })

  it('keeps a skipped choice, because which options went unanswered still reads', () => {
    const [entry] = askedQuestions(question, row({ optionId: 'decline' }))
    expect(entry.chosen).toEqual([])
    expect(entry.alternatives).toHaveLength(3)
  })

  it('keeps a secret answer out of the transcript', () => {
    const secret = asked([{ id: 'token', prompt: 'Which token?', secret: true }])
    expect(askedQuestions(secret, row({ answers: { token: 'sk-live-4242' } }))).toEqual([{
      prompt: 'Which token?',
      chosen: ['Answer hidden'],
      alternatives: [],
    }])
  })

  it('falls back to the request itself when there are no questions, so a permission still reads', () => {
    const permission = {
      type: 'request' as const,
      requestId: 'request-2',
      kind: 'permission' as const,
      title: 'Allow the tests to run?',
      options: [
        { id: 'allow', label: 'Allow once', kind: 'allow_once' as const },
        { id: 'deny', label: 'Reject', kind: 'reject_once' as const },
      ],
    }
    expect(askedQuestions(permission, row({ optionId: 'allow' }))).toEqual([{
      prompt: 'Allow the tests to run?',
      chosen: ['Allow once'],
      alternatives: [{ label: 'Reject' }],
    }])
  })
})
