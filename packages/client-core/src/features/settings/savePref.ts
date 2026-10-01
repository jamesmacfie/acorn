import type { QueryClient } from '@tanstack/solid-query'
import { prefsKey, prefsRoute } from '@acorn/protocol/api.ts'
import { writeJson } from '../../infra/node/apiClient'
import { activeNodeId } from '../../infra/node/activeNode'
import { queryOwner } from '../../infra/node/queryOwnership'
import { deviceConfigBridge } from '../../infra/platform'
import { configPatchForPref } from '../../infra/persistence/deviceConfigPrefs'
import { pushBackgroundError } from '../notifications/notifications'
import { isDevicePref, writeDevicePref } from '../../infra/persistence/devicePrefs'
import { persistedStateRegistry, utf8Bytes } from '../../infra/persistence/persistedState'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('prefs')

// The active node, which is apiClient's default target, not a home node. What survives in this store
// after the device migration all describes one node's resources: a task's pane layout, its open files,
// a repo's PR filters, what the agent running there may do. State follows the resource it describes
// (docs/state.md § Scope rules), so there's no home node to pick.
export const setPref = async (key: string, value: string, nodeId: string | null = activeNodeId()) =>
  writeJson<{ key: string; value: string }>(prefsRoute, {
    method: 'PUT',
    nodeId,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  }, (res) => `prefs ${res.status}`)

type PrefWriteState = {
  tail: Promise<void>
  confirmed: string | undefined
  hadConfirmedValue: boolean
  latestAttempt: number
}
const writes = new WeakMap<QueryClient, Map<string, PrefWriteState>>()

// The query cache is the one client-side writer: update it optimistically so every reactive reader
// moves together, serialize server writes per key, and roll back only if this attempt is still the
// visible value. A failure becomes a notice, because most callers fire and forget. A settings row
// passes `throwOnFailure` instead: it shows the error beside the field that failed, and a notice as well
// would say the same thing twice.
//
// A row usually writes through an accessor, such as `saveFixedTheme` or `saveNotificationSettings`,
// that the palette's commands share and that takes no options. `withFailuresThrown` reaches through
// them: a write started inside it throws. It holds only while the accessor runs up to its first await,
// which is where every accessor calls this function, and it is read here before anything is awaited.
let throwingCallers = 0
export function withFailuresThrown<T>(write: () => T): T {
  throwingCallers += 1
  try {
    return write()
  } finally {
    throwingCallers -= 1
  }
}

/** Whether the write starting now should throw its failure to the caller. For a writer that catches on
 *  its own, read before its first await. */
export const failuresThrown = (): boolean => throwingCallers > 0

export type SavePrefOptions = { surfaceFailure?: boolean; skipConfigWrite?: boolean; throwOnFailure?: boolean }

export async function savePref(
  qc: QueryClient,
  key: string,
  value: string,
  requested: SavePrefOptions = {},
): Promise<boolean> {
  const options = { ...requested, throwOnFailure: requested.throwOnFailure ?? throwingCallers > 0 }
  const descriptor = persistedStateRegistry.entries().find((slice) =>
    key === slice.key || (slice.scope !== 'app' && key.startsWith(`${slice.key}:`)),
  )
  if (descriptor?.maxBytes != null && utf8Bytes(value) > descriptor.maxBytes) {
    if (options.throwOnFailure) throw new Error(`The value is larger than ${descriptor.maxBytes} bytes.`)
    if (options.surfaceFailure === false) log.error(`${key}: value exceeds ${descriptor.maxBytes} bytes`, undefined, { 'pref.key': key })
    else pushBackgroundError('', `Could not save ${descriptor.id}`, `Persisted value exceeds ${descriptor.maxBytes} bytes.`)
    return false
  }
  // A device pref never reaches a node (persistence/devicePrefs.ts): it's a property of this
  // installation, and `localStorage.setItem` can't fail in a way a retry would fix.
  //
  // localStorage first, cache second. `prefsOptions.select` is `mergePrefs(raw, readDevicePrefs())` and
  // device wins, so a cache write landing first recomputes `select` against the old device value and
  // throws the new one away. Silently, because structural sharing then sees an unchanged result and
  // notifies nobody. That's why picking a theme used to do nothing until an unrelated pref write
  // happened to re-run `select`.
  if (isDevicePref(key)) {
    writeDevicePref(key, value)
    qc.setQueryData<Record<string, string>>(prefsKey, (old) => ({ ...old, [key]: value }))
    const patch = options.skipConfigWrite ? null : configPatchForPref(key, value)
    if (patch) {
      try { await deviceConfigBridge()?.write(patch) }
      catch (error) {
        if (options.throwOnFailure) throw error
        if (options.surfaceFailure === false) log.error(`could not write acorn.json for ${key}`, error, { 'pref.key': key })
        else pushBackgroundError('', 'Could not write acorn.json', error instanceof Error ? error.message : String(error))
        return false
      }
    }
    return true
  }

  const registered = queryOwner(qc)
  const nodeId = registered === undefined ? activeNodeId() : registered
  const partitionWrites = writes.get(qc) ?? new Map<string, PrefWriteState>()
  writes.set(qc, partitionWrites)
  const previous = qc.getQueryData<Record<string, string>>(prefsKey)
  qc.setQueryData<Record<string, string>>(prefsKey, (old) => ({ ...old, [key]: value }))

  const state = partitionWrites.get(key) ?? {
    tail: Promise.resolve(),
    confirmed: previous?.[key],
    hadConfirmedValue: !!previous && key in previous,
    latestAttempt: 0,
  }
  const attempt = ++state.latestAttempt
  const request = state.tail.catch(() => {}).then(async () => {
    await setPref(key, value, nodeId)
    state.confirmed = value
    state.hadConfirmedValue = true
  })
  state.tail = request
  partitionWrites.set(key, state)
  try {
    await request
    return true
  } catch (error) {
    // Equal values aren't equal attempts: dark -> light -> dark can have three requests in flight. Only
    // the latest attempt owns the optimistic cache value and may roll it back.
    if (state.latestAttempt === attempt) {
      const current = qc.getQueryData<Record<string, string>>(prefsKey)
      qc.setQueryData<Record<string, string>>(prefsKey, () => {
        const next = { ...current }
        if (state.hadConfirmedValue) next[key] = state.confirmed as string
        else delete next[key]
        return next
      })
    }
    if (options.throwOnFailure) throw error
    if (options.surfaceFailure === false) log.error(key, error, { 'pref.key': key })
    else pushBackgroundError('', `Could not save ${key}`, error instanceof Error ? error.message : String(error))
    return false
  } finally {
    if (partitionWrites.get(key)?.tail === request) partitionWrites.delete(key)
  }
}

export const saveJsonPref = <T>(
  queryClient: QueryClient,
  key: string,
  value: T,
  options?: SavePrefOptions,
): Promise<boolean> => savePref(queryClient, key, JSON.stringify(value), options)
