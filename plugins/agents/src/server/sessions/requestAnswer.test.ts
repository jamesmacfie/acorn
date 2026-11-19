import { describe, expect, it } from 'vitest'
import type { ManagedAgentRuntime } from './runtime'
import { createRequestAnswer } from './requestAnswer'

// `agents.requestAnswer`: the session must be the caller's, in the named task, with a pending permission
// request that offers a once-only option; the answer goes through `resolveRequest` and leaves an audit row.

const permission = (
  status = 'pending',
  options = [
    { id: 'yes', label: 'Allow once', kind: 'allow_once' },
    { id: 'always', label: 'Always', kind: 'allow_always' },
    { id: 'no', label: 'Deny', kind: 'reject_once' },
  ],
) => ({ requestId: 'req-1', kind: 'permission', status, payload: { options } })

function fixture(
  request: ReturnType<typeof permission> | { requestId: string; kind: string; status: string; payload: object },
) {
  const resolved: unknown[][] = []
  const audits: unknown[] = []
  const runtime = {
    store: {
      getSession: async (id: string) =>
        id === 'session-1' ? { id, taskId: 'task-1', config: { startedByPlugin: 'slack' } } : null,
      lifecycleRequests: async () => [request],
    },
    resolveRequest: async (...args: unknown[]) => void resolved.push(args),
  } as unknown as ManagedAgentRuntime
  const answer = createRequestAnswer(runtime, 'slack', (entry) => audits.push(entry))
  return { answer, resolved, audits }
}

const input = { taskId: 'task-1', sessionId: 'session-1', requestId: 'req-1', idempotencyKey: 'click-1' }

describe('agents.requestAnswer', () => {
  it('allows with the once option, through resolveRequest, and audits it', async () => {
    const { answer, resolved, audits } = fixture(permission())
    expect(await answer({ ...input, decision: 'allow' })).toEqual({ ok: true })
    expect(resolved).toEqual([['session-1', 'req-1', { optionId: 'yes' }, 'plugin-answer:slack:click-1']])
    expect(audits).toEqual([
      { subject: 'session-1', details: { plugin: 'slack', decision: 'allow', requestId: 'req-1' } },
    ])
  })

  it('denies with the reject-once option', async () => {
    const { answer, resolved } = fixture(permission())
    await answer({ ...input, decision: 'deny' })
    expect(resolved[0]![2]).toEqual({ optionId: 'no' })
  })

  it.each([
    ['not-in-task', { taskId: 'task-2' }, permission()],
    ['not-in-task', { sessionId: 'session-2' }, permission()],
    ['not-pending', {}, permission('resolved')],
    ['no-once-option', {}, permission('pending', [{ id: 'always', label: 'Always', kind: 'allow_always' }])],
    ['no-once-option', {}, { requestId: 'req-1', kind: 'question', status: 'pending', payload: {} }],
  ])('refuses with %s', async (reason, overrides, request) => {
    const { answer, resolved, audits } = fixture(request)
    expect(await answer({ ...input, ...overrides, decision: 'allow' })).toEqual({ ok: false, reason })
    expect(resolved).toEqual([])
    expect(audits).toEqual([])
  })

  it('refuses a session another plugin started', async () => {
    const runtime = {
      store: { getSession: async () => ({ id: 'session-1', taskId: 'task-1', config: { startedByPlugin: 'other' } }) },
    } as unknown as ManagedAgentRuntime
    expect(await createRequestAnswer(runtime, 'slack', () => {})({ ...input, decision: 'allow' })).toEqual({
      ok: false,
      reason: 'not-started-by-caller',
    })
  })
})
