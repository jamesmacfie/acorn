import { QueryClient } from '@tanstack/solid-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prefsKey } from '@acorn/protocol/api.ts'
import { persistedStateRegistry } from '../persistence/persistedState'

const mocks = vi.hoisted(() => ({
  writeJson: vi.fn(),
  pushBackgroundError: vi.fn(),
}))
// savePref owns the pref write itself now, so stub the transport rather than a sibling module.
vi.mock('../apiClient', () => ({ writeJson: mocks.writeJson }))
vi.mock('../notifications/notifications', () => ({ pushBackgroundError: mocks.pushBackgroundError }))

import { savePref } from './savePref'

const NODE_PREF = 'agent_tool_permissions'

const withLocalStorage = <T>(run: () => T): T => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  }
  ;(globalThis as { __store?: Map<string, string> }).__store = store
  try {
    return run()
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage
  }
}

describe('savePref', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes the optimistic value and keeps it after a successful write', async () => {
    const client = new QueryClient()
    client.setQueryData(prefsKey, { [NODE_PREF]: 'light' })
    mocks.writeJson.mockResolvedValue({ key: NODE_PREF, value: 'dark' })
    const pending = savePref(client, NODE_PREF, 'dark')
    expect(client.getQueryData(prefsKey)).toEqual({ [NODE_PREF]: 'dark' })
    await expect(pending).resolves.toBe(true)
    expect(mocks.pushBackgroundError).not.toHaveBeenCalled()
  })

  it('rolls back the attempted value and surfaces a notice on failure', async () => {
    const client = new QueryClient()
    client.setQueryData(prefsKey, { [NODE_PREF]: 'light' })
    mocks.writeJson.mockRejectedValue(new Error('disk full'))
    await expect(savePref(client, NODE_PREF, 'dark')).resolves.toBe(false)
    expect(client.getQueryData(prefsKey)).toEqual({ [NODE_PREF]: 'light' })
    expect(mocks.pushBackgroundError).toHaveBeenCalledWith('', `Could not save ${NODE_PREF}`, 'disk full')
  })

  it('does not let an older equal-value failure roll back a newer successful attempt', async () => {
    const client = new QueryClient()
    client.setQueryData(prefsKey, { [NODE_PREF]: 'light' })
    mocks.writeJson.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ key: NODE_PREF, value: 'dark' })

    const first = savePref(client, NODE_PREF, 'dark')
    const second = savePref(client, NODE_PREF, 'dark')

    await expect(Promise.all([first, second])).resolves.toEqual([false, true])
    expect(client.getQueryData(prefsKey)).toEqual({ [NODE_PREF]: 'dark' })
  })

  it('writes a DEVICE pref locally and never reaches a node', async () => {
    // The whole point of the tier: `theme` is a property of this installation, `localStorage.setItem` cannot
    // fail in a way a retry would fix, and the optimistic-write-and-roll-back dance above exists for a network
    // round trip that no longer happens. The cache write still happens, because that is what every reactive
    // reader sees.
    await withLocalStorage(async () => {
      const client = new QueryClient()
      client.setQueryData(prefsKey, { theme: 'light' })
      await expect(savePref(client, 'theme', 'dark')).resolves.toBe(true)
      expect(client.getQueryData(prefsKey)).toEqual({ theme: 'dark' })
      expect(mocks.writeJson).not.toHaveBeenCalled()
      expect([...(globalThis as { __store?: Map<string, string> }).__store!.entries()]).toEqual([['acorn-pref:theme', 'dark']])
    })
  })

  it('refuses an oversize descriptor value before writing', async () => {
    const registration = persistedStateRegistry.register({
      id: 'test.bounded', key: 'test-bounded', scope: 'app', restore: 'view', version: 1,
      codec: { parse: String, serialize: String }, empty: () => '', unknownIds: 'drop', maxBytes: 3,
    })
    try {
      const client = new QueryClient()
      await expect(savePref(client, 'test-bounded', 'four')).resolves.toBe(false)
      expect(mocks.writeJson).not.toHaveBeenCalled()
      expect(mocks.pushBackgroundError).toHaveBeenCalledWith('', 'Could not save test.bounded', 'Persisted value exceeds 3 bytes.')
    } finally {
      registration.dispose()
    }
  })
})
