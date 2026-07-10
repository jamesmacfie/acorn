import { QueryClient } from '@tanstack/solid-query'
import { createRoot, createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storageKeyFor, type PersistedStateSlice } from './persistedState'

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  pushBackgroundError: vi.fn(),
  savePref: vi.fn(),
}))
vi.mock('solid-js', async () => vi.importActual('solid-js/dist/solid.js'))
vi.mock('../registries/clientEvents', () => ({ clientEvents: { emit: mocks.emit } }))
vi.mock('../notifications/notifications', () => ({ pushBackgroundError: mocks.pushBackgroundError }))
vi.mock('../settings/savePref', () => ({ savePref: mocks.savePref }))

import { createStartupRestore } from './startupRestore'

type LateState = { count: number }

describe('startup restore lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.savePref.mockResolvedValue(true)
  })
  afterEach(() => vi.useRealTimers())

  it('hydrates and persists a descriptor registered after boot', async () => {
    const [state, setState] = createSignal<Record<string, LateState>>({})
    const descriptor: PersistedStateSlice<LateState> = {
      id: 'plugin.late',
      key: 'plugin:late',
      scope: 'task',
      restore: 'panes',
      version: 1,
      codec: {
        parse: (raw) => {
          const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
          return value && typeof value === 'object' && typeof (value as { count?: unknown }).count === 'number'
            ? value as LateState
            : { count: 0 }
        },
        serialize: (value) => value,
      },
      empty: () => ({ count: 0 }),
      unknownIds: 'retain-inert',
      binding: {
        values: state,
        hydrate: (scopeId, value) => setState((current) => ({ ...current, [scopeId]: value })),
      },
    }
    const storedKey = storageKeyFor(descriptor, 'task-1')
    const prefs = { [storedKey]: JSON.stringify({ count: 2 }) }
    const [slices, setSlices] = createSignal<readonly PersistedStateSlice<unknown>[]>([])

    const dispose = createRoot((dispose) => {
      createStartupRestore({
        queryClient: new QueryClient(),
        prefs: () => prefs,
        ready: () => true,
        slices,
      })
      return dispose
    })

    setSlices([descriptor as PersistedStateSlice<unknown>])
    expect(state()).toEqual({ 'task-1': { count: 2 } })
    expect(mocks.savePref).not.toHaveBeenCalled()

    setState({ 'task-1': { count: 3 } })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.savePref).toHaveBeenCalledWith(
      expect.any(QueryClient),
      storedKey,
      JSON.stringify({ count: 3 }),
      { surfaceFailure: true },
    )
    dispose()
  })
})
