import { createUniqueId } from 'solid-js'
import Icon from '../../../core/client/ui/Icon'
import AgentUsageSection from './AgentUsageSection'
import { usageTooltipSummary } from './usageModel'
import { agentUsageStore } from './usageStore'
import './agent-usage.css'

export default function AgentUsageIndicator() {
  const tooltipId = `agent-usage-${createUniqueId()}`

  return (
    <div class="managed-agent-usage">
      <button
        type="button"
        class="ui-btn managed-agent-usage-trigger"
        aria-label="Agent utilization"
        aria-describedby={tooltipId}
      >
        <Icon name="gauge" />
        <span>{usageTooltipSummary(agentUsageStore.snapshot())}</span>
      </button>
      <div id={tooltipId} class="managed-agent-usage-tooltip" role="tooltip">
        <AgentUsageSection showHeader={false} />
      </div>
    </div>
  )
}
