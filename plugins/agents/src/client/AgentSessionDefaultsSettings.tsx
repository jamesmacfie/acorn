import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { AgentConfigOption } from '@acorn/protocol/managedAgents.ts'
import { Checkbox, Field, Select } from '@acorn/plugin-api/ui'
import {
  defaultAgentSessionDefaults,
  type AgentSessionDefaults,
} from '../shared/sessionDefaults'
import { managedAgentApi } from './managedClient'
import {
  agentSessionDefaultsOptions,
  agentSessionDefaultsQueryKey,
  saveAgentSessionDefaults,
} from './sessionDefaultsClient'

// Settings -> Agent defaults: what a new session of each provider starts on
// (docs/managed-agents.md § New-session defaults).
export default function AgentSessionDefaultsSettings() {
  const queryClient = useQueryClient()
  const stored = createQuery(() => agentSessionDefaultsOptions())
  const [providers] = createResource(() => managedAgentApi.providers())
  const [recent] = createResource(() => managedAgentApi.sessions({}))
  const [error, setError] = createSignal('')

  const record = () => stored.data ?? defaultAgentSessionDefaults()

  /**
   * Which options each provider offers, read off the newest session that advertised them. A provider
   * only reports its models and reasoning levels once a session is running, so there is nowhere else
   * to read them from before one starts.
   *
   * Bounded by whatever the sessions list returns, which is the 50 most recent. A provider you have
   * not run in that many sessions shows no pickers until you run it again. Cache the advertised list
   * per provider in the same preference row if that starts to bite.
   */
  const advertised = createMemo(() => {
    const byProvider: Record<string, AgentConfigOption[]> = {}
    for (const session of recent()?.sessions ?? []) {
      if (byProvider[session.providerId]) continue
      const options = session.config.configOptions
      if (Array.isArray(options) && options.length) byProvider[session.providerId] = options as AgentConfigOption[]
    }
    return byProvider
  })

  // Each change is the save. The query cache carries it so every reader moves at once, and a write
  // that fails refetches rather than restoring a snapshot: two quick changes would otherwise let the
  // first one's rollback undo the second.
  const save = async (patch: Partial<AgentSessionDefaults>) => {
    queryClient.setQueryData(agentSessionDefaultsQueryKey, { ...record(), ...patch })
    setError('')
    try {
      queryClient.setQueryData(agentSessionDefaultsQueryKey, await saveAgentSessionDefaults(patch))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent defaults could not be saved.')
      void queryClient.invalidateQueries({ queryKey: agentSessionDefaultsQueryKey })
    }
  }

  const choose = (providerId: string, optionId: string, value: string) => {
    const forProvider = { ...record().pinned[providerId] }
    if (value) forProvider[optionId] = value
    else delete forProvider[optionId]
    void save({ pinned: { ...record().pinned, [providerId]: forProvider } })
  }

  return (
    <div class="settings-section">
      <p class="muted settings-hint">
        What a new agent session starts on: the model, the reasoning effort, the mode, and anything
        else the provider offers. Acorn applies these once the provider reports its options, and
        writes the switch into the transcript so a session reads back under the settings it ran with.
      </p>

      <Show when={stored.error}>
        <p class="settings-error" role="alert">
          {stored.error instanceof Error ? stored.error.message : 'Agent defaults could not be loaded.'}
        </p>
      </Show>

      <Checkbox
        checked={record().followLastSession}
        label="Carry my last session's settings forward"
        hint="Switch model or effort inside a session and the next session of that provider starts there. Turn this off to pin the settings below instead."
        onChange={(event) => void save({ followLastSession: event.currentTarget.checked })}
      />

      <Show when={!record().followLastSession}>
        <For each={providers()?.filter((provider) => provider.installed) ?? []}>
          {(provider) => (
            <section class="settings-subsection">
              <h3 class="settings-label">{provider.label}</h3>
              <Show
                when={advertised()[provider.id]?.length}
                fallback={
                  <p class="muted settings-hint">
                    Open a {provider.label} session once. The settings it offers appear here after that.
                  </p>
                }
              >
                <For each={advertised()[provider.id]}>
                  {(option) => (
                    <Field label={option.label} layout="split">
                      <Select
                        aria-label={`${provider.label} ${option.label}`}
                        size="sm"
                        value={record().pinned[provider.id]?.[option.id] ?? ''}
                        onChange={(event) => choose(provider.id, option.id, event.currentTarget.value)}
                      >
                        <option value="">Whatever {provider.label} picks</option>
                        <For each={option.values}>
                          {(value) => <option value={value.value} title={value.description}>{value.label}</option>}
                        </For>
                      </Select>
                    </Field>
                  )}
                </For>
              </Show>
            </section>
          )}
        </For>
      </Show>

      <Show when={error()}><p class="settings-error" role="alert">{error()}</p></Show>
    </div>
  )
}
