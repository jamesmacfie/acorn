import { For, onCleanup, onMount, Show } from 'solid-js'
import { Alert, Button, Facts, Icon, Inline, Section, Stack, StatusDot, Text, Toolbar } from '@acorn/plugin-api/ui'
import { agentUsageStore } from './usageStore'
import { formatUpdated, providerUsageRows } from './usageModel'
import { usageTone } from './stateTone'

// What each harness's own plan has left, read off the provider's CLI rather than any acorn record
// (docs/managed-agents.md § Plan usage). One block per provider: a health dot, whose account it is,
// and the numbers as `Facts`.
export default function AgentUsageSection(props: { showHeader?: boolean }) {
  onMount(() => onCleanup(agentUsageStore.init()))

  const providers = () => agentUsageStore.snapshot()?.providers ?? []

  return (
    <Stack gap="row">
      <Show when={props.showHeader !== false}>
        <Toolbar ariaLabel="Agent provider usage">
          <Text emphasis="eyebrow">Usage</Text>
          <Toolbar.Spacer />
          <Button
            variant="bare"
            size="sm"
            iconOnly
            label="Refresh agent usage"
            busy={agentUsageStore.refreshing()}
            disabled={agentUsageStore.refreshing()}
            onPress={() => void agentUsageStore.refresh()}
          >
            <Icon name="refresh-cw" />
          </Button>
        </Toolbar>
      </Show>
      <Show when={agentUsageStore.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={!agentUsageStore.snapshot() && agentUsageStore.loading()}>
        <Text emphasis="muted">Reading local provider usage…</Text>
      </Show>
      <For each={providers()}>
        {(provider) => (
          <Section label={provider.label}>
            <Stack gap="row">
              <Inline wrap>
                <StatusDot tone={usageTone(provider.health)} label={provider.health} />
                <Text emphasis="strong">{provider.label}</Text>
                <Show when={provider.plan}>{(plan) => <Text emphasis="muted">{plan()}</Text>}</Show>
                <Text emphasis="muted">{provider.stale ? 'stale · ' : ''}{formatUpdated(provider.capturedAt)}</Text>
              </Inline>
              <Show when={provider.account?.email || provider.account?.organization}>
                <Text emphasis="muted">
                  {[provider.account?.email, provider.account?.organization].filter(Boolean).join(' · ')}
                </Text>
              </Show>
              <Show when={provider.error}>{(error) => <Alert tone="warn">{error().message}</Alert>}</Show>
              <Facts size="sm" items={providerUsageRows(provider).map((row) => ({ label: row.label, value: row.value }))} />
            </Stack>
          </Section>
        )}
      </For>
    </Stack>
  )
}
