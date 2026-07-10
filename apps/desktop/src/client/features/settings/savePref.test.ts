import { QueryClient } from '@tanstack/solid-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prefsKey } from '../../../shared/api'
import { persistedStateRegistry } from '../../persistence/persistedState'

const mocks = vi.hoisted(() => ({
  setPref: vi.fn(),
  pushBackgroundError: vi.fn(),
}))
vi.mock('../../mutations', () => ({ setPref: mocks.setPref }))
vi.mock('../notifications/notifications', () => ({ pushBackgroundError: mocks.pushBackgroundError }))

import { savePref } from './savePref'

describe('savePref', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes the optimistic value and keeps it after a successful write', async () => {
    const client = new QueryClient()
    client.setQueryData(prefsKey, { theme: 'light' })
    mocks.setPref.mockResolvedValue({ key: 'theme', value: 'dark' })
    const pending = savePref(client, 'theme', 'dark')
    expect(client.getQueryData(prefsKey)).toEqual({ theme: 'dark' })
    await expect(pending).resolves.toBe(true)
    expect(mocks.pushBackgroundError).not.toHaveBeenCalled()
  })

  it('rolls back the attempted value and surfaces a notice on failure', async () => {
    const client = new QueryClient()
    client.setQueryData(prefsKey, { theme: 'light' })
    mocks.setPref.mockRejectedValue(new Error('disk full'))
    await expect(savePref(client, 'theme', 'dark')).resolves.toBe(false)
    expect(client.getQueryData(prefsKey)).toEqual({ theme: 'light' })
    expect(mocks.pushBackgroundError).toHaveBeenCalledWith('', 'Could not save theme', 'disk full')
  })

  it('does not let an older equal-value failure roll back a newer successful attempt', async () => {
    const client = new QueryClient()
    client.setQueryData(prefsKey, { theme: 'light' })
    mocks.setPref.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ key: 'theme', value: 'dark' })

    const first = savePref(client, 'theme', 'dark')
    const second = savePref(client, 'theme', 'dark')

    await expect(Promise.all([first, second])).resolves.toEqual([false, true])
    expect(client.getQueryData(prefsKey)).toEqual({ theme: 'dark' })
  })

  it('refuses an oversize descriptor value before writing', async () => {
    const registration = persistedStateRegistry.register({
      id: 'test.bounded', key: 'test-bounded', scope: 'app', restore: 'view', version: 1,
      codec: { parse: String, serialize: String }, empty: () => '', unknownIds: 'drop', maxBytes: 3,
    })
    try {
      const client = new QueryClient()
      await expect(savePref(client, 'test-bounded', 'four')).resolves.toBe(false)
      expect(mocks.setPref).not.toHaveBeenCalled()
      expect(mocks.pushBackgroundError).toHaveBeenCalledWith('', 'Could not save test.bounded', 'Persisted value exceeds 3 bytes.')
    } finally {
      registration.dispose()
    }
  })
})
