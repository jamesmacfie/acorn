import { QueryClient, QueryObserver } from '@tanstack/solid-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prefsKey } from '@acorn/protocol/api.ts'
import { persistedStateRegistry } from '../../infra/persistence/persistedState'
import { mergePrefs } from '../../infra/persistence/devicePrefs'

const mocks = vi.hoisted(() => ({
  writeJson: vi.fn(),
  pushBackgroundError: vi.fn(),
}))
// savePref owns the pref write itself, so stub the transport.
vi.mock('../../infra/node/apiClient', () => ({ readJson: vi.fn(), writeJson: mocks.writeJson }))
vi.mock('../notifications/notifications', () => ({ pushBackgroundError: mocks.pushBackgroundError }))

import { savePref } from './savePref'

const NODE_PREF = 'agent_tool_permissions'

const withLocalStorage = <T>(run: () => T): T => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return store.size
    },
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

  it('writes plugin state without putting it in the cached map', async () => {
    const client = new QueryClient()
    client.setQueryData(prefsKey, { [NODE_PREF]: 'light' })
    mocks.writeJson.mockResolvedValue({})
    await expect(savePref(client, 'plugin:board:columns', '[1,2]')).resolves.toBe(true)
    expect(mocks.writeJson).toHaveBeenCalledWith(
      '/v1/core/prefs',
      expect.objectContaining({ body: JSON.stringify({ key: 'plugin:board:columns', value: '[1,2]' }) }),
      expect.any(Function),
    )
    expect(client.getQueryData(prefsKey)).toEqual({ [NODE_PREF]: 'light' })
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
    mocks.writeJson
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ key: NODE_PREF, value: 'dark' })

    const first = savePref(client, NODE_PREF, 'dark')
    const second = savePref(client, NODE_PREF, 'dark')

    await expect(Promise.all([first, second])).resolves.toEqual([false, true])
    expect(client.getQueryData(prefsKey)).toEqual({ [NODE_PREF]: 'dark' })
  })

  it('leaves an empty prefs cache empty, so a write cannot pose as the node answer', async () => {
    // The startup restore takes a freshly stamped prefs map as the node's answer. A map holding only
    // the keys written before the first fetch landed would hydrate every other slice to its default.
    await withLocalStorage(async () => {
      const client = new QueryClient()
      mocks.writeJson.mockResolvedValue({})
      await expect(savePref(client, 'theme', 'dark')).resolves.toBe(true)
      await expect(savePref(client, NODE_PREF, 'on')).resolves.toBe(true)
      mocks.writeJson.mockRejectedValueOnce(new Error('offline'))
      await expect(savePref(client, NODE_PREF, 'off')).resolves.toBe(false)
      expect(client.getQueryState(prefsKey)).toBeUndefined()
    })
  })

  it('writes a DEVICE pref locally and never reaches a node', async () => {
    // The point of the tier: `theme` is a property of this installation, `localStorage.setItem`
    // cannot fail in a way a retry would fix, and there is no network round trip to roll back. The
    // cache write still happens, because that is what every reactive reader sees.
    await withLocalStorage(async () => {
      const client = new QueryClient()
      client.setQueryData(prefsKey, { theme: 'light' })
      await expect(savePref(client, 'theme', 'dark')).resolves.toBe(true)
      expect(client.getQueryData(prefsKey)).toEqual({ theme: 'dark' })
      expect(mocks.writeJson).not.toHaveBeenCalled()
      expect([...(globalThis as { __store?: Map<string, string> }).__store!.entries()]).toEqual([
        ['acorn-pref:acorn-1:theme', 'dark'],
      ])
    })
  })

  it('has the DEVICE value in localStorage before the cache notifies', async () => {
    // Readers see prefs through `prefsOptions.select` = mergePrefs(raw, readDevicePrefs()), where
    // device wins. So the cache write must land after localStorage, or select recomputes against the
    // old device value and discards the new one, and a theme or style change appears to do nothing
    // until an unrelated pref write re-runs select.
    await withLocalStorage(async () => {
      const client = new QueryClient()
      client.setQueryData(prefsKey, { style: 'terminal' })
      // Seed the device tier, which is the point: with localStorage empty the stale read the bug
      // depends on contributes nothing and the assertion below passes either way.
      localStorage.setItem('acorn-pref:acorn-1:style', 'terminal')
      // The shape every reader actually observes: prefsOptions' select over the raw cache.
      const observer = new QueryObserver<Record<string, string>, Error, Record<string, string>>(client, {
        queryKey: prefsKey,
        enabled: false,
        select: mergePrefs,
      })
      const unsubscribe = observer.subscribe(() => {})
      try {
        await savePref(client, 'style', 'cozy')
        expect(observer.getCurrentResult().data?.style).toBe('cozy')
      } finally {
        unsubscribe()
      }
    })
  })

  it('refuses an oversize descriptor value before writing', async () => {
    const registration = persistedStateRegistry.register({
      id: 'test.bounded',
      key: 'test-bounded',
      scope: 'app',
      restore: 'view',
      version: 1,
      codec: { parse: String, serialize: String },
      empty: () => '',
      unknownIds: 'drop',
      maxBytes: 3,
    })
    try {
      const client = new QueryClient()
      await expect(savePref(client, 'test-bounded', 'four')).resolves.toBe(false)
      expect(mocks.writeJson).not.toHaveBeenCalled()
      expect(mocks.pushBackgroundError).toHaveBeenCalledWith(
        '',
        'Could not save test.bounded',
        'Persisted value exceeds 3 bytes.',
      )
    } finally {
      registration.dispose()
    }
  })
})
