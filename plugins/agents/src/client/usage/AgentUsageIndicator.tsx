import { For, onCleanup, onMount, Show } from 'solid-js'
import { Button, Icon, Inline, Meter, Only, Popover, StatusDot, Text } from '@acorn/plugin-api/ui'
import AgentUsageSection from './AgentUsageSection'
import { usageSummaryEntries } from './usageModel'
import { usageTone } from '../sessions/stateTone'
import { agentUsageStore } from './usageStore'
import { accountIcon, accountLabel } from '../../shared/accounts'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'

// How much of each harness's plan is gone, in the pane header, with the full readout behind it.
//
// A Popover, not a hover tooltip: the panel it holds has a refresh button and several lines of
// numbers in it, so it has to be reachable from the keyboard and stay open while it is read.
// `defaultAccounts` names the account to show for each harness. The selected session's account
// takes precedence over the account used for new sessions (docs/managed-agents/accounts.md § Plan usage).
// `providers` carries each harness's "Show accounts as" choice and its accounts' icons.
export default function AgentUsageIndicator(props: {
  defaultAccounts?: Readonly<Record<string, string | undefined>>
  providers?: readonly AgentProviderDescriptor[]
}) {
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
          {/* A line after the gauge and between harnesses, so "Claude Code · personal 92%" and
              "Codex 13%" read as two readings rather than one run of words. */}
          <Inline gap="stack" divided>
            <Icon name="gauge" />
            {/* The placeholder names no harness, because only the node knows which ones exist. A
                phone's header has room for the gauge and a dot per harness, so it draws no words. */}
            <Show
              when={entries().length}
              fallback={
                <Only formFactors={['desktop', 'tui']}>
                  <Text emphasis="muted">reading usage…</Text>
                </Only>
              }
            >
              <For each={entries()}>
                {(entry) => {
                  const provider = () => props.providers?.find((candidate) => candidate.id === entry.provider)
                  const icon = () => accountIcon(provider(), entry.account)
                  return (
                    <Inline>
                      {/* How much of the window is still to run, as a pie that empties toward the
                          reset. Muted, because time passing is not a warning; the dot says that. */}
                      <Only formFactors={['desktop', 'tui']}>
                        <Show when={entry.timeLeft != null}>
                          <Meter shape="pie" tone="muted" value={entry.timeLeft!} label={entry.timeLeftLabel} />
                        </Show>
                      </Only>
                      <StatusDot tone={usageTone(entry.health)} size="sm" />
                      <Only formFactors={['desktop', 'tui']}>
                        <Show
                          when={icon()}
                          fallback={
                            <Text emphasis="muted">
                              {entry.label} {entry.value}
                            </Text>
                          }
                        >
                          {(name) => (
                            <>
                              <Text emphasis="muted">{entry.harness}</Text>
                              <Icon name={name()} title={accountLabel(provider(), entry.account!)} />
                              <Text emphasis="muted">{entry.value}</Text>
                            </>
                          )}
                        </Show>
                      </Only>
                    </Inline>
                  )
                }}
              </For>
            </Show>
          </Inline>
        </Button>
      )}
    >
      <AgentUsageSection defaultAccounts={props.defaultAccounts} providers={props.providers} />
    </Popover>
  )
}
