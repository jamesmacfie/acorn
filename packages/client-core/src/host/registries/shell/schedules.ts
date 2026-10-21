import { createEffect, createMemo, createRoot, onCleanup, untrack } from 'solid-js'
import { activeNodeId } from '../../../infra/node/activeNode'
import { hasHostCapability, type HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { hostFocused, hostHidden, onHostVisibilityChange } from '../../../infra/platform'
import { Registry } from '../../../kit/lib/state/registry'
import { createLogger } from '../../../infra/telemetry/logger'

const log = createLogger('schedule')

// Periodic work in the renderer. The same word as the node's `ctx.schedules` for the same idea, and
// deliberately not the same shape: a node cadence is budgeted and floored at 300s because it runs with
// nobody watching, and below that floor a schedule is a poll, which is the client's job for a person
// who is present (docs/schedules.md § Cadence). So `intervalMs`, raw, and no floor.
//
// Both hosts run these. Whether anybody is looking comes from the platform seam rather than from
// `document`, which the terminal client does not have.
export type ClientScheduleContribution = {
  id: string
  intervalMs: number
  /** A slower clock while the window has no focus, for an entry whose events keep it current and whose
   *  clock is only a backstop. Events still refresh it at once. */
  unfocusedIntervalMs?: number
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
      return next.length === previous.length && next.every((entry, index) => entry === previous[index])
        ? previous
        : next
    })
    const owners = new Map<ClientScheduleContribution, () => void>()
    let previousNode = activeNodeId()
    onCleanup(() => {
      ;[...owners.values()].reverse().forEach((stop) => stop())
      owners.clear()
    })
    createEffect(() => {
      const nodeId = activeNodeId()
      const entries = active()
      for (const [entry, stop] of owners) {
        if (nodeId !== previousNode || !entries.includes(entry)) {
          stop()
          owners.delete(entry)
        }
      }
      previousNode = nodeId
      for (const entry of entries) {
        if (owners.has(entry)) continue
        let stopped = false
        let running = false
        let dirty = false
        const refresh = () => {
          if (stopped || activeNodeId() !== nodeId || hostHidden() || !hasHostCapability(entry.requires)) return
          if (running) {
            dirty = true
            return
          }
          running = true
          void (async () => {
            try {
              do {
                dirty = false
                try {
                  await entry.run()
                } catch (error) {
                  log.error(entry.id, error, { 'schedule.id': entry.id })
                }
              } while (
                dirty &&
                !stopped &&
                activeNodeId() === nodeId &&
                !hostHidden() &&
                hasHostCapability(entry.requires)
              )
            } finally {
              running = false
            }
          })()
        }
        // Unfocused, a tick runs only once enough of them have passed to make the slower interval.
        let skippedTicks = 0
        const tick = () => {
          if (
            entry.unfocusedIntervalMs &&
            !hostFocused() &&
            ++skippedTicks * entry.intervalMs < entry.unfocusedIntervalMs
          )
            return
          skippedTicks = 0
          refresh()
        }
        const timer = setInterval(tick, entry.intervalMs)
        const off = entry.subscribe?.(refresh)
        untrack(refresh)
        const offVisibility = onHostVisibilityChange(refresh)
        owners.set(entry, () => {
          if (stopped) return
          stopped = true
          dirty = false
          offVisibility()
          off?.()
          clearInterval(timer)
        })
      }
    })
    return dispose
  })
}
