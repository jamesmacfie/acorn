import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrefKeys } from './prefKeys'
import { isDevicePref, mergePrefs, readDevicePrefs, writeDevicePref } from './devicePrefs'

const store = new Map<string, string>()
const layoutKey = `${PrefKeys.taskLayoutsScoped}:node-a/task-1`
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
    // `changes_view` is in here with `theme` and `diff_view`: how the Changes pane draws its file
    // list — flat or nested, sorted how, grouped by what — is about the person reading it, not about
    // the worktree it is a list of (plugins/changes/src/client/changesPrefs.ts).
    for (const key of [
      PrefKeys.theme, PrefKeys.style, PrefKeys.keybindings, PrefKeys.railOrder,
      PrefKeys.lastSource, PrefKeys.notices, PrefKeys.diffView, PrefKeys.changesView,
      PrefKeys.generatePick,
    ]) {
      expect(isDevicePref(key), key).toBe(true)
    }
  })

  it('leaves per-machine BEHAVIOUR on the node', () => {
    // The line is "how this window looks" versus "how that machine behaves". Agent tool permissions
    // govern what an agent running there may do; the onboarded flag and startup context injection are
    // facts about a node's setup. On the device, one laptop's answer would govern every node.
    for (const key of [PrefKeys.agentToolPermissions, PrefKeys.startupContextInjection, PrefKeys.onboarded]) {
      expect(isDevicePref(key), key).toBe(false)
    }
  })

  it('leaves the four COMPOSITION kinds on the node whose resources they describe', () => {
    // These keys describe one node's tasks and repos and must not become device preferences.
    for (const key of [PrefKeys.taskLayoutsScoped, PrefKeys.editorOpenFilesScoped, PrefKeys.prFiltersScoped, PrefKeys.contextSelectionScoped]) {
      expect(isDevicePref(key), key).toBe(false)
      expect(isDevicePref(`${key}:node-a/task-1`), key).toBe(false)
    }
    for (const key of [PrefKeys.taskLayouts, PrefKeys.editorOpenFiles, PrefKeys.prFilters, 'pane_shortcuts']) {
      expect(isDevicePref(key), key).toBe(false)
    }
  })
})

describe('the storage round trip', () => {
  it('starts empty and reads back what it wrote, under a namespaced key', () => {
    expect(readDevicePrefs()).toEqual({})
    writeDevicePref(PrefKeys.theme, 'dark')
    expect(readDevicePrefs()).toEqual({ [PrefKeys.theme]: 'dark' })
    // Namespaced, so an unrelated localStorage entry isn't mistaken for a pref.
    store.set('http-draft:task-1', '{}')
    expect(readDevicePrefs()).toEqual({ [PrefKeys.theme]: 'dark' })
  })
  it('ignores node-scoped and obsolete values without writing them to another node', () => {
    store.set('acorn-pref:theme', 'legacy')
    store.set(`acorn-pref:${layoutKey}`, '{"panes":["old"]}')
    store.set('acorn-pref:pane_shortcuts', '{"pr":"meta+p"}')
    expect(readDevicePrefs()).toEqual({})
    expect(mergePrefs({ [layoutKey]: '{"panes":["new"]}' })).toEqual({ [layoutKey]: '{"panes":["new"]}' })
    expect(store.get(`acorn-pref:${layoutKey}`)).toBe('{"panes":["old"]}')
  })

  it('reads declared keys without enumerating thousands of unrelated drafts', () => {
    for (let index = 0; index < 5_000; index++) store.set(`draft:${index}`, 'private')
    store.set('acorn-pref:acorn-1:theme', 'dark')
    const enumerate = vi.spyOn(localStorage, 'key')
    const read = vi.spyOn(localStorage, 'getItem')
    expect(readDevicePrefs()).toEqual({ theme: 'dark' })
    expect(enumerate).not.toHaveBeenCalled()
    expect(read.mock.calls.length).toBeGreaterThan(0)
    expect(read.mock.calls.length).toBeLessThan(50)
    expect(store.size).toBe(5_001)
  })

  it('returns an empty view if a declared-key read throws after a partial read', () => {
    let calls = 0
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      if (++calls === 2) throw new Error('blocked')
      return 'partial'
    })
    expect(readDevicePrefs()).toEqual({})
  })

  it('returns an empty view when localStorage is unavailable', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(readDevicePrefs()).toEqual({})
    writeDevicePref(PrefKeys.theme, 'dark')
    expect(readDevicePrefs()).toEqual({})
  })

  it('tolerates storage that exists but refuses access', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      get length() { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readDevicePrefs()).toEqual({})
    expect(() => writeDevicePref(PrefKeys.theme, 'dark')).not.toThrow()
  })
})

describe('mergePrefs', () => {
  it('uses only the owner of each key', () => {
    expect(mergePrefs({ [PrefKeys.theme]: 'dark', [PrefKeys.onboarded]: 'true' }, { [PrefKeys.theme]: 'light' }))
      .toEqual({ [PrefKeys.theme]: 'light', [PrefKeys.onboarded]: 'true' })
    expect(mergePrefs({ [PrefKeys.theme]: 'dark', [PrefKeys.onboarded]: 'true' }, {}))
      .toEqual({ [PrefKeys.onboarded]: 'true' })
  })

  it('keeps node-owned layouts independent of local storage', () => {
    store.set(`acorn-pref:${layoutKey}`, '{"panes":["stale"]}')
    expect(mergePrefs({ [layoutKey]: '{"panes":["fresh"]}' })).toEqual({ [layoutKey]: '{"panes":["fresh"]}' })
  })
})
