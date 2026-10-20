import { describe, expect, it, vi } from 'vitest'

const paneIntent = vi.hoisted(() => ({
  listener: undefined as
    | undefined
    | ((event: { paneId: string; taskId: string; intent: { kind: string; item: string; at?: string } }) => void),
}))

vi.mock('@acorn/plugin-api/client', () => ({
  activeTaskId: () => null,
  clientEvents: {
    on: (_name: string, listener: typeof paneIntent.listener) => {
      paneIntent.listener = listener
      return () => {
        paneIntent.listener = undefined
      }
    },
  },
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
  linkedManagedEvent,
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

it('takes a link’s event sequence for the transcript, in place of the composer focus', () => {
  const dispose = activateManagedAgentPaneIntents()
  const intent = (at: string) => ({ kind: 'plugin:select', item: 's2', at })
  paneIntent.listener?.({ paneId: 'agents', taskId: 'link-task', intent: intent('42') })
  expect(selectedManagedSession('link-task')).toBe('s2')
  expect(linkedManagedEvent('s2')).toEqual({ seq: 42 })
  expect(consumeComposerFocus('s2')).toBe(false)
  clearManagedSession('link-task', 's2')
  // Not a sequence number: the session still opens, at its newest page.
  paneIntent.listener?.({ paneId: 'agents', taskId: 'link-task', intent: intent('later') })
  expect(selectedManagedSession('link-task')).toBe('s2')
  expect(linkedManagedEvent('s2')).toBeUndefined()
  dispose()
  clearManagedSession('link-task', 's2')
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
