import { Registry } from '../registries/registry'

export type PersistedStateScope = 'app' | 'workspace' | 'task' | 'pane'
export type RestorePhase = 'workspace' | 'view' | 'panes'

export type PersistedStateCodec<T> = {
  parse(raw: unknown): T
  serialize(value: T): unknown
}

export type PersistedStateBinding<T> = {
  // App slices use the empty id. Scoped slices use their workspace/task/pane id.
  values(): Readonly<Record<string, T>>
  hydrate(scopeId: string, value: T): void
  evict?(scopeId: string): void
}

export type PersistedStateSlice<T> = {
  id: string
  key: string
  scope: PersistedStateScope
  restore: RestorePhase
  version: number
  codec: PersistedStateCodec<T>
  empty(scopeId: string): T
  unknownIds: 'retain-inert' | 'drop'
  maxBytes?: number
  binding?: PersistedStateBinding<T>
  // Aggregate prefs are compatibility-only inputs. Canonical scoped keys always win.
  legacy?: (prefs: Readonly<Record<string, string>>) => Readonly<Record<string, unknown>>
}

export const persistedStateRegistry = new Registry<PersistedStateSlice<unknown>>('persisted-state')

export const appStateBinding = <T>(read: () => T, hydrate: (value: T) => void): PersistedStateBinding<T> => ({
  values: () => ({ '': read() }),
  hydrate: (_scopeId, value) => hydrate(value),
})

export const storageKeyFor = (slice: Pick<PersistedStateSlice<unknown>, 'key' | 'scope'>, scopeId: string): string =>
  slice.scope === 'app' ? slice.key : `${slice.key}:${encodeURIComponent(scopeId)}`

export const scopeIdFromStorageKey = (slice: Pick<PersistedStateSlice<unknown>, 'key' | 'scope'>, key: string): string | null => {
  if (slice.scope === 'app') return key === slice.key ? '' : null
  const prefix = `${slice.key}:`
  if (!key.startsWith(prefix)) return null
  try {
    return decodeURIComponent(key.slice(prefix.length))
  } catch {
    return null
  }
}

export function stringifyPersistedValue<T>(slice: PersistedStateSlice<T>, value: T): string {
  const encoded = slice.codec.serialize(value)
  return typeof encoded === 'string' ? encoded : JSON.stringify(encoded)
}

export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength
