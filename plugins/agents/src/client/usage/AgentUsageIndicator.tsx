import { For, onCleanup, onMount, Show } from 'solid-js'
import { Button, Icon, Inline, Meter, Popover, StatusDot, Text } from '@acorn/plugin-api/ui'
import AgentUsageSection from './AgentUsageSection'
import { usageSummaryEntries } from './usageModel'
import { usageTone } from '../sessions/stateTone'
import { agentUsageStore } from './usageStore'

// How much of each harness's plan is gone, in the pane header, with the full readout behind it.
//
// A Popover, not a hover tooltip: the panel it holds has a refresh button and several lines of
// numbers in it, so it has to be reachable from the keyboard and stay open while it is read.
// `defaultAccounts` names, by harness id, the account new sessions start on, which is the one the
// button reads for a harness with extra accounts (docs/managed-agents/accounts.md).
export default function AgentUsageIndicator(props: { defaultAccounts?: Readonly<Record<string, string | undefined>> }) {
  // The button is the always-mounted reader, so it starts the load itself. A Popover does not render
  // its content until it opens, so with the panel as the only caller the button would sit on "reading
  // usage…" forever. The panel calls init() too, which is fine: the store counts consumers.
  onMount(() => onCleanup(agentUsageStore.init()))

  const entries = () => usageSummaryEntries(agentUsageStore.snapshot(), props.defaultAccounts)

  return (
    <Popover
      placement="bottom-end"
      // Wide enough for the longest line the panel draws, a label beside "80% remaining · resets
      // Sep 17 at 11:59pm": the value column wraps rather than pushing the surface open, so the
      // width has to be asked for here.
      minWidth={460}
      ariaLabel="Agent utilization"
      role="dialog"
      trigger={({ toggle, open }) => (
        <Button label="Agent utilization" size="sm" expanded={open()} onPress={toggle}>
          <Icon name="gauge" />
          {/* The placeholder names no harness, because only the node knows which ones exist. */}
          <Show when={entries().length} fallback={<Text emphasis="muted">reading usage…</Text>}>
            {/* The pairs sit a step further apart than the dot sits from its own label, which is
                what keeps "Claude Code 48%" and "Codex —" reading as two readings rather than one
                run of words. Gap `none` on the inner one puts the dot against the first letter. */}
            <Inline gap="stack">
              <For each={entries()}>
                {(entry) => (
                  <Inline>
                    {/* How much of the window is still to run, as a pie that empties toward the
                        reset. Muted, because time passing is not a warning; the dot says that. */}
                    <Show when={entry.timeLeft != null}>
                      <Meter shape="pie" tone="muted" value={entry.timeLeft!} label={entry.timeLeftLabel} />
                    </Show>
                    <StatusDot tone={usageTone(entry.health)} size="sm" />
                    <Text emphasis="muted">
                      {entry.label} {entry.value}
                    </Text>
                  </Inline>
                )}
              </For>
            </Inline>
          </Show>
        </Button>
      )}
    >
      <AgentUsageSection />
    </Popover>
  )
}
