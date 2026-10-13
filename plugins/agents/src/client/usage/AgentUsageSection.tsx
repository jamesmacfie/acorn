import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  Alert,
  DescriptionList,
  IconButton,
  Inline,
  Meter,
  SectionHeader,
  Stack,
  StatusDot,
  Tabs,
  Text,
} from '@acorn/plugin-api/ui'
import { agentUsageStore } from './usageStore'
import { providerMetaLine, providerUsageRows, usageGroups, usageTabId, usageTabLabel } from './usageModel'
import { usageMeterTone, usageTone } from '../sessions/stateTone'

// What each harness's own plan has left, read off the provider's CLI rather than any acorn record
// (docs/managed-agents/providers.md § Plan usage). One description list across providers: a row that
// names each, with its health dot and whose account it is, then its numbers. A harness with extra
// accounts gets a tab per login in that row, and the numbers below are the chosen one's. It is drawn
// inside a popover, which is why it carries no pane chrome.
export default function AgentUsageSection(props: {
  showHeader?: boolean
  defaultAccounts?: Readonly<Record<string, string | undefined>>
}) {
  onMount(() => onCleanup(agentUsageStore.init()))

  const groups = () => usageGroups(agentUsageStore.snapshot())
  const [picked, setPicked] = createSignal<Record<string, { tab: string; defaultTab: string }>>({})

  return (
    <Stack gap="section">
      <Show when={props.showHeader !== false}>
        {/* A popover's heading is a group label (docs/ui-design/overlays.md § Chrome and overlays). Each
            provider below has its own refresh. */}
        <SectionHeader level="group">Plan usage</SectionHeader>
      </Show>
      <Show when={agentUsageStore.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={!agentUsageStore.snapshot() && agentUsageStore.loading()}>
        <Text emphasis="muted">Reading usage…</Text>
      </Show>
      {/* One list keeps the value column and meters aligned across providers. The refresh belongs
          beside the harness name, leaving the account details the full value column. */}
      <DescriptionList size="sm" layout="columns">
        <For each={groups()}>
          {(group) => {
            const defaultTab = () => props.defaultAccounts?.[group.provider] ?? 'default'
            const reading = () => {
              const choice = picked()[group.provider]
              const tab = choice?.defaultTab === defaultTab() ? choice.tab : defaultTab()
              return group.readings.find((candidate) => usageTabId(candidate) === tab) ?? group.readings[0]!
            }
            return (
              <>
                <DescriptionList.Item
                  label={
                    <Inline>
                      <Text emphasis="muted">{group.label}</Text>
                      <IconButton
                        icon="refresh-cw"
                        label={`Refresh ${group.label} usage`}
                        spin={agentUsageStore.refreshingProviderId() === group.provider}
                        disabled={agentUsageStore.refreshing()}
                        onPress={() => void agentUsageStore.refreshProvider(group.provider)}
                      />
                    </Inline>
                  }
                >
                  <Stack gap="inline">
                    <Show when={group.readings.length > 1}>
                      <Tabs
                        idPrefix={`agent-usage-${group.provider}`}
                        ariaLabel={`${group.label} accounts`}
                        tabs={group.readings.map((candidate) => ({
                          id: usageTabId(candidate),
                          label: usageTabLabel(candidate),
                        }))}
                        active={usageTabId(reading())}
                        onChange={(tab) =>
                          setPicked({ ...picked(), [group.provider]: { tab, defaultTab: defaultTab() } })
                        }
                      />
                    </Show>
                    <Inline>
                      <StatusDot tone={usageTone(reading().health)} label={reading().health} />
                      <Text emphasis="muted">{providerMetaLine(reading())}</Text>
                    </Inline>
                    <Show when={reading().error}>{(error) => <Alert tone="warn">{error().message}</Alert>}</Show>
                  </Stack>
                </DescriptionList.Item>
                <For each={providerUsageRows(reading())}>
                  {(row) => (
                    <DescriptionList.Item label={row.label}>
                      {/* A quota row carries a bar under its sentence; cost and token rows stay text.
                      The mark shows where steady spending would have left the fill by now. */}
                      {row.meter ? (
                        <Stack gap="inline">
                          <Text>{row.value}</Text>
                          <Meter
                            value={row.meter.fill}
                            mark={row.meter.pace ?? undefined}
                            tone={usageMeterTone(row.meter.health)}
                            label={`${row.label}: ${row.value}`}
                          />
                        </Stack>
                      ) : (
                        row.value
                      )}
                    </DescriptionList.Item>
                  )}
                </For>
              </>
            )
          }}
        </For>
      </DescriptionList>
    </Stack>
  )
}
