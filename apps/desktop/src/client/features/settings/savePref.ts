import type { QueryClient } from '@tanstack/solid-query'
import { prefsKey } from '../../../shared/api'
import { setPref } from '../../mutations'
import { pushBackgroundError } from '../notifications/notifications'
import { persistedStateRegistry, utf8Bytes } from '../../persistence/persistedState'

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
