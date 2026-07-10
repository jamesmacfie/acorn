import { describe, expect, it, vi } from 'vitest'
import { clientEvents, consumePaneIntent, consumeTerminalFocusIntent, openPane, requestTerminalFocusIntent } from './clientEvents'

vi.mock('../features/tasks/tasks', () => ({ dispatchLayout: vi.fn() }))

describe('client events and intents', () => {
  it('delivers serializable events and disposes subscriptions', () => {
    const listener = vi.fn()
    const off = clientEvents.on('runtime:task-archived', listener)
    clientEvents.emit('runtime:task-archived', { taskId: 't1' })
    off()
    clientEvents.emit('runtime:task-archived', { taskId: 't2' })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('retains pane and terminal intents until one consumer takes them', () => {
    openPane('t1', 'editor', { kind: 'editor:reveal', path: 'a.ts', line: 3 }, 'add')
    expect(consumePaneIntent('t1', 'editor')).toEqual({ kind: 'editor:reveal', path: 'a.ts', line: 3 })
    expect(consumePaneIntent('t1', 'editor')).toBeUndefined()
    requestTerminalFocusIntent('t1', 's1')
    expect(consumeTerminalFocusIntent('t1')).toBe('s1')
  })
})
