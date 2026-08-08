import { createUniqueId } from 'solid-js'
import { Button, Icon } from '@acorn/plugin-api/ui'
import AgentUsageSection from './AgentUsageSection'
import { usageTooltipSummary } from './usageModel'
import { agentUsageStore } from './usageStore'
import './agent-usage.css'

export default function AgentUsageIndicator() {
  const tooltipId = `agent-usage-${createUniqueId()}`

  return (
    <div class="managed-agent-usage">
      <Button
        class="managed-agent-usage-trigger"
        aria-label="Agent utilization"
        aria-describedby={tooltipId}
      >
        <Icon name="gauge" />
        <span>{usageTooltipSummary(agentUsageStore.snapshot())}</span>
      </Button>
      <div id={tooltipId} class="managed-agent-usage-tooltip" role="tooltip">
        <AgentUsageSection showHeader={false} />
      </div>
    </div>
  )
}
