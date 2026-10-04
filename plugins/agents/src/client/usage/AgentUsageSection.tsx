import { For, onCleanup, onMount, Show } from 'solid-js'
import { Alert, DescriptionList, IconButton, Inline, Meter, SectionHeader, Stack, StatusDot, Text } from '@acorn/plugin-api/ui'
import { agentUsageStore } from './usageStore'
import { providerMetaLine, providerUsageRows } from './usageModel'
import { usageMeterTone, usageTone } from '../sessions/stateTone'

// What each harness's own plan has left, read off the provider's CLI rather than any acorn record
// (docs/managed-agents/providers.md § Plan usage). One description list across providers: a row that names each,
// with its health dot and whose account it is, then its numbers. It is drawn inside a popover, which is why it carries no pane chrome.
export default function AgentUsageSection(props: { showHeader?: boolean }) {
  onMount(() => onCleanup(agentUsageStore.init()))

  const providers = () => agentUsageStore.snapshot()?.providers ?? []

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
        <For each={providers()}>
          {(provider) => <>
            <DescriptionList.Item label={
              <Inline>
                <Text emphasis="muted">{provider.label}</Text>
                <IconButton
                  icon="refresh-cw"
                  label={`Refresh ${provider.label} usage`}
                  spin={agentUsageStore.refreshingProviderId() === provider.provider}
                  disabled={agentUsageStore.refreshing()}
                  onPress={() => void agentUsageStore.refreshProvider(provider.provider)}
                />
              </Inline>
            }>
              <Stack gap="inline">
                <Inline>
                  <StatusDot tone={usageTone(provider.health)} label={provider.health} />
                  <Text emphasis="muted">{providerMetaLine(provider)}</Text>
                </Inline>
                <Show when={provider.error}>{(error) => <Alert tone="warn">{error().message}</Alert>}</Show>
              </Stack>
            </DescriptionList.Item>
            <For each={providerUsageRows(provider)}>
              {(row) => <DescriptionList.Item label={row.label}>
                {/* A quota row carries a bar under its sentence; cost and token rows stay text.
                    The mark shows where steady spending would have left the fill by now. */}
                {row.meter
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
                  : row.value}
              </DescriptionList.Item>}
            </For>
          </>}
        </For>
      </DescriptionList>
    </Stack>
  )
}
