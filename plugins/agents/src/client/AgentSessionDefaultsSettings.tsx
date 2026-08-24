import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { AgentConfigOption } from '@acorn/protocol/managedAgents.ts'
import { Button, Checkbox, Field, Select } from '@acorn/plugin-api/ui'
import type { AgentDefaultValues } from '../shared/sessionDefaults'
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
  const [follow, setFollow] = createSignal(true)
  const [pinned, setPinned] = createSignal<AgentDefaultValues>({})
  const [dirty, setDirty] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [saved, setSaved] = createSignal('')

  // Seeded from the stored record, but never over an edit in progress.
  createEffect(() => {
    const record = stored.data
    if (!record || dirty()) return
    setFollow(record.followLastSession)
    setPinned(record.pinned)
  })

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

  const choose = (providerId: string, optionId: string, value: string) => {
    setPinned((current) => {
      const forProvider = { ...current[providerId], [optionId]: value }
      if (!value) delete forProvider[optionId]
      return { ...current, [providerId]: forProvider }
    })
    setDirty(true)
    setSaved('')
    setError('')
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const persisted = await saveAgentSessionDefaults({ followLastSession: follow(), pinned: pinned() })
      queryClient.setQueryData(agentSessionDefaultsQueryKey, persisted)
      setDirty(false)
      setSaved('Saved. The next session you open uses these.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent defaults could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form class="settings-section" onSubmit={(event) => void submit(event)}>
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
        checked={follow()}
        label="Carry my last session's settings forward"
        hint="Switch model or effort inside a session and the next session of that provider starts there. Turn this off to pin the settings below instead."
        onChange={(event) => {
          setFollow(event.currentTarget.checked)
          setDirty(true)
          setSaved('')
        }}
      />

      <Show when={!follow()}>
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
                    <Field label={option.label} layout="row">
                      <Select
                        aria-label={`${provider.label} ${option.label}`}
                        size="sm"
                        width="auto"
                        value={pinned()[provider.id]?.[option.id] ?? ''}
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
      <Show when={saved()}><p class="muted" role="status">{saved()}</p></Show>
      <div class="settings-actions">
        <Button type="submit" disabled={!dirty() || saving()}>
          {saving() ? 'Saving…' : 'Save defaults'}
        </Button>
      </div>
    </form>
  )
}
