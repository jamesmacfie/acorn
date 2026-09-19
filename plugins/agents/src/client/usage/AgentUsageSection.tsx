import { For, onCleanup, onMount, Show } from 'solid-js'
import { Alert, Facts, IconButton, Inline, Stack, StatusDot, Text, Toolbar } from '@acorn/plugin-api/ui'
import { agentUsageStore } from './usageStore'
import { providerMetaLine, providerUsageRows } from './usageModel'
import { usageTone } from '../sessions/stateTone'

// What each harness's own plan has left, read off the provider's CLI rather than any acorn record
// (docs/managed-agents.md § Plan usage). One block per provider: a health dot, whose account it is,
// and the numbers as `Facts`. It is drawn inside a popover, which is why it carries no pane chrome.
export default function AgentUsageSection(props: { showHeader?: boolean }) {
  onMount(() => onCleanup(agentUsageStore.init()))

  const providers = () => agentUsageStore.snapshot()?.providers ?? []

  return (
    <Stack gap="section">
      <Show when={props.showHeader !== false}>
        <Toolbar ariaLabel="Agent provider usage">
          <Text emphasis="eyebrow">Usage</Text>
          <Toolbar.Spacer />
          <IconButton
            icon="refresh-cw"
            label="Refresh agent usage"
            busy={agentUsageStore.refreshing()}
            disabled={agentUsageStore.refreshing()}
            onPress={() => void agentUsageStore.refresh()}
          />
        </Toolbar>
      </Show>
      <Show when={agentUsageStore.error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={!agentUsageStore.snapshot() && agentUsageStore.loading()}>
        <Text emphasis="muted">Reading local provider usage…</Text>
      </Show>
      <For each={providers()}>
        {/* An eyebrow line rather than a `Section`, which is what the changes plugin's model picker
            does in its own popover: a Section indents its label past its body, so the name sat a
            step right of the numbers under it. One name per block, and it used to be drawn twice. */}
        {(provider) => (
          <Stack gap="row">
            <Inline>
              <StatusDot tone={usageTone(provider.health)} label={provider.health} />
              <Text emphasis="eyebrow">{provider.label}</Text>
            </Inline>
            <Text emphasis="muted">{providerMetaLine(provider)}</Text>
            <Show when={provider.error}>{(error) => <Alert tone="warn">{error().message}</Alert>}</Show>
            {/* `rows`, not the default tiles: every value here is a number with a qualifier after
                it ("47% remaining · resets Sep 18 at 12am"), which is wider than a tile, so the
                auto-fitting grid wrapped each one mid-phrase and left the two columns ragged. */}
            <Facts
              size="sm"
              grouping="rows"
              items={providerUsageRows(provider).map((row) => ({ label: row.label, value: row.value }))}
            />
          </Stack>
        )}
      </For>
    </Stack>
  )
}
