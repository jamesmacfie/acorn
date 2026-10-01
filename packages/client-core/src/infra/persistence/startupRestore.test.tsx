import { QueryClient } from '@tanstack/solid-query'
import { createRoot, createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStartupRestore, PERSISTED_STATE_TOMBSTONE } from './startupRestore'
import { storageKeyFor, type PersistedStateSlice } from './persistedState'
import { registerQueryOwner } from '../node/queryOwnership'
import { setActiveNode } from '../node/activeNode'

const mocks = vi.hoisted(() => ({ savePref: vi.fn(), emit: vi.fn(), pushBackgroundError: vi.fn() }))
vi.mock('../../features/settings/savePref', () => ({ savePref: mocks.savePref }))
vi.mock('../../host/registries/commands/clientEvents', () => ({ clientEvents: { emit: mocks.emit } }))
vi.mock('../../features/notifications/notifications', () => ({ pushBackgroundError: mocks.pushBackgroundError }))
type State = { keep: number; transient: number }
const slice = (id: string, values: () => Record<string, State>, hydrate: (scope: string, value: State) => void = () => {}): PersistedStateSlice<State> => ({
  id, key: id, scope: 'task', restore: 'panes', version: 1, unknownIds: 'retain-inert',
  codec: { parse: (raw) => JSON.parse(String(raw)), serialize: vi.fn((value) => ({ keep: value.keep })) },
  empty: () => ({ keep: 0, transient: 0 }), binding: { values, hydrate },
})
const cleanups: (() => void)[] = []
const boot = (slices: () => readonly PersistedStateSlice<unknown>[], prefs: Record<string, string>, client = new QueryClient()) => {
  cleanups.push(createRoot((dispose) => { createStartupRestore({ queryClient: client, ready: () => true, prefs: () => prefs, slices }); return dispose }))
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.savePref.mockResolvedValue(true); setActiveNode(null) })
afterEach(() => { for (const dispose of cleanups.splice(0)) dispose(); setActiveNode(null); vi.useRealTimers() })

