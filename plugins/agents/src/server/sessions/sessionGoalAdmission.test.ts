import { randomUUID } from 'node:crypto'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import { expect, it, vi } from 'vitest'
import { FakeAgentDriver } from '../drivers/fake'
import { AgentDriverRegistry } from '../drivers/registry'
import { ManagedAgentRuntime } from './runtime'

it('applies admission refusals and prompt changes to goal turns', async () => {
  const ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
  vi.spyOn(ctx.core.tasks, 'requireRoot').mockResolvedValue(ctx.dataDir)
  vi.spyOn(ctx.core.tasks, 'workspaceId').mockResolvedValue('workspace')
  const registry = new AgentDriverRegistry()
  registry.registerNative('fake', () => new FakeAgentDriver())
  let refuse = true
  const hook = vi.fn(async (_point: string, payload: Record<string, unknown>) =>
    refuse
      ? { ok: false, by: 'instruction check', reason: 'Remove the hidden character.' }
      : { ok: true, payload: { ...payload, text: 'Approved objective' } },
  )
  const runtime = new ManagedAgentRuntime({
    db: ctx.storage.open(),
    dataDir: ctx.dataDir,
    core: ctx.core,
    registry,
    internalEnv: () => ({}),
    secrets: ctx.env.SECRETS,
    currentUserId: () => null,
    hooks: { run: hook, handlers: async () => [] } as never,
  })
  try {
    const session = await runtime.store.createSession(
      {
        taskId: randomUUID(),
        providerId: 'fake',
        profileId: 'fake',
        kind: 'interactive',
        config: {},
      },
      await new FakeAgentDriver().probe(),
    )
    await expect(runtime.setGoal(session.id, 'Finish the work')).rejects.toThrow('Remove the hidden character')
    expect((await runtime.store.snapshot(session.id)).turns).toEqual([])
    expect((await runtime.store.requireSession(session.id)).goal?.status).toBe('blocked')
    expect(hook).toHaveBeenCalledWith('before-send', {
      sessionId: session.id,
      taskId: session.taskId,
      text: 'Finish the work',
    })

    refuse = false
    let finishAdmission!: () => void
    hook.mockImplementationOnce(async (_point, payload) => {
      await new Promise<void>((resolve) => {
        finishAdmission = resolve
      })
      return { ok: true, payload: { ...payload, text: String(payload.text) } }
    })
    const controller = new AbortController()
    const cancelled = runtime.enqueueTurn(
      session.id,
      {
        source: 'goal',
        input: [{ type: 'text', text: 'Continue' }],
        effectivePolicy: {},
        idempotencyKey: randomUUID(),
      },
      {},
      controller.signal,
    )
    const rejection = expect(cancelled).rejects.toThrow('Goal paused')
    await vi.waitFor(() => expect(finishAdmission).toBeTypeOf('function'))
    controller.abort(new Error('Goal paused'))
    finishAdmission()
    await rejection
    expect((await runtime.store.snapshot(session.id)).turns).toEqual([])

    await runtime.setGoal(session.id, 'Finish the work')
    expect((await runtime.store.snapshot(session.id)).turns).toEqual([
      expect.objectContaining({
        source: 'goal',
        input: [{ type: 'text', text: 'Approved objective' }],
        effectivePolicy: expect.objectContaining({ attendance: 'attended' }),
      }),
    ])
  } finally {
    await runtime.stop()
    ctx.cleanup()
    vi.restoreAllMocks()
  }
})
