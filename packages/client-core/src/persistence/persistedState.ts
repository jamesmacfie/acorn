import { activeNodeId } from '../node/activeNode'
import { Registry } from '../registries/registry'

// ui.md § State ownership: "All keys that touch node resources include the nodeId." Every non-`app` scope
// here IS a node resource — a workspace, a task, a pane within a task — and the ids are UUIDs a node mints,
// so architecture.md § Fleet semantics applies directly: "Two nodes may coincidentally hold the same UUID;
// that must never collide in the client." Before Phase 4 a remote task's pane layout and open editor files
// were stored under a bare task id, which is precisely that collision.
//
// `app` is deliberately NOT qualified: `core.last-path` and `core.left-collapsed` describe the WINDOW, and
// node-qualifying them would reset the rail's collapse state on every node switch. The qualification happens
// in `storageKeyFor` / `scopeIdFromStorageKey` below — one matched pair, so no slice has to remember.
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
// already-decoded value can arrive as the object itself. Undefined on malformed input — codecs are
// required to tolerate it (persistedState.conformance.test.ts).
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

// A scope id qualified by the node that owns the resource it names.
//
// ui.md § State ownership: "All keys that touch node resources include the nodeId." Every non-app scope here
// is a node resource — a workspace, a task, a pane within a task — and the ids are UUIDs a node mints, so
// architecture.md § Fleet semantics applies directly: "Two nodes may coincidentally hold the same UUID; that
// must never collide in the client." Before this, a remote task's pane layout and open editor files were
// stored under a bare task id, which is exactly that collision.
//
// The `app` scope is deliberately NOT qualified. `core.last-path`, `core.left-collapsed` and the rest describe
// the window, not a node's data, and node-qualifying them would mean the left rail's collapse state resetting
// on every node switch.
// The two functions are a matched pair and this is the ONLY place a nodeId enters or leaves a storage key.
// Qualifying here rather than in each slice's binding is what keeps this to one edit: every binding still
// speaks in bare resource ids, which is what its store is keyed by.
// The node id is written RAW and the scope id ENCODED, so the `/` between them is the only unescaped slash
// in the key. Encoding the pair as one string instead would be ambiguous: a scope id may legitimately contain
// a slash (a pane scope is a composite), and after a single `encodeURIComponent` there is no way to tell
// `<node>/<scope>` from a scope id that simply had a slash in it. This spelling makes "contains a raw slash"
// mean exactly "carries a node qualifier", which is also what lets a pre-Phase-4 key be recognised.
export const storageKeyFor = (slice: Pick<PersistedStateSlice<unknown>, 'key' | 'scope'>, scopeId: string): string => {
  if (slice.scope === 'app') return slice.key
  const nodeId = activeNodeId()
  return `${slice.key}:${nodeId ? `${nodeId}/` : ''}${encodeURIComponent(scopeId)}`
}

// The inverse, and it FILTERS as well as parses: a key qualified with another node's id returns null, so
// node B's saved layouts cannot hydrate into node A's store. An UNQUALIFIED key is accepted whatever the
// active node — that is every key written before Phase 4, and rejecting them would silently reset every
// existing install's pane layouts on upgrade.
export const scopeIdFromStorageKey = (slice: Pick<PersistedStateSlice<unknown>, 'key' | 'scope'>, key: string): string | null => {
  if (slice.scope === 'app') return key === slice.key ? '' : null
  const prefix = `${slice.key}:`
  if (!key.startsWith(prefix)) return null
  const suffix = key.slice(prefix.length)
  const slash = suffix.indexOf('/')
  // No raw slash → written before Phase 4, or written with no node selected (`dev:node`, where the origin IS
  // the node). Accepted whatever the active node: rejecting these would silently reset every existing
  // install's pane layouts and open editor files on upgrade.
  if (slash !== -1 && suffix.slice(0, slash) !== activeNodeId()) return null
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
