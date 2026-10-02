import { Badge } from 'acorn-plugin-sdk/remote'
import { Show } from 'solid-js'
import { estimateSessionCost } from './sessionCost'
import { sessionCostLabel } from './sessionCostLabel'
import type { SessionHeaderProps } from './sessionHeaderContract'

// A readout, so a `Badge` and not a `Chip`, which is the kit's interactive node. Its explanation is
// the badge's styled tip.
export function SessionCostBadge(props: SessionHeaderProps) {
  const cost = () => estimateSessionCost(props)
  return (
    <Show when={cost()}>
      {(value) => {
        const estimated = value().source === 'estimated'
        const tip = estimated
          ? 'Estimated from the tokens used and the prices in Limits and cost. Your bill may differ.'
          : 'Session cost reported by the provider.'
        return (
          <Badge size="xs" tip={tip}>
            {sessionCostLabel(value().amountUsd, estimated)}
          </Badge>
        )
      }}
    </Show>
  )
}
