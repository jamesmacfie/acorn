import { Chip } from 'acorn-plugin-sdk/remote'
import { Show } from 'solid-js'
import { estimateSessionCost } from './sessionCost'
import { sessionCostLabel } from './sessionCostLabel'
import type { SessionHeaderProps } from './sessionHeaderContract'

export function SessionCostBadge(props: SessionHeaderProps) {
  const cost = () => estimateSessionCost(props)
  return (
    <Show when={cost()}>
      {(value) => {
        const estimated = value().source === 'estimated'
        const title = estimated
          ? 'Estimated API-equivalent session cost from reported tokens and configured model prices. Provider billing may differ.'
          : 'Session cost reported by the provider.'
        return (
          <Chip size="xs" title={title}>
            {sessionCostLabel(value().amountUsd, estimated)}
          </Chip>
        )
      }}
    </Show>
  )
}
