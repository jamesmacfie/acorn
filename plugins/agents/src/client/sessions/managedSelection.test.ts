import { describe, expect, it, vi } from 'vitest'

vi.mock('@acorn/plugin-api/client', () => ({
  clientEvents: { on: () => () => undefined },
  consumePaneIntent: () => undefined,
  dispatchLayout: () => undefined,
  registerNoticeTargetHandler: () => () => undefined,
  telemetryFor: () => ({
    startOperation: () => ({ traceId: '', spanId: '', end: () => undefined }),
    startRenderTransition: () => ({ update: () => undefined, cancel: () => undefined }),
  }),
}))

// The module only wants the pane's id from here; the real file drags in the whole store.
vi.mock('../paneContribution', () => ({ AGENT_PANE_ID: 'agents' }))

const { consumeComposerFocus, managedChatsOnly, requestComposerFocus, toggleManagedChatsOnly } = await import('./managedSelection')

describe('composer focus request', () => {
  it('is answered once, and only for the session it named', () => {
    requestComposerFocus('s1')
    expect(consumeComposerFocus('s2')).toBe(false)
    expect(consumeComposerFocus('s1')).toBe(true)
    expect(consumeComposerFocus('s1')).toBe(false)
  })
})

describe('chats only filter', () => {
  it('is remembered per session', () => {
    toggleManagedChatsOnly('s1')
    expect(managedChatsOnly('s1')).toBe(true)
    expect(managedChatsOnly('s2')).toBe(false)
    toggleManagedChatsOnly('s1')
    expect(managedChatsOnly('s1')).toBe(false)
  })
})
