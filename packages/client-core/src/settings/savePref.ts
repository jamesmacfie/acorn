import type { QueryClient } from '@tanstack/solid-query'
import { prefsKey, prefsRoute } from '@acorn/protocol/api.ts'
import { writeJson } from '../apiClient'
import { homeNodeTarget } from '../node/fleet'
import { pushBackgroundError } from '../notifications/notifications'
import { isDevicePref, writeDevicePref } from '../persistence/devicePrefs'
import { persistedStateRegistry, utf8Bytes } from '../persistence/persistedState'

// The server write behind a NODE pref. Lives here because savePref is its only caller — the
// optimistic-cache + rollback dance below is the whole contract.
//
// Addressed at the home node, matching prefsOptions. What is left on a node after Phase 4's device tier is
// per-node behaviour (agent tool permissions, startup context injection), and pinning it to the home node is
// the same compromise as before — a single flat record cannot say "per node", so one node has to win. Stated
// in full at prefsOptions.
const setPref = async (key: string, value: string) =>
  writeJson<{ key: string; value: string }>(prefsRoute, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
    ...homeNodeTarget(),
  }, (res) => `prefs ${res.status}`)

type PrefWriteState = {
  tail: Promise<void>
  confirmed: string | undefined
  hadConfirmedValue: boolean
  latestAttempt: number
}
const writes = new Map<string, PrefWriteState>()

// The query cache is the one client-side writer: update it optimistically so every reactive reader
// moves together, serialize server writes per key, and roll back only if this attempt is still the
// visible value. A failure always becomes a notice because most callers intentionally fire-and-forget.
export async function savePref(
  qc: QueryClient,
  key: string,
  value: string,
  options: { surfaceFailure?: boolean } = {},
): Promise<boolean> {
  const descriptor = persistedStateRegistry.entries().find((slice) =>
    key === slice.key || (slice.scope !== 'app' && key.startsWith(`${slice.key}:`)),
  )
  if (descriptor?.maxBytes != null && utf8Bytes(value) > descriptor.maxBytes) {
    if (options.surfaceFailure === false) console.error(`[prefs:${key}] value exceeds ${descriptor.maxBytes} bytes`)
    else pushBackgroundError('', `Could not save ${descriptor.id}`, `Persisted value exceeds ${descriptor.maxBytes} bytes.`)
    return false
  }
  const previous = qc.getQueryData<Record<string, string>>(prefsKey)
  qc.setQueryData<Record<string, string>>(prefsKey, (old) => ({ ...(old ?? {}), [key]: value }))

  // A DEVICE pref never reaches a node (persistence/devicePrefs.ts): it is a property of this
  // installation, `localStorage.setItem` cannot fail in a way a retry would fix, and the whole
  // optimistic-write-and-roll-back dance below exists for a network round trip that no longer happens.
  // The cache write above is what every reactive reader sees, so it stays and this returns straight away.
  if (isDevicePref(key)) {
    writeDevicePref(key, value)
    return true
  }

  const state = writes.get(key) ?? {
    tail: Promise.resolve(),
    confirmed: previous?.[key],
    hadConfirmedValue: !!previous && key in previous,
    latestAttempt: 0,
  }
  const attempt = ++state.latestAttempt
  const request = state.tail.catch(() => {}).then(async () => {
    await setPref(key, value)
    state.confirmed = value
    state.hadConfirmedValue = true
  })
  state.tail = request
  writes.set(key, state)
  try {
    await request
    return true
  } catch (error) {
    // Equal values are not equal attempts: dark -> light -> dark can have three requests in flight.
    // Only the latest attempt owns the optimistic cache value and is allowed to roll it back.
    if (state.latestAttempt === attempt) {
      const current = qc.getQueryData<Record<string, string>>(prefsKey)
      qc.setQueryData<Record<string, string>>(prefsKey, () => {
        const next = { ...(current ?? {}) }
        if (state.hadConfirmedValue) next[key] = state.confirmed as string
        else delete next[key]
        return next
      })
    }
    if (options.surfaceFailure === false) console.error(`[prefs:${key}]`, error)
    else pushBackgroundError('', `Could not save ${key}`, error instanceof Error ? error.message : String(error))
    return false
  } finally {
    if (writes.get(key)?.tail === request) writes.delete(key)
  }
}

export const saveJsonPref = <T>(
  queryClient: QueryClient,
  key: string,
  value: T,
  options?: { surfaceFailure?: boolean },
): Promise<boolean> => savePref(queryClient, key, JSON.stringify(value), options)
