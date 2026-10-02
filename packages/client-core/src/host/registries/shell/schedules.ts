import { createEffect, createMemo, createRoot, onCleanup, untrack } from 'solid-js'
import { activeNodeId } from '../../../infra/node/activeNode'
import { hasHostCapability, type HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { Registry } from '../../../kit/lib/state/registry'
import { createLogger } from '../../../infra/telemetry/logger'

const log = createLogger('schedule')

// Periodic work in the renderer. The same word as the node's `ctx.schedules` for the same idea, and
// deliberately not the same shape: a node cadence is budgeted and floored at 300s because it runs with
// nobody watching, and below that floor a schedule is a poll, which is the client's job for a person
// who is present (docs/schedules.md § Cadence). So `intervalMs`, raw, and no floor.
export type ClientScheduleContribution = {
  id: string
  intervalMs: number
  requires?: HostCapabilityRequirement
  run: () => void | Promise<void>
  subscribe?: (refresh: () => void) => () => void
}

export const clientScheduleRegistry = new Registry<ClientScheduleContribution>('client-schedule')

export function startClientSchedules(): () => void {
  return createRoot((dispose) => {
    // Plugin availability can arrive after the Node is ready, and plugins can be re-registered while
    // the window stays open. Keep the active set in sync instead of filtering it once at startup.
    const active = createMemo((previous: readonly ClientScheduleContribution[] = []) => {
      const next = clientScheduleRegistry.entries().filter((entry) => hasHostCapability(entry.requires))
      return next.length === previous.length && next.every((entry, index) => entry === previous[index]) ? previous : next
    })
    const owners = new Map<ClientScheduleContribution, () => void>()
    let previousNode = activeNodeId()
    onCleanup(() => { [...owners.values()].reverse().forEach(stop => stop()); owners.clear() })
    createEffect(() => {
      const nodeId = activeNodeId()
      const entries = active()
      for (const [entry, stop] of owners) {
        if (nodeId !== previousNode || !entries.includes(entry)) { stop(); owners.delete(entry) }
      }
      previousNode = nodeId
      for (const entry of entries) {
        if (owners.has(entry)) continue
        let stopped = false
        let running = false
        let dirty = false
        const refresh = () => {
          if (stopped || activeNodeId() !== nodeId || document.hidden || !hasHostCapability(entry.requires)) return
          if (running) { dirty = true; return }
          running = true
          void (async () => {
            try {
              do {
                dirty = false
                try { await entry.run() }
                catch (error) { log.error(entry.id, error, { 'schedule.id': entry.id }) }
              } while (dirty && !stopped && activeNodeId() === nodeId && !document.hidden && hasHostCapability(entry.requires))
            } finally { running = false }
          })()
        }
        const timer = window.setInterval(refresh, entry.intervalMs)
        const off = entry.subscribe?.(refresh)
        untrack(refresh)
        document.addEventListener('visibilitychange', refresh)
        owners.set(entry, () => {
          if (stopped) return
          stopped = true
          dirty = false
          document.removeEventListener('visibilitychange', refresh)
          off?.()
          clearInterval(timer)
        })
      }
    })
    return dispose
  })
}
