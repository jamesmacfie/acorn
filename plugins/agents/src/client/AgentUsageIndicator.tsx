import { createUniqueId, For, Show } from 'solid-js'
import { Button, Icon, StatusDot } from '@acorn/plugin-api/ui'
import AgentUsageSection from './AgentUsageSection'
import { usageSummaryEntries } from './usageModel'
import { usageTone } from './stateTone'
import { agentUsageStore } from './usageStore'
import './agent-usage.css'

export default function AgentUsageIndicator() {
  const tooltipId = `agent-usage-${createUniqueId()}`
  const entries = () => usageSummaryEntries(agentUsageStore.snapshot())

  return (
    <div class="managed-agent-usage">
      <Button
        label="Agent utilization"
        describedBy={tooltipId}
      >
        <Icon name="gauge" />
        {/* The placeholder names no harness, because only the node knows which ones exist. */}
        <Show when={entries().length > 0} fallback={<span class="managed-agent-usage-summary">reading usage…</span>}>
          <span class="managed-agent-usage-summary">
            <For each={entries()}>
              {(entry) => (
                <span class="managed-agent-usage-entry">
                  <StatusDot tone={usageTone(entry.health)} size="sm" />
                  {entry.label} {entry.value}
                </span>
              )}
            </For>
          </span>
        </Show>
      </Button>
      <div id={tooltipId} class="managed-agent-usage-tooltip" role="tooltip">
        <AgentUsageSection showHeader={false} />
      </div>
    </div>
  )
}
