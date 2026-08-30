import { describe, expect, it } from 'vitest'
import { normalizeCodexNotification, normalizeCodexServerRequest } from './codexNormalizer'

describe('Codex app-server normalization', () => {
  it('maps protocol readiness without terminal heuristics', () => {
    expect(normalizeCodexNotification({
      method: 'thread/status/changed',
      params: { threadId: 'thread-1', status: { type: 'idle' } },
    })).toEqual([{ type: 'session_state', state: 'ready' }])
  })

  it('maps approval identity and advertised choices', () => {
    const event = normalizeCodexServerRequest({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'git push', reason: 'network' },
    })
    expect(event).toMatchObject({
      type: 'request',
      requestId: '42',
      kind: 'permission',
      detail: 'git push',
    })
    expect(event?.type === 'request' ? event.options?.map((option) => option.id) : []).toContain('acceptForSession')
  })

  it('maps message deltas and usage', () => {
    expect(normalizeCodexNotification({
      method: 'item/agentMessage/delta',
      params: { itemId: 'message-1', delta: 'hello' },
    })).toEqual([{ type: 'assistant_message', text: 'hello', messageId: 'message-1', append: true }])
    expect(normalizeCodexNotification({
      method: 'thread/tokenUsage/updated',
      params: {
        tokenUsage: {
          total: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, totalTokens: 17 },
          modelContextWindow: 100,
        },
      },
    })).toEqual([{ type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, contextUsed: 17, contextSize: 100 } }])
  })

  it('maps each Codex plan snapshot with its structured status intact', () => {
    expect(normalizeCodexNotification({
      method: 'turn/plan/updated',
      params: {
        plan: [
          { step: 'Inspect `session/start`', status: 'completed' },
          { step: 'Update the projection', status: 'inProgress' },
          { step: 'Verify the UI', status: 'pending' },
        ],
      },
    })).toEqual([{
      type: 'plan',
      entries: [
        { id: 'plan-0', text: 'Inspect `session/start`', status: 'completed' },
        { id: 'plan-1', text: 'Update the projection', status: 'in_progress' },
        { id: 'plan-2', text: 'Verify the UI', status: 'pending' },
      ],
    }])
  })
})
