import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  Alert,
  Card,
  DescriptionList,
  Fold,
  Icon,
  IconButton,
  Inline,
  Meter,
  SectionHeader,
  Stack,
  StatusDot,
  Text,
} from '@acorn/plugin-api/ui'
import type { AgentProviderUsage } from '../../shared/usage'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { accountIcon } from '../../shared/accounts'
import { agentUsageStore } from './usageStore'
import {
  compactQuotas,
  dailySummary,
  dailyUsageRows,
  providerMetaLine,
  providerUsageRows,
  usageAccountKey,
  usageAccountLabel,
  usageGroups,
  type UsageDetailRow,
} from './usageModel'
import { usageMeterTone, usageTone } from '../sessions/stateTone'

// What each harness's own plan has left, read off the provider's CLI rather than any acorn record
// (docs/managed-agents/providers.md § Plan usage). One block per harness, headed by its name and
// refresh. Each account sits on its own card, so one account's numbers can't run into the next. A
// harness with one reading shows it on the card as is. A harness with extra accounts gets a row per
// account, with a dot and the session and week bars, so the accounts can be compared without
// opening anything. A row follows the harness's "Show accounts as" choice from `providers`, so with
// icons on it draws the account's icon in place of its name. It is drawn inside a popover, which is
// why it carries no pane chrome.
export default function AgentUsageSection(props: {
  showHeader?: boolean
  defaultAccounts?: Readonly<Record<string, string | undefined>>
  providers?: readonly AgentProviderDescriptor[]
}) {
  onMount(() => onCleanup(agentUsageStore.init()))

  const groups = () => usageGroups(agentUsageStore.snapshot())
  // Only the rows you opened or closed, by `provider:account`. A row you never touched follows the
  // account new sessions start on, so selecting a session on another account opens that one.
  const [toggled, setToggled] = createSignal<Record<string, boolean>>({})

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
      <For each={groups()}>
        {(group) => {
          const defaultKey = () => {
            const named = props.defaultAccounts?.[group.provider] ?? 'default'
            return usageAccountKey(
              group.readings.find((candidate) => usageAccountKey(candidate) === named) ?? group.readings[0]!,
            )
          }
          return (
            <Stack gap="inline">
              <Inline>
                <Text emphasis="strong">{group.label}</Text>
                <IconButton
                  icon="refresh-cw"
                  label={`Refresh ${group.label} usage`}
                  spin={agentUsageStore.refreshingProviderId() === group.provider}
                  disabled={agentUsageStore.refreshing()}
                  onPress={() => void agentUsageStore.refreshProvider(group.provider)}
                />
              </Inline>
              {/* One reading needs no row: a row labelled "Usual sign-in" would say nothing. */}
              <Show
                when={group.readings.length > 1}
                fallback={
                  <Card pad="sm">
                    <AccountBody reading={group.readings[0]!} showDot />
                  </Card>
                }
              >
                <For each={group.readings}>
                  {(reading) => {
                    const key = `${group.provider}:${usageAccountKey(reading)}`
                    const icon = () =>
                      accountIcon(
                        props.providers?.find((candidate) => candidate.id === group.provider),
                        reading.accountName ?? null,
                      )
                    return (
                      <Card pad="sm">
                        <Fold
                          level="sub"
                          // The icon names the account for a screen reader, so the label is empty.
                          label={icon() ? '' : usageAccountLabel(reading)}
                          leading={
                            <Inline>
                              <StatusDot tone={usageTone(reading.health)} label={reading.health} />
                              <Show when={icon()}>
                                {(name) => <Icon name={name()} title={usageAccountLabel(reading)} />}
                              </Show>
                            </Inline>
                          }
                          meta={
                            // No pace mark: a bar this short cannot show one legibly.
                            <Inline gap="row">
                              <For each={compactQuotas(reading)}>
                                {(quota) => (
                                  <Inline>
                                    <Text emphasis="muted">{quota.label}</Text>
                                    <Meter
                                      value={quota.fill}
                                      tone={usageMeterTone(quota.health)}
                                      label={`${usageAccountLabel(reading)} ${quota.label}: ${quota.value} remaining`}
                                    />
                                    <Text emphasis="muted">{quota.value}</Text>
                                  </Inline>
                                )}
                              </For>
                            </Inline>
                          }
                          open={toggled()[key] ?? usageAccountKey(reading) === defaultKey()}
                          onOpenChange={(open) => setToggled({ ...toggled(), [key]: open })}
                        >
                          <AccountBody reading={reading} />
                        </Fold>
                      </Card>
                    )
                  }}
                </For>
              </Show>
            </Stack>
          )
        }}
      </For>
    </Stack>
  )
}

// One account's full reading: who and how fresh, any error, the quotas and cost, then today's figures
// folded away. Inside an account row the row already carries the dot, so it is drawn only without one.
function AccountBody(props: { reading: AgentProviderUsage; showDot?: boolean }) {
  return (
    <Stack gap="inline">
      <Inline>
        <Show when={props.showDot}>
          <StatusDot tone={usageTone(props.reading.health)} label={props.reading.health} />
        </Show>
        <Text emphasis="muted">{providerMetaLine(props.reading)}</Text>
      </Inline>
      <Show when={props.reading.error}>{(error) => <Alert tone="warn">{error().message}</Alert>}</Show>
      <UsageRows rows={providerUsageRows(props.reading)} />
      {/* One key for every account: nobody wants the figures open for one and closed for another. */}
      <Show when={dailySummary(props.reading)}>
        {(summary) => (
          <Fold level="sub" label={summary()} persistKey="agent-usage-daily">
            <UsageRows rows={dailyUsageRows(props.reading)} />
          </Fold>
        )}
      </Show>
    </Stack>
  )
}

function UsageRows(props: { rows: UsageDetailRow[] }) {
  return (
    <Show when={props.rows.length}>
      <DescriptionList size="sm" layout="columns">
        <For each={props.rows}>
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
      </DescriptionList>
    </Show>
  )
}
