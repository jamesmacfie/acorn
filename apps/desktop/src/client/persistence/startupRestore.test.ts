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
      legacy: () => ({ '': id }),
    })
    restorePersistedSlices([make('panes', 'panes'), make('workspace', 'workspace'), make('view', 'view')], {})
    expect(restored).toEqual(['workspace', 'view', 'panes'])
  })

  it('derives scoped keys and prefers canonical values over a legacy aggregate', () => {
    const hydrated: [string, string][] = []
    const descriptor = slice<string>({
      id: 'layout',
      key: 'core:layout',
      scope: 'task',
      restore: 'panes',
      codec: { parse: String, serialize: String },
      empty: () => '',
      binding: { values: () => ({}), hydrate: (id, value) => hydrated.push([id, value]) },
      legacy: () => ({ 'task/one': 'old', untouched: 'legacy' }),
    })
    const key = storageKeyFor(descriptor, 'task/one')
    expect(key).toBe('core:layout:task%2Fone')
    expect(scopeIdFromStorageKey(descriptor, key)).toBe('task/one')
    restorePersistedSlices([descriptor], { [key]: 'new' })
    expect(hydrated).toEqual([['task/one', 'new'], ['untouched', 'legacy']])
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

  it('uses scoped tombstones so an evicted legacy value cannot return', () => {
    const hydrated: string[] = []
    const descriptor = slice<string>({
      id: 'filter', key: 'filter', scope: 'workspace', restore: 'view',
      codec: { parse: String, serialize: String }, empty: () => '',
      binding: { values: () => ({}), hydrate: (id) => hydrated.push(id) },
      legacy: () => ({ removed: 'old', retained: 'old' }),
    })
    restorePersistedSlices([descriptor], {
      [storageKeyFor(descriptor, 'removed')]: PERSISTED_STATE_TOMBSTONE,
    })
    expect(hydrated).toEqual(['retained'])
  })
})
