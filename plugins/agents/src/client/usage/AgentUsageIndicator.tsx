import { For, Show } from 'solid-js'
import { Button, Icon, Inline, Popover, StatusDot, Text } from '@acorn/plugin-api/ui'
import AgentUsageSection from './AgentUsageSection'
import { usageSummaryEntries } from './usageModel'
import { usageTone } from '../sessions/stateTone'
import { agentUsageStore } from './usageStore'

// How much of each harness's plan is gone, in the pane header, with the full readout behind it.
//
// A Popover, not a hover tooltip: the panel it holds has a refresh button and several lines of
// numbers in it, so it has to be reachable from the keyboard and stay open while it is read. The
// hover-only version of this was a rectangle the kit had no name for.
export default function AgentUsageIndicator() {
  const entries = () => usageSummaryEntries(agentUsageStore.snapshot())

  return (
    <Popover
      placement="bottom-end"
      minWidth={360}
      ariaLabel="Agent utilization"
      role="dialog"
      trigger={({ toggle, open }) => (
        <Button label="Agent utilization" size="sm" expanded={open()} onPress={toggle}>
          <Icon name="gauge" />
          {/* The placeholder names no harness, because only the node knows which ones exist. */}
          <Show when={entries().length} fallback={<Text emphasis="muted">reading usage…</Text>}>
            {/* The pairs sit a step further apart than the dot sits from its own label, which is
                what keeps "Claude Code 48%" and "Codex —" reading as two readings rather than one
                run of words. Gap `none` on the inner one had the dot touching the C. */}
            <Inline gap="stack">
              <For each={entries()}>
                {(entry) => (
                  <Inline>
                    <StatusDot tone={usageTone(entry.health)} size="sm" />
                    <Text emphasis="muted">{entry.label} {entry.value}</Text>
                  </Inline>
                )}
              </For>
            </Inline>
          </Show>
        </Button>
      )}
    >
      <AgentUsageSection showHeader={false} />
    </Popover>
  )
}
