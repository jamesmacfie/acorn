import { onCleanup, onMount } from 'solid-js'
import { agentUsageStore } from './usageStore'
import { usageTooltipSummary } from './usageModel'

export default function AgentsToggle(props: {
  active: boolean
  shortcut?: string
  onToggle: () => void
}) {
  onMount(() => onCleanup(agentUsageStore.init()))

  return (
    <button
      type="button"
      class="pane-switch-btn"
      classList={{ active: props.active }}
      data-tip="Agents"
      data-tip-key={props.shortcut}
      data-tip-sub={usageTooltipSummary(agentUsageStore.snapshot())}
      aria-label="Agents"
      onClick={props.onToggle}
    >
      ⠿
    </button>
  )
}
