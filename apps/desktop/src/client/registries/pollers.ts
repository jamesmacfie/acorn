import { hasClientCapability, type ClientCapabilityRequirement } from '../features/capabilities'
import { Registry } from './registry'

export type PollerContribution = {
  id: string
  intervalMs: number
  requires?: ClientCapabilityRequirement
  run: () => void | Promise<void>
  subscribe?: (refresh: () => void) => () => void
}

export const pollerRegistry = new Registry<PollerContribution>('poller')

export function startClientPollers(): () => void {
  const disposers = pollerRegistry.entries().filter((poller) => hasClientCapability(poller.requires)).map((poller) => {
    const refresh = () => {
      if (!document.hidden) void Promise.resolve(poller.run()).catch((error) => console.error(`[poller:${poller.id}]`, error))
    }
    refresh()
    const timer = window.setInterval(refresh, poller.intervalMs)
    const off = poller.subscribe?.(refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      off?.()
      clearInterval(timer)
    }
  })
  return () => [...disposers].reverse().forEach((dispose) => dispose())
}
