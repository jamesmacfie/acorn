import type { AgentSessionHeaderProps } from '@acorn/protocol/extensionPoints.ts'
import { Chip } from '@acorn/plugin-api/ui'
import { Show } from 'solid-js'
import { estimateSessionCost } from './sessionCost'
import { sessionCostLabel } from './sessionCostLabel'

export default function SessionCostBadge(props: AgentSessionHeaderProps) {
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