describe('independent persisted slice effects', () => {
  it('serializes only the changed slice, retains deep dependencies, and does not recreate siblings on registry changes', async () => {
    const [a, setA] = createStore({ task: { keep: 0, transient: 0 } })
    const [b] = createSignal({ task: { keep: 0, transient: 0 } })
    const first = slice('a', () => a), second = slice('b', b)
    const [registry, setRegistry] = createSignal<readonly PersistedStateSlice<unknown>[]>([first, second])
    boot(registry, { [storageKeyFor(first, 'task')]: '{"keep":0}', [storageKeyFor(second, 'task')]: '{"keep":0}' })
    vi.mocked(first.codec.serialize).mockClear(); vi.mocked(second.codec.serialize).mockClear()
    setA('task', 'keep', 1)
    expect(first.codec.serialize).toHaveBeenCalledTimes(1)
    expect(second.codec.serialize).not.toHaveBeenCalled()
    setRegistry([first, second, slice('late', () => ({}))])
    expect(first.codec.serialize).toHaveBeenCalledTimes(1)
    expect(second.codec.serialize).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref.mock.calls.map((call) => call[1])).toEqual([storageKeyFor(first, 'task')])
  })

  it('keeps an equal queued raw value on its first deadline and cancels a change reverted before flush', async () => {
    const [state, setState] = createSignal({ task: { keep: 0, transient: 0 } })
    const descriptor = slice('debounce', state)
    boot(() => [descriptor], { [storageKeyFor(descriptor, 'task')]: '{"keep":0}' })
    setState({ task: { keep: 1, transient: 0 } })
    await vi.advanceTimersByTimeAsync(400)
    setState({ task: { keep: 1, transient: 1 } })
    await vi.advanceTimersByTimeAsync(100)
    expect(mocks.savePref).toHaveBeenCalledTimes(1)
    setState({ task: { keep: 2, transient: 1 } })
    setState({ task: { keep: 1, transient: 2 } })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref).toHaveBeenCalledTimes(1)
  })

  it('cancels 0 to 1 to 0 before the first deadline', async () => {
    const [state, setState] = createSignal({ task: { keep: 0, transient: 0 } })
    const descriptor = slice('revert', state)
    boot(() => [descriptor], { [storageKeyFor(descriptor, 'task')]: '{"keep":0}' })
    setState({ task: { keep: 1, transient: 0 } }); setState({ task: { keep: 0, transient: 0 } })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref).not.toHaveBeenCalled()
  })

  it('writes a reversion behind an in-flight change and preserves a newer unsaved value after acknowledgment', async () => {
    const [state, setState] = createSignal({ task: { keep: 0, transient: 0 } })
    const descriptor = slice('inflight', state)
    let acknowledge!: (saved: boolean) => void
    mocks.savePref.mockImplementationOnce(() => new Promise<boolean>((resolve) => { acknowledge = resolve }))
    boot(() => [descriptor], { [storageKeyFor(descriptor, 'task')]: '{"keep":0}' })
    setState({ task: { keep: 1, transient: 0 } })
    await vi.advanceTimersByTimeAsync(500)
    setState({ task: { keep: 0, transient: 0 } })
    acknowledge(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref.mock.calls.map((call) => call[2])).toEqual(['{"keep":1}', '{"keep":0}'])
    mocks.savePref.mockImplementationOnce(() => new Promise<boolean>((resolve) => { acknowledge = resolve }))
    setState({ task: { keep: 1, transient: 0 } })
    await vi.advanceTimersByTimeAsync(500)
    setState({ task: { keep: 2, transient: 0 } })
    acknowledge(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref.mock.calls.at(-1)?.[2]).toBe('{"keep":2}')
  })

  it('retries failed values, flushes queued cleanup to the captured Node, and preserves disabled stored scopes', async () => {
    const [state, setState] = createSignal({ task: { keep: 0, transient: 0 } })
    const descriptor = slice('lifecycle', state)
    const [registry, setRegistry] = createSignal<readonly PersistedStateSlice<unknown>[]>([descriptor])
    const qc = new QueryClient(); registerQueryOwner(qc, 'A'); setActiveNode('A')
    const key = storageKeyFor(descriptor, 'task')
    boot(registry, { [key]: '{"keep":0}' }, qc)
    mocks.savePref.mockResolvedValueOnce(false)
    setState({ task: { keep: 1, transient: 0 } })
    await vi.advanceTimersByTimeAsync(500)
    setState({ task: { keep: 1, transient: 1 } })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref).toHaveBeenCalledTimes(2)
    setActiveNode('B')
    setState({ task: { keep: 2, transient: 1 } })
    setRegistry([])
    expect(mocks.savePref.mock.calls.at(-1)?.slice(0, 3)).toEqual([qc, key, '{"keep":2}'])
    setState({})
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref).toHaveBeenCalledTimes(3)
    expect(mocks.savePref.mock.calls.some((call) => call[2] === PERSISTED_STATE_TOMBSTONE)).toBe(false)
  })

  it('skips a malformed encoded Node prefix without stopping restore or rewriting its raw value', () => {
    const [state, setState] = createSignal<Record<string, State>>({})
    const descriptor = slice('malformed', state, (scope, value) => setState((current) => ({ ...current, [scope]: value })))
    const prefs = { 'malformed:%zz/task': '{"keep":99}', 'malformed:A/task': '{"keep":7}' }
    const qc = new QueryClient(); registerQueryOwner(qc, 'A'); setActiveNode('B')
    boot(() => [descriptor], prefs, qc)
    expect(state()).toEqual({ task: { keep: 7 } })
    expect(prefs['malformed:%zz/task']).toBe('{"keep":99}')
    expect(mocks.savePref).not.toHaveBeenCalled()
  })

  it('writes tombstones for removed active scopes and preserves maxBytes and notices failure policy', async () => {
    const [state, setState] = createSignal<Record<string, State>>({ task: { keep: 0, transient: 0 } })
    const descriptor = slice('core.notices', state)
    boot(() => [descriptor], { [storageKeyFor(descriptor, 'task')]: '{"keep":0}' })
    setState({})
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref.mock.calls[0]?.[2]).toBe(PERSISTED_STATE_TOMBSTONE)
    expect(mocks.savePref.mock.calls[0]?.[3]).toEqual({ surfaceFailure: false })
    const bounded = { ...slice('bounded', () => ({ task: { keep: 123, transient: 0 } })), maxBytes: 3 }
    boot(() => [bounded], {})
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref).toHaveBeenCalledTimes(1)
    expect(mocks.pushBackgroundError).toHaveBeenCalledWith('', 'Could not save bounded', expect.stringContaining('3 bytes'))
  })
})
