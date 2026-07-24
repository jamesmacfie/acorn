import { For, onCleanup, onMount, Show } from 'solid-js'
import type { AgentProviderUsage } from '../shared/usage'
import { agentUsageStore } from './usageStore'
import { formatUpdated, providerUsageRows } from './usageModel'

const providerLabel = (provider: AgentProviderUsage): string => (provider.provider === 'claude' ? 'Claude' : 'Codex')

export default function AgentUsageSection() {
  onMount(() => onCleanup(agentUsageStore.init()))

  return (
    <section class="agent-usage" aria-label="Agent provider usage">
      <div class="agent-usage-head">
        <span>Usage</span>
        <button
          type="button"
          class="section-refresh"
          title="Refresh agent usage"
          aria-label="Refresh agent usage"
          disabled={agentUsageStore.refreshing()}
          onClick={() => void agentUsageStore.refresh()}
        >
          {agentUsageStore.refreshing() ? '...' : '↻'}
        </button>
      </div>
      <Show when={agentUsageStore.error()}>
        <div class="agent-usage-route-error" role="alert">{agentUsageStore.error()}</div>
      </Show>
      <Show when={!agentUsageStore.snapshot() && agentUsageStore.loading()}>
        <div class="agent-usage-loading muted">Reading local provider usage…</div>
      </Show>
      <For each={agentUsageStore.snapshot()?.providers ?? []}>
        {(provider) => (
          <div class="agent-usage-provider" data-provider={provider.provider}>
            <div class="agent-usage-provider-head">
              <span class="agent-usage-health" data-health={provider.health} aria-hidden="true" />
              <strong>{providerLabel(provider)}</strong>
              <Show when={provider.plan}><span class="agent-usage-plan">{provider.plan}</span></Show>
              <span class="agent-usage-updated muted">
                {provider.stale ? 'stale · ' : ''}{formatUpdated(provider.capturedAt)}
              </span>
            </div>
            <Show when={provider.account?.email || provider.account?.organization}>
              <div class="agent-usage-account muted">
                {[provider.account?.email, provider.account?.organization].filter(Boolean).join(' · ')}
              </div>
            </Show>
            <Show when={provider.error}>
              {(error) => <div class="agent-usage-error" role="status">{error().message}</div>}
            </Show>
            <dl class="agent-usage-values">
              <For each={providerUsageRows(provider)}>
                {(row) => (
                  <div class="agent-usage-value">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                )}
              </For>
            </dl>
          </div>
        )}
      </For>
    </section>
  )
}
