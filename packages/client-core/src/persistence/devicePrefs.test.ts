import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrefKeys } from './prefKeys'
import { drainMigratedPrefs, isDevicePref, mergePrefs, readDevicePrefs, seedDevicePrefs, writeDevicePref } from './devicePrefs'

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
    for (const key of [PrefKeys.theme, PrefKeys.style, PrefKeys.keybindings, PrefKeys.railOrder, PrefKeys.leftCollapsed, PrefKeys.lastSource, PrefKeys.notices]) {
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
    // A pane layout, an open-file set, a repo's PR filters and a context selection are facts about one
    // node's tasks and repos, so every client paired with that node should render them and the agent
    // should be able to read them. They used to be device-local, which is why the keys and their
    // `<nodeId>/<taskId>` suffixes are checked here rather than assumed.
    for (const key of [PrefKeys.taskLayoutsScoped, PrefKeys.editorOpenFilesScoped, PrefKeys.prFiltersScoped, PrefKeys.contextSelectionScoped]) {
      expect(isDevicePref(key), key).toBe(false)
      expect(isDevicePref(`${key}:node-a/task-1`), key).toBe(false)
    }
    // …and their pre-scoped aggregates, which the slices still read as legacy input.
    for (const key of [PrefKeys.taskLayouts, PrefKeys.taskPanesLegacy, PrefKeys.editorOpenFiles, PrefKeys.prFilters]) {
      expect(isDevicePref(key), key).toBe(false)
    }
  })
})

describe('the storage round trip', () => {
  it('reads back what it wrote, under a namespaced key', () => {
    writeDevicePref(PrefKeys.theme, 'dark')
    expect(readDevicePrefs()).toEqual({ [PrefKeys.theme]: 'dark' })
    // Namespaced, so an unrelated localStorage entry isn't mistaken for a pref.
    store.set('http-draft:task-1', '{}')
    expect(readDevicePrefs()).toEqual({ [PrefKeys.theme]: 'dark' })
  })
})

describe('seedDevicePrefs', () => {
  it('copies the node\'s existing values across once, so an upgrade keeps the theme', () => {
    seedDevicePrefs({ [PrefKeys.theme]: 'dark', [PrefKeys.agentToolPermissions]: '{}' })
    // Only the device keys: a node pref copied into localStorage would be read from two places.
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

  it('ignores a leftover under a key that has since moved to the node', () => {
    // The device-wins rule is why this matters: left visible, a stale local layout would shadow the
    // node's copy forever and no other client's write would show up.
    store.set(`acorn-pref:${layoutKey}`, '{"panes":["stale"]}')
    expect(mergePrefs({ [layoutKey]: '{"panes":["fresh"]}' })).toEqual({ [layoutKey]: '{"panes":["fresh"]}' })
  })
})

describe('drainMigratedPrefs', () => {
  it('hands each moved key to the node once, then forgets it locally', async () => {
    store.set(`acorn-pref:${layoutKey}`, '{"panes":["local"]}')
    store.set(`acorn-pref:${PrefKeys.taskLayouts}`, '{}')
    writeDevicePref(PrefKeys.theme, 'dark')
    const written: [string, string][] = []

    const drained = await drainMigratedPrefs('node-a', {}, async (key, value) => void written.push([key, value]))

    // The pre-scoped aggregate goes too: it's a legacy input to the same slice, and leaving it on the
    // device would keep the same fact in two places.
    expect(written).toEqual([[layoutKey, '{"panes":["local"]}'], [PrefKeys.taskLayouts, '{}']])
    expect(drained).toEqual({ [layoutKey]: '{"panes":["local"]}', [PrefKeys.taskLayouts]: '{}' })
    expect(store.has(`acorn-pref:${layoutKey}`)).toBe(false)
    // A device pref is not a straggler.
    expect(store.get(`acorn-pref:${PrefKeys.theme}`)).toBe('dark')
  })

  it('leaves another node\'s keys alone, rather than handing them to whichever node is active', async () => {
    // The failure this prevents is silent and total: node B's layouts PUT to node A and deleted from the
    // only place they existed.
    store.set(`acorn-pref:${layoutKey}`, '{"panes":["a"]}')
    const written: string[] = []

    const drained = await drainMigratedPrefs('node-b', {}, async (key) => void written.push(key))

    expect(written).toEqual([])
    expect(drained).toEqual({})
    expect(store.get(`acorn-pref:${layoutKey}`)).toBe('{"panes":["a"]}')
  })

  it('drops the local copy without a write when the node already agrees', async () => {
    store.set(`acorn-pref:${layoutKey}`, '{"panes":["same"]}')
    const written: string[] = []

    await drainMigratedPrefs('node-a', { [layoutKey]: '{"panes":["same"]}' }, async (key) => void written.push(key))

    expect(written).toEqual([])
    expect(store.has(`acorn-pref:${layoutKey}`)).toBe(false)
  })

  it('keeps the value when the node refuses it, so the next fetch retries', async () => {
    store.set(`acorn-pref:${layoutKey}`, '{"panes":["local"]}')

    const drained = await drainMigratedPrefs('node-a', {}, () => Promise.reject(new Error('offline')))

    expect(drained).toEqual({})
    expect(store.get(`acorn-pref:${layoutKey}`)).toBe('{"panes":["local"]}')
  })
})
