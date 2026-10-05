import { describe, expect, it, vi } from 'vitest'

const paneIntent = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { paneId: string; taskId: string; intent: { kind: string; item: string } }) => void),
}))

vi.mock('@acorn/plugin-api/client', () => ({
  clientEvents: { on: (_name: string, listener: typeof paneIntent.listener) => {
    paneIntent.listener = listener
    return () => { paneIntent.listener = undefined }
  } },
  consumePaneIntent: () => undefined,
  dispatchLayout: () => undefined,
  registerNoticeTargetHandler: () => () => undefined,
  telemetryFor: () => ({
    startOperation: () => ({ traceId: '', spanId: '', end: () => undefined }),
    startRenderTransition: () => ({ update: () => undefined, cancel: () => undefined }),
  }),
}))

const {
  clearManagedSession,
  activateManagedAgentPaneIntents,
  consumeComposerFocus,
  managedChatsOnly,
  requestComposerFocus,
  selectManagedSession,
  selectedManagedSession,
  toggleManagedChatsOnly,
} = await import('./managedSelection')

it('consumes the registered pane intent into session selection and composer focus', () => {
  const dispose = activateManagedAgentPaneIntents()
  paneIntent.listener?.({ paneId: 'other', taskId: 'intent-task', intent: { kind: 'plugin:select', item: 's1' } })
  expect(selectedManagedSession('intent-task')).toBeUndefined()
  paneIntent.listener?.({ paneId: 'agents', taskId: 'intent-task', intent: { kind: 'plugin:select', item: 's1' } })
  expect(selectedManagedSession('intent-task')).toBe('s1')
  expect(consumeComposerFocus('s1')).toBe(true)
  dispose()
  clearManagedSession('intent-task', 's1')
})

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

  it('keeps each session choice when another session is selected and cleared', () => {
    selectManagedSession('task', 'returning')
    toggleManagedChatsOnly('returning')
    selectManagedSession('task', 'other')
    clearManagedSession('task', 'other')
    expect(selectedManagedSession('task')).toBeUndefined()
    selectManagedSession('task', 'returning')
    expect(managedChatsOnly('returning')).toBe(true)
    expect(managedChatsOnly('other')).toBe(false)
    clearManagedSession('task', 'returning')
  })
})
