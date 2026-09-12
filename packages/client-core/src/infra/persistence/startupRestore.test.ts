import { describe, expect, it } from 'vitest'
import { PERSISTED_STATE_TOMBSTONE, restorePersistedSlices } from './startupRestore'
import { scopeIdFromStorageKey, storageKeyFor, stringifyPersistedValue, utf8Bytes, type PersistedStateSlice } from './persistedState'

const slice = <T>(overrides: Partial<PersistedStateSlice<T>> & Pick<PersistedStateSlice<T>, 'id' | 'key' | 'codec' | 'empty'>): PersistedStateSlice<T> => ({
  scope: 'app',
  restore: 'workspace',
  version: 1,
  unknownIds: 'drop',
  ...overrides,
})

describe('persisted state descriptors', () => {
  it('restores in declared phase order, independent of registration order', () => {
    const restored: string[] = []
    const make = (id: string, phase: 'workspace' | 'view' | 'panes') => slice<string>({
      id,
      key: id,
      restore: phase,
      codec: { parse: String, serialize: String },
      empty: () => '',
      binding: { values: () => ({}), hydrate: () => restored.push(id) },
    })
    restorePersistedSlices(
      [make('panes', 'panes'), make('workspace', 'workspace'), make('view', 'view')],
      { panes: 'p', workspace: 'w', view: 'v' },
    )
    expect(restored).toEqual(['workspace', 'view', 'panes'])
  })

  it('derives scoped keys, and hydrates every scope it finds one for', () => {
    const hydrated: [string, string][] = []
    const descriptor = slice<string>({
      id: 'layout',
      key: 'core:layout',
      scope: 'task',
      restore: 'panes',
      codec: { parse: String, serialize: String },
      empty: () => '',
      binding: { values: () => ({}), hydrate: (id, value) => hydrated.push([id, value]) },
    })
    const key = storageKeyFor(descriptor, 'task/one')
    const other = storageKeyFor(descriptor, 'task/two')
    expect(key).toBe('core:layout:task%2Fone')
    expect(scopeIdFromStorageKey(descriptor, key)).toBe('task/one')
    restorePersistedSlices([descriptor], { [key]: 'new', [other]: 'also', unrelated: 'ignored' })
    expect(hydrated).toEqual([['task/one', 'new'], ['task/two', 'also']])
  })

  it('serializes only codec output and exposes a UTF-8 byte guard', () => {
    const descriptor = slice<{ keep: string; transient: string }>({
      id: 'bounded',
      key: 'bounded',
      codec: { parse: () => ({ keep: '', transient: '' }), serialize: (value) => ({ keep: value.keep }) },
      empty: () => ({ keep: '', transient: '' }),
    })
    const raw = stringifyPersistedValue(descriptor, { keep: 'é', transient: 'drop-me' })
    expect(raw).toBe('{"keep":"é"}')
    expect(utf8Bytes(raw)).toBeGreaterThan(raw.length)
  })

  it('skips a tombstoned scope instead of parsing the marker as a value', () => {
    const hydrated: string[] = []
    const descriptor = slice<string>({
      id: 'filter', key: 'filter', scope: 'workspace', restore: 'view',
      codec: { parse: String, serialize: String }, empty: () => '',
      binding: { values: () => ({}), hydrate: (id) => hydrated.push(id) },
    })
    restorePersistedSlices([descriptor], {
      [storageKeyFor(descriptor, 'removed')]: PERSISTED_STATE_TOMBSTONE,
      [storageKeyFor(descriptor, 'retained')]: 'kept',
    })
    // A tombstone is what the node holds for a scope the user removed. Without the skip it would
    // hydrate the literal `{"__acorn_deleted":true}` as that scope's value.
    expect(hydrated).toEqual(['retained'])
  })
})
