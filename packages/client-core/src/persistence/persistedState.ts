import { activeNodeId } from '../node/activeNode'
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

// Every slice codec parses the same way: a persisted value arrives as a JSON string, but a legacy or
// already-decoded value can arrive as the object itself. Malformed input returns undefined; codecs
// are required to tolerate it (persistedState.conformance.test.ts).
export const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

export const appStateBinding = <T>(read: () => T, hydrate: (value: T) => void): PersistedStateBinding<T> => ({
  values: () => ({ '': read() }),
  hydrate: (_scopeId, value) => hydrate(value),
})

// A scope id qualified by the node that owns the resource it names (docs/state.md § Scope rules).
// The `app` scope is the exception: it describes this window, not a node's data, so qualifying it
// would reset things like the left rail's collapse state on every node switch.
//
// This pair of functions is the only place a node id enters or leaves a storage key, which keeps
// each slice's own binding speaking in bare resource ids.
//
// Both the node id and the scope id are percent-encoded, so the `/` between them is the only
// unescaped slash in the key. A node id arrives from `GET /v2/node` unchecked, so writing it raw
// would let a node reporting `a/b` produce a key this parser could never split correctly, and an
// empty node id would produce an unqualified key that let one node read another node's layouts.
// Encoding the scope id too keeps the split unambiguous, since a pane scope id can itself contain
// a slash.
export const storageKeyFor = (slice: Pick<PersistedStateSlice<unknown>, 'key' | 'scope'>, scopeId: string): string => {
  if (slice.scope === 'app') return slice.key
  const nodeId = activeNodeId()
  // Both halves encoded (see the note above). `encodeURIComponent` cannot emit a `/`, so the
  // separator stays the only unescaped slash in the key either way.
  return `${slice.key}:${nodeId ? `${encodeURIComponent(nodeId)}/` : ''}${encodeURIComponent(scopeId)}`
}

// Which node a storage key is qualified for, without knowing which slice wrote it: `null` for an
// unqualified key (an `app` slice, or a pre-qualification leftover). The raw `/` is the qualifier's
// tell, per the note above; slice keys never contain one, so the id is the segment between the
// last `:` before that slash and the slash itself. Used by the device-storage drain, which has a
// bag of keys and no slice to match them against, and must not hand one node's layouts to another.
export const nodeIdFromStorageKey = (key: string): string | null => {
  const slash = key.indexOf('/')
  if (slash === -1) return null
  const colon = key.lastIndexOf(':', slash)
  if (colon === -1) return null
  try {
    return decodeURIComponent(key.slice(colon + 1, slash))
  } catch {
    return null
  }
}

export const scopeIdFromStorageKey = (slice: Pick<PersistedStateSlice<unknown>, 'key' | 'scope'>, key: string): string | null => {
  if (slice.scope === 'app') return key === slice.key ? '' : null
  const prefix = `${slice.key}:`
  if (!key.startsWith(prefix)) return null
  const suffix = key.slice(prefix.length)
  const slash = suffix.indexOf('/')
  if (slash !== -1 && decodeURIComponent(suffix.slice(0, slash)) !== activeNodeId()) return null
  try {
    return decodeURIComponent(slash === -1 ? suffix : suffix.slice(slash + 1))
  } catch {
    return null
  }
}

export function stringifyPersistedValue<T>(slice: PersistedStateSlice<T>, value: T): string {
  const encoded = slice.codec.serialize(value)
  return typeof encoded === 'string' ? encoded : JSON.stringify(encoded)
}

export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength
