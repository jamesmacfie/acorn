import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearHooks,
  hookHandlers,
  hookHandlersFor,
  registerHookHandler,
  registerHookPoint,
  runHook,
} from './hooks'

// The chain rules (docs/plugins.md § Hooks, docs/plugins.md § Hooks). Every one of
// them is a decision about what happens when somebody else's code is between a plugin and something it
// was about to do, so every one of them is here rather than left to the call sites.
//
// The theme running through the list: fail open. A handler that throws, stalls, or answers with a shape
// its owner never declared has said nothing, and the owner carries on. The one exception is a veto whose
// owner asked for `onTimeout: 'deny'`, which is what an approval gate needs and nothing else does.

const point = (over: Partial<Parameters<typeof registerHookPoint>[0]> = {}) =>
  registerHookPoint({
    id: 'changes:before-push',
    ownerId: 'changes',
    payload: { branch: 'string' },
    allows: ['observe', 'transform', 'veto'],
    timeoutMs: 50,
    onTimeout: 'allow',
    order: 'priority',
    collect: false,
    ...over,
  })

const handler = (
  id: string,
  mode: 'observe' | 'transform' | 'veto',
  call: (payload: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  priority = 500,
) =>
  registerHookHandler({ id: `${id}:h`, pluginId: id, point: 'changes:before-push', mode, priority, call })

afterEach(() => {
  clearHooks('changes')
  for (const id of ['scan', 'lint', 'watch', 'slow', 'liar', 'first', 'second']) clearHooks(id)
  vi.restoreAllMocks()
})

describe('the chain', () => {
  it('lets a push through when nobody has anything to say', async () => {
    point()
    await expect(runHook('changes:before-push', { branch: 'main' })).resolves.toEqual({
      ok: true,
      payload: { branch: 'main' },
    })
  })

  it('answers ok for a point nobody declared', async () => {
    // Not an error. Core declares its own points at boot and a plugin declares its own at init, so the
    // only way here is a caller running before its own declaration, and the honest answer to "did
    // anybody object" when nobody could have is no.
    handler('scan', 'veto', async () => ({ ok: false, reason: 'no' }))
    await expect(runHook('changes:before-push', { branch: 'main' })).resolves.toMatchObject({ ok: true })
  })

  it('never calls a handler asking for a mode the owner did not allow', async () => {
    point({ allows: ['observe'] })
    const call = vi.fn().mockResolvedValue({ ok: false, reason: 'nope' })
    handler('scan', 'veto', call)
    await expect(runHook('changes:before-push', { branch: 'main' })).resolves.toMatchObject({ ok: true })
    expect(call).not.toHaveBeenCalled()
    // It stays registered, because the developer view's job is to say that it matched nothing.
    expect(hookHandlers().find((entry) => entry.pluginId === 'scan')?.matched).toBe(false)
  })

  it('stops at the first veto and stamps the plugin that said so', async () => {
    point()
    const second = vi.fn().mockResolvedValue({ ok: true })
    handler('scan', 'veto', async () => ({ ok: false, reason: 'Secret in .env.local:3' }), 10)
    handler('lint', 'veto', second, 20)
    const verdict = await runHook('changes:before-push', { branch: 'main' })
    expect(verdict).toMatchObject({ ok: false, reason: 'Secret in .env.local:3', by: 'scan' })
    expect(second).not.toHaveBeenCalled()
  })

  it('runs every veto and collects every reason when the owner asked for it', async () => {
    point({ collect: true })
    handler('scan', 'veto', async () => ({ ok: false, reason: 'a secret' }), 10)
    handler('lint', 'veto', async () => ({ ok: false, reason: 'no changeset' }), 20)
    const verdict = await runHook('changes:before-push', { branch: 'main' })
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons).toEqual([
      { reason: 'a secret', by: 'scan' },
      { reason: 'no changeset', by: 'lint' },
    ])
  })

  it('hands each handler the payload as it stands when its turn comes, and never the previous answer', async () => {
    point({ payload: { branch: 'string' } })
    const seen: string[] = []
    handler('first', 'transform', async (payload) => {
      seen.push(payload.branch as string)
      return { payload: { branch: 'renamed' } }
    }, 10)
    handler('second', 'transform', async (payload) => {
      seen.push(payload.branch as string)
      return { payload }
    }, 20)
    const verdict = await runHook('changes:before-push', { branch: 'main' })
    expect(seen).toEqual(['main', 'renamed'])
    expect(verdict.payload).toEqual({ branch: 'renamed' })
  })

  it('treats a transform that answers with an extra field as no change, and records it', async () => {
    point()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    handler('liar', 'transform', async () => ({ payload: { branch: 'main', remote: 'origin' } }))
    const verdict = await runHook('changes:before-push', { branch: 'main' })
    expect(verdict.payload).toEqual({ branch: 'main' })
    expect(hookHandlers().find((entry) => entry.pluginId === 'liar')?.lastRun?.outcome).toBe('skipped')
  })

  it('skips a handler that throws and carries on with the rest', async () => {
    point()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    handler('liar', 'transform', async () => {
      throw new Error('boom')
    }, 10)
    handler('lint', 'transform', async () => ({ payload: { branch: 'fixed' } }), 20)
    const verdict = await runHook('changes:before-push', { branch: 'main' })
    expect(verdict).toMatchObject({ ok: true, payload: { branch: 'fixed' } })
    expect(hookHandlers().find((entry) => entry.pluginId === 'liar')?.lastRun?.outcome).toBe('failed')
  })

  it('lets a stalled veto through with onTimeout allow, and stops the push with deny', async () => {
    const stall = async () => new Promise<never>(() => {})
    point({ onTimeout: 'allow' })
    handler('slow', 'veto', stall)
    await expect(runHook('changes:before-push', { branch: 'main' })).resolves.toMatchObject({ ok: true })

    clearHooks('changes')
    clearHooks('slow')
    point({ onTimeout: 'deny' })
    handler('slow', 'veto', stall)
    await expect(runHook('changes:before-push', { branch: 'main' })).resolves.toMatchObject({ ok: false, by: 'slow' })
  })

  it('runs observers alongside the chain and ignores what they say', async () => {
    point()
    const watched = vi.fn().mockResolvedValue({ ok: false, reason: 'ignored' })
    handler('watch', 'observe', watched)
    await expect(runHook('changes:before-push', { branch: 'main' })).resolves.toMatchObject({ ok: true })
    expect(watched).toHaveBeenCalledWith({ branch: 'main' }, expect.any(AbortSignal))
  })

  it('orders by the handler priority, then by id, and by id alone when the owner said install', async () => {
    point()
    handler('lint', 'veto', async () => ({ ok: true }), 20)
    handler('scan', 'veto', async () => ({ ok: true }), 10)
    expect(hookHandlersFor('changes:before-push').map((entry) => entry.pluginId)).toEqual(['scan', 'lint'])

    clearHooks('changes')
    point({ order: 'install' })
    expect(hookHandlersFor('changes:before-push').map((entry) => entry.pluginId)).toEqual(['lint', 'scan'])
  })

  it('refuses to run a payload its own declaration does not describe', async () => {
    // The owner's bug rather than a plugin's, so it is loud. Running the chain anyway would hand
    // strangers' handlers a shape the trust prompt never described.
    point()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const call = vi.fn().mockResolvedValue({ ok: true })
    handler('scan', 'veto', call)
    await expect(runHook('changes:before-push', { branch: 1 } as never)).resolves.toMatchObject({ ok: true })
    expect(call).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('takes both halves away with the plugin', async () => {
    point()
    handler('scan', 'veto', async () => ({ ok: false, reason: 'no' }))
    clearHooks('scan')
    await expect(runHook('changes:before-push', { branch: 'main' })).resolves.toMatchObject({ ok: true })
    clearHooks('changes')
    expect(hookHandlersFor('changes:before-push')).toEqual([])
  })
})
