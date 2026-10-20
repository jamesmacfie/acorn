// `ctx.dataSources.changed`: a plugin says a source's records changed, and core publishes
// `data-source:changed` for it and for each derived source that reads it (docs/data-sources/changes.md).
// The event only asks listeners to read again, so nothing here is durable.
import type { DataSourceChangedEvent } from '@acorn/protocol/nodeEvents.ts'
import { wsBroadcast } from '../transport/wsHub'
import { createLogger } from '../telemetry/logger'
import { registeredDataSource, registeredDataSources } from './registry'

const log = createLogger('data-sources')

// A mirror write can call this once per row, so every source publishes at most once a second.
const COALESCE_MS = 1_000
// Derived sources nest two levels at most (./inputs.ts), so a change reaches no further.
const DERIVED_LEVELS = 2

const pending = new Map<string, DataSourceChangedEvent>()
const refused = new Set<string>()

/** Never throws: a source the caller doesn't own is logged once and dropped, so a plugin can call
 *  this from any write without guarding it. */
export function dataSourceChanged(pluginId: string, sourceId: string, hint: { connectionId?: string } = {}): void {
  const key = `${pluginId}:${sourceId}`
  if (!registeredDataSource({ pluginId, sourceId })) {
    if (!refused.has(key)) log.warn(`'${pluginId}' said '${sourceId}' changed, but it has no data source by that name`)
    refused.add(key)
    return
  }
  queue(key, { pluginId, sourceId, ...(hint.connectionId ? { connectionId: hint.connectionId } : {}) })
  for (const reader of derivedReaders(key)) queue(`${reader.pluginId}:${reader.sourceId}`, reader)
}

function queue(key: string, change: DataSourceChangedEvent): void {
  const queued = pending.get(key)
  if (queued) {
    // Calls that name different accounts, or none, widen the event to every account.
    if (queued.connectionId !== change.connectionId) delete queued.connectionId
    return
  }
  pending.set(key, change)
  const timer = setTimeout(() => {
    const event = pending.get(key)
    pending.delete(key)
    if (event) wsBroadcast({ channel: 'data-source:changed', ...event })
  }, COALESCE_MS)
  // A pending publish must never keep the Node alive.
  timer.unref?.()
}

/** The derived sources that read `key` as an input, then the ones that read those, one level at a
 *  time. A derived source has no account of its own, so its event carries no `connectionId`. */
function derivedReaders(key: string): DataSourceChangedEvent[] {
  const reached = new Set([key])
  const readers: DataSourceChangedEvent[] = []
  let changed = [key]
  for (let level = 0; level < DERIVED_LEVELS && changed.length > 0; level++) {
    const next: string[] = []
    for (const source of registeredDataSources()) {
      const id = `${source.pluginId}:${source.sourceId}`
      if (reached.has(id)) continue
      if (!Object.values(source.inputs ?? {}).some((input) => changed.includes(input.source))) continue
      reached.add(id)
      next.push(id)
      readers.push({ pluginId: source.pluginId, sourceId: source.sourceId })
    }
    changed = next
  }
  return readers
}
