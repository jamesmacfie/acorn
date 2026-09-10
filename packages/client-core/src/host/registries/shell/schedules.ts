import { hasHostCapability, type HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { Registry } from '../../../kit/lib/registry'
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
  const disposers = clientScheduleRegistry.entries().filter((entry) => hasHostCapability(entry.requires)).map((entry) => {
    const refresh = () => {
      if (!document.hidden) void Promise.resolve(entry.run()).catch((error) => log.error(entry.id, error, { 'schedule.id': entry.id }))
    }
    refresh()
    const timer = window.setInterval(refresh, entry.intervalMs)
    const off = entry.subscribe?.(refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      off?.()
      clearInterval(timer)
    }
  })
  return () => [...disposers].reverse().forEach((dispose) => dispose())
}
