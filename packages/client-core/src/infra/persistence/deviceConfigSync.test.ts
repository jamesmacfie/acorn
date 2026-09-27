import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import { configPluginOffers, startDeviceConfigSync } from './deviceConfigSync'
import { readDevicePrefs } from './devicePrefs'
import { PrefKeys } from './prefKeys'
import { savePref } from '../../features/settings/savePref'

const values = new Map<string, string>()
const storage = {
  get length() { return values.size },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
  removeItem: (key: string) => void values.delete(key),
  clear: () => values.clear(),
}
afterEach(() => { vi.unstubAllGlobals(); values.clear() })

describe('device config synchronization', () => {
  it('applies file values through device prefs and treats plugin entries as install offers', async () => {
    vi.stubGlobal('localStorage', storage)
    const write = vi.fn(async () => ({ config: {} }))
    const read = vi.fn(async () => ({ config: { style: 'modern', plugins: [{ id: 'board', source: { github: 'owner/board' } }] } }))
    vi.stubGlobal('window', { acorn: { config: { read, write, onChange: () => () => {}, location: async () => '/tmp/acorn.json' } } })
    const client = new QueryClient()
    client.setQueryData(prefsKey, {})
    const stop = await startDeviceConfigSync(() => client)
    expect(readDevicePrefs()[PrefKeys.style]).toBe('modern')
    expect(client.getQueryData<Record<string, string>>(prefsKey)?.[PrefKeys.style]).toBe('modern')
    expect(configPluginOffers(new Set())).toEqual([{ id: 'board', source: { github: 'owner/board' } }])
    expect(write).not.toHaveBeenCalled()
    await savePref(client, PrefKeys.style, 'cute')
    expect(write).toHaveBeenCalledWith({ style: 'cute' })
    stop()
  })
})
