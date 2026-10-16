// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setActiveNode } from '../../infra/node/activeNode'
import { registerSessionSource } from '../../host/registries/sessions/sessionSources'
import { formatFileReference, referenceTargetRegistry, sendReferenceToAgent } from './reference'

describe('formatFileReference', () => {
  it('formats path, path:line and path:start-end', () => {
    expect(formatFileReference('src/foo.ts')).toBe('src/foo.ts')
    expect(formatFileReference('src/foo.ts', 42)).toBe('src/foo.ts:42')
    expect(formatFileReference('src/foo.ts', 42, 42)).toBe('src/foo.ts:42')
    expect(formatFileReference('src/foo.ts', 42, 48)).toBe('src/foo.ts:42-48')
  })
  it('normalises a reversed range', () => {
    expect(formatFileReference('a.ts', 48, 42)).toBe('a.ts:42-48')
  })
})

describe('sendReferenceToAgent', () => {
  const disposals: { dispose(): void }[] = []
  afterEach(() => {
    for (const disposal of disposals.splice(0)) disposal.dispose()
    setActiveNode(null)
  })

  it('asks targets from the highest priority down and stops at the first answer', async () => {
    const low = vi.fn(async () => ({ ok: true }))
    const passes = vi.fn(async () => null)
    const takes = vi.fn(async () => ({ ok: true, reason: 'high' }))
    disposals.push(referenceTargetRegistry.register({ id: 'low', priority: 1, deliver: low }))
    disposals.push(referenceTargetRegistry.register({ id: 'high', priority: 20, deliver: takes }))
    disposals.push(referenceTargetRegistry.register({ id: 'higher', priority: 30, deliver: passes }))

    expect(await sendReferenceToAgent('task', 'a.ts:4')).toEqual({ ok: true, reason: 'high' })
    expect(passes).toHaveBeenCalledWith('task', 'a.ts:4')
    expect(low).not.toHaveBeenCalled()
  })

  it("falls back to the task's latest running agent session as a draft", async () => {
    setActiveNode('n1')
    const send = vi.fn(async () => ({ ok: true }))
    const session = { nodeId: 'n1', taskId: 'task', title: 'Agent', running: true, agent: true }
    disposals.push(
      registerSessionSource('terminal', {
        summaries: () => [
          { ...session, sessionId: 'old', createdAt: 1 },
          { ...session, sessionId: 'new', createdAt: 2 },
        ],
        send,
      }),
    )

    expect(await sendReferenceToAgent('task', 'a.ts')).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith('new', 'a.ts', 'draft')
  })

  it('says so when nothing takes the reference', async () => {
    expect(await sendReferenceToAgent('task', 'a.ts')).toEqual({
      ok: false,
      reason: 'No running agent session for this task.',
    })
  })
})
