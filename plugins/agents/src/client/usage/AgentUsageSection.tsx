import { onCleanup, onMount, Show } from 'solid-js'
import { Alert, Facts, IconButton, Inline, Meter, SectionHeader, Stack, StatusDot, Text } from '@acorn/plugin-api/ui'
import { agentUsageStore } from './usageStore'
import { providerMetaLine, providerUsageRows } from './usageModel'
import { usageMeterTone, usageTone } from '../sessions/stateTone'

// What each harness's own plan has left, read off the provider's CLI rather than any acorn record
// (docs/managed-agents.md § Plan usage). One list of `Facts` for every provider: a row that names it,
// with its health dot and whose account it is, then its numbers. It is drawn inside a popover, which is why it carries no pane chrome.
export default function AgentUsageSection(props: { showHeader?: boolean }) {
  onMount(() => onCleanup(agentUsageStore.init()))

  const providers = () => agentUsageStore.snapshot()?.providers ?? []

  return (
    <Stack gap="section">
      <Show when={props.showHeader !== false}>
        {/* A popover's heading is a group label (docs/ui-design.md § Chrome and overlays). Each
            provider below has its own refresh. */}
        <SectionHeader level="group">Plan usage</SectionHeader>
      </Show>
      <Show when={agentUsageStore.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={!agentUsageStore.snapshot() && agentUsageStore.loading()}>
        <Text emphasis="muted">Reading usage…</Text>
      </Show>
      {/* One `Facts` for every provider, so the values share one column and the meters line up. Each
          provider's first row is its name, with the account line, the health dot and its refresh.
          `rows`, not the default tiles: every value here is a number with a qualifier after it ("47%
          remaining · resets Sep 18 at 12am"), which is wider than a tile. */}
      <Facts
        size="sm"
        grouping="rows"
        items={providers().flatMap((provider) => [
          {
            label: provider.label,
            value: (
              <Stack gap="inline">
                <Inline wrap>
                  <StatusDot tone={usageTone(provider.health)} label={provider.health} />
                  <Text emphasis="muted">{providerMetaLine(provider)}</Text>
                  <IconButton
                    icon="refresh-cw"
                    label={`Refresh ${provider.label} usage`}
                    spin={agentUsageStore.refreshingProviderId() === provider.provider}
                    disabled={agentUsageStore.refreshing()}
                    onPress={() => void agentUsageStore.refreshProvider(provider.provider)}
                  />
                </Inline>
                <Show when={provider.error}>{(error) => <Alert tone="warn">{error().message}</Alert>}</Show>
              </Stack>
            ),
          },
          ...providerUsageRows(provider).map((row) => ({
            label: row.label,
            // A quota row carries a bar under its sentence; the cost and token rows below it are not a
            // share of anything, so they stay text. The mark on the bar is where a steady spend would
            // have left the fill by now, so "27% left" reads as comfortable or not without doing the
            // arithmetic against the reset time beside it.
            value: row.meter
              ? (
                <Stack gap="inline">
                  <Text>{row.value}</Text>
                  <Meter
                    value={row.meter.fill}
                    mark={row.meter.pace ?? undefined}
                    tone={usageMeterTone(row.meter.health)}
                    label={`${row.label}: ${row.value}`}
                  />
                </Stack>
              )
              : row.value,
          })),
        ])}
      />
    </Stack>
  )
}
