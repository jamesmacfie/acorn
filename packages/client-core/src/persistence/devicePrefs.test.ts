import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrefKeys } from './prefKeys'
import { isDevicePref, mergePrefs, readDevicePrefs, seedDevicePrefs, writeDevicePref } from './devicePrefs'

// The device-prefs tier closes the last recorded Phase 1 divergence (docs/vNext/data.md § Client cache).
// What matters is where the line falls and that an existing install keeps its settings across it.

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return store.size },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  }
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('isDevicePref', () => {
  it('claims presentation and window state', () => {
    for (const key of [PrefKeys.theme, PrefKeys.style, PrefKeys.keybindings, PrefKeys.railOrder, PrefKeys.leftCollapsed, PrefKeys.lastSource, PrefKeys.notices]) {
      expect(isDevicePref(key), key).toBe(true)
    }
  })

  it('leaves per-machine BEHAVIOUR on the node', () => {
    // The line is "how this window looks" versus "how that machine behaves". Agent tool permissions govern
    // what an agent running THERE may do; the onboarded flag and startup context injection are facts about a
    // node's own setup. Moving them to the device would have made one laptop's answer govern every node.
    for (const key of [PrefKeys.agentToolPermissions, PrefKeys.startupContextInjection, PrefKeys.onboarded]) {
      expect(isDevicePref(key), key).toBe(false)
    }
  })

  it('claims a SCOPED slice key, which appends an id to its base', () => {
    // `core:task-layouts:<nodeId>/<taskId>`. Matching the whole string would classify every per-task
    // layout as a node pref, which is the bug this test exists for: they are the keys that made the old
    // arrangement unsafe (a remote task's layout stored under a bare task id).
    expect(isDevicePref(`${PrefKeys.taskLayoutsScoped}:node-a/task-1`)).toBe(true)
    expect(isDevicePref(`${PrefKeys.editorOpenFilesScoped}:node-a/task-1`)).toBe(true)
    expect(isDevicePref(`${PrefKeys.agentToolPermissions}:anything`)).toBe(false)
  })
})

describe('the storage round trip', () => {
  it('reads back what it wrote, under a namespaced key', () => {
    writeDevicePref(PrefKeys.theme, 'dark')
    expect(readDevicePrefs()).toEqual({ [PrefKeys.theme]: 'dark' })
    // Namespaced, so an unrelated localStorage entry (a plugin's own draft, say) is not mistaken for a pref.
    store.set('http-draft:task-1', '{}')
    expect(readDevicePrefs()).toEqual({ [PrefKeys.theme]: 'dark' })
  })
})

describe('seedDevicePrefs', () => {
  it('copies the node\'s existing values across once, so an upgrade keeps the theme', () => {
    seedDevicePrefs({ [PrefKeys.theme]: 'dark', [PrefKeys.agentToolPermissions]: '{}' })
    // Only the device keys — a node pref copied into localStorage would be read from two places.
    expect(readDevicePrefs()).toEqual({ [PrefKeys.theme]: 'dark' })
  })

  it('never overwrites a value the device already has', () => {
    // The seed runs on every prefs fetch, so this is what stops the node's stale copy from clobbering a
    // change made since the upgrade.
    writeDevicePref(PrefKeys.theme, 'light')
    seedDevicePrefs({ [PrefKeys.theme]: 'dark' })
    expect(readDevicePrefs()[PrefKeys.theme]).toBe('light')
  })
})

describe('mergePrefs', () => {
  it('lets the device win, so a stale node copy cannot resurrect itself', () => {
    expect(mergePrefs({ [PrefKeys.theme]: 'dark', [PrefKeys.onboarded]: 'true' }, { [PrefKeys.theme]: 'light' }))
      .toEqual({ [PrefKeys.theme]: 'light', [PrefKeys.onboarded]: 'true' })
  })
})
