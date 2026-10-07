import { Badge } from 'acorn-plugin-sdk/remote'
import { Show } from 'solid-js'
import { estimateSessionCost, sessionCacheUsage } from './sessionCost'
import { sessionCacheLabel, sessionCostLabel } from './sessionCostLabel'
import type { SessionHeaderProps } from './sessionHeaderContract'

// A readout, so a `Badge` and not a `Chip`, which is the kit's interactive node. Its explanation is
// the badge's styled tip.
export function SessionCostBadge(props: SessionHeaderProps) {
  const cost = () => estimateSessionCost(props)
  return (
    <Show when={cost()}>
      {(value) => {
        // Accessors, because this callback runs once while each new turn changes the numbers.
        const estimated = () => value().source === 'estimated'
        const tip = () => {
          const source = estimated()
            ? 'Estimated from the tokens used and the prices in Limits and cost. Your bill may differ.'
            : 'Session cost reported by the provider.'
          const cache = sessionCacheUsage(props)
          return cache ? `${source} ${sessionCacheLabel(cache)}` : source
        }
        return (
          <Badge size="xs" tip={tip()}>
            {sessionCostLabel(value().amountUsd, estimated())}
          </Badge>
        )
      }}
    </Show>
  )
}
