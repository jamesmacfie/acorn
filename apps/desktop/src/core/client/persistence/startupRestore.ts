import { createEffect, createSignal, onCleanup, untrack } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import { clientEvents } from '../registries/clientEvents'
import { pushBackgroundError } from '../notifications/notifications'
import { savePref } from '../settings/savePref'
import {
  scopeIdFromStorageKey,
  storageKeyFor,
  stringifyPersistedValue,
  utf8Bytes,
  type PersistedStateSlice,
  type RestorePhase,
} from './persistedState'

const PHASES: readonly RestorePhase[] = ['workspace', 'view', 'panes']
const WRITE_THROTTLE_MS = 500
export const PERSISTED_STATE_TOMBSTONE = '{"__acorn_deleted":true}'

const parseStored = <T>(slice: PersistedStateSlice<T>, scopeId: string, raw: unknown): T => {
  try {
    return slice.codec.parse(raw)
  } catch (error) {
    console.warn(`[persisted-state:${slice.id}] invalid value`, error)
    return slice.empty(scopeId)
  }
}

export function restorePersistedSlices(
  slices: readonly PersistedStateSlice<unknown>[],
  prefs: Readonly<Record<string, string>>,
): void {
  for (const phase of PHASES) {
    for (const slice of slices.filter((candidate) => candidate.restore === phase && candidate.binding)) {
      const canonical: [string, unknown][] = []
      for (const [key, raw] of Object.entries(prefs)) {
        const scopeId = scopeIdFromStorageKey(slice, key)
        if (scopeId !== null) canonical.push([scopeId, raw])
      }
      // Merge rather than switch wholesale: a process killed midway through the first scoped
      // migration may have written only some canonical entries. Legacy fills the untouched scopes;
      // canonical values override only the scopes that completed.
      const values = new Map<string, unknown>(Object.entries(slice.legacy?.(prefs) ?? {}))
      for (const [scopeId, raw] of canonical) {
        if (raw === PERSISTED_STATE_TOMBSTONE) values.delete(scopeId)
        else values.set(scopeId, raw)
      }
      for (const [scopeId, raw] of values) {
        try {
          slice.binding!.hydrate(scopeId, parseStored(slice, scopeId, raw))
        } catch (error) {
          console.warn(`[persisted-state:${slice.id}] hydrate failed`, error)
        }
      }
    }
  }
}

export type StartupRestoreOptions = {
  queryClient: QueryClient
  prefs: () => Readonly<Record<string, string>> | undefined
  ready: () => boolean
  slices: () => readonly PersistedStateSlice<unknown>[]
}

// Solid owns the reactive subscriptions, while this service owns their ordering and arming. No
// descriptor can write until every phase has hydrated and boot:restored has been emitted.
export function createStartupRestore(options: StartupRestoreOptions): { restored: () => boolean } {
  const [restored, setRestored] = createSignal(false)
  const [armed, setArmed] = createSignal(false)
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const queued = new Map<string, { slice: PersistedStateSlice<unknown>; raw: string }>()
  const lastStored = new Map<string, string>()
  const hydratedSlices = new Set<PersistedStateSlice<unknown>>()
  const previousScopes = new Map<PersistedStateSlice<unknown>, Set<string>>()
  let activeSlices = new Set<PersistedStateSlice<unknown>>()

  const write = (slice: PersistedStateSlice<unknown>, scopeId: string, raw: string) => {
    const key = storageKeyFor(slice, scopeId)
    if (lastStored.get(key) === raw) return
    if (slice.maxBytes != null && utf8Bytes(raw) > slice.maxBytes) {
      if (slice.id === 'core.notices') console.error(`[persisted-state:${slice.id}] value exceeds ${slice.maxBytes} bytes`)
      else pushBackgroundError('', `Could not save ${slice.id}`, `Persisted value exceeds ${slice.maxBytes} bytes.`)
      return
    }
    queued.set(key, { slice, raw })
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      const pending = queued.get(key)
      queued.delete(key)
      if (!pending) return
      void savePref(options.queryClient, key, pending.raw, { surfaceFailure: pending.slice.id !== 'core.notices' }).then((saved) => {
        if (saved) lastStored.set(key, pending.raw)
      })
    }, WRITE_THROTTLE_MS))
  }

  createEffect(() => {
    const prefs = options.prefs()
    if (restored() || !prefs || !options.ready()) return
    performance.mark('acorn:restore:start')
    for (const [key, value] of Object.entries(prefs)) lastStored.set(key, value)
    const slices = untrack(options.slices)
    restorePersistedSlices(slices, prefs)
    for (const slice of slices) if (slice.binding) hydratedSlices.add(slice)
    performance.mark('acorn:restore:end')
    performance.measure('acorn:restore', 'acorn:restore:start', 'acorn:restore:end')
    setRestored(true)
    clientEvents.emit('boot:restored', { phases: [...PHASES] })
    setArmed(true)
  })

  createEffect(() => {
    // Registry membership is reactive. A late plugin must hydrate before its first persistence pass,
    // and disabling one must leave its stored value intact for a future reactivation.
    const slices = options.slices().filter((slice) => slice.binding)
    if (!armed()) return
    const currentSlices = new Set(slices)
    for (const removed of activeSlices) {
      if (currentSlices.has(removed)) continue
      hydratedSlices.delete(removed)
      previousScopes.delete(removed)
    }
    activeSlices = currentSlices

    const prefs = untrack(options.prefs) ?? {}
    const lateSlices = slices.filter((slice) => !hydratedSlices.has(slice))
    if (lateSlices.length) {
      restorePersistedSlices(lateSlices, prefs)
      for (const slice of lateSlices) hydratedSlices.add(slice)
    }

    for (const slice of slices) {
      const values = slice.binding!.values()
      const currentScopes = new Set(Object.keys(values))
      for (const [scopeId, value] of Object.entries(values)) {
        let raw: string
        try {
          raw = stringifyPersistedValue(slice, value)
        } catch (error) {
          pushBackgroundError('', `Could not save ${slice.id}`, error instanceof Error ? error.message : String(error))
          continue
        }
        write(slice, scopeId, raw)
      }
      for (const removedScope of previousScopes.get(slice) ?? []) {
        if (currentScopes.has(removedScope)) continue
        write(slice, removedScope, PERSISTED_STATE_TOMBSTONE)
      }
      previousScopes.set(slice, currentScopes)
    }
  })

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    for (const [key, pending] of queued) {
      void savePref(options.queryClient, key, pending.raw, { surfaceFailure: pending.slice.id !== 'core.notices' })
    }
    queued.clear()
  })
  return { restored }
}
