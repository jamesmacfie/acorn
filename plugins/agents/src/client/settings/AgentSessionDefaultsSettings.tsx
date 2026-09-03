import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { AgentConfigOption } from '@acorn/protocol/managedAgents.ts'
import { prefsOptions } from '@acorn/plugin-api/client'
import { Alert, Checkbox, Field, Section, Select, Stack, Text } from '@acorn/plugin-api/ui'
import {
  defaultAgentSessionDefaults,
  type AgentSessionDefaults,
} from '../../shared/sessionDefaults'
import { managedAgentApi } from '../sessions/managedClient'
import ProviderGlyph from '../sessions/ProviderGlyph'
import {
  agentSessionDefaultsOptions,
  writeAgentSessionDefaults,
} from './sessionDefaultsClient'
import {
  AGENT_TOOL_FOLD_CHOICES,
  type AgentToolFoldMode,
  readAgentToolFoldPrefs,
  saveAgentToolFoldMode,
} from '../sessions/toolFoldPrefs'

// Settings -> Agent defaults: what a new session of each provider starts on
// (docs/managed-agents.md § New-session defaults).
export default function AgentSessionDefaultsSettings() {
  const queryClient = useQueryClient()
  const stored = createQuery(() => agentSessionDefaultsOptions())
  const [providers] = createResource(() => managedAgentApi.providers())
  const prefs = createQuery(() => prefsOptions(true))
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

  // Each change is the save, through the shared writer the palette's setting command also uses
  // (./sessionDefaultsClient.ts holds the cache rule). What this page adds is where the failure goes.
  const save = async (patch: Partial<AgentSessionDefaults>) => {
    setError('')
    try {
      await writeAgentSessionDefaults(queryClient, record(), patch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent defaults could not be saved.')
    }
  }

  // A different store from everything above: the fold setting is this device's preference about how a
  // transcript is drawn, not part of the record the node keeps of what a session launches with.
  const fold = () => readAgentToolFoldPrefs(prefs.data)
  const chooseFold = (mode: AgentToolFoldMode) => void saveAgentToolFoldMode(queryClient, prefs.data, mode)

  const choose = (providerId: string, optionId: string, value: string) => {
    const forProvider = { ...record().pinned[providerId] }
    if (value) forProvider[optionId] = value
    else delete forProvider[optionId]
    void save({ pinned: { ...record().pinned, [providerId]: forProvider } })
  }

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        What a new agent session starts on: the model, the reasoning effort, the mode, and anything
        else the provider offers. Acorn applies these once the provider reports its options, and
        writes the switch into the transcript so a session reads back under the settings it ran with.
      </Text>

      <Show when={stored.error}>
        <Alert>
          {stored.error instanceof Error ? stored.error.message : 'Agent defaults could not be loaded.'}
        </Alert>
      </Show>

      <Checkbox
        checked={record().followLastSession}
        label="Carry my last session's settings forward"
        hint="Switch model or effort inside a session and the next session of that provider starts there. Turn this off to pin the settings below instead."
        onChange={(checked) => void save({ followLastSession: checked })}
      />

      <Show when={!record().followLastSession}>
        <For each={providers()?.filter((provider) => provider.installed) ?? []}>
          {(provider) => (
            <Section
              label={provider.label}
              actions={<ProviderGlyph glyph={provider.glyph} label={provider.label} />}
            >
              <Show
                when={advertised()[provider.id]?.length}
                fallback={
                  <Text emphasis="muted" wrap>
                    Open a {provider.label} session once. The settings it offers appear here after that.
                  </Text>
                }
              >
                <Stack gap="row">
                  <For each={advertised()[provider.id]}>
                    {(option) => (
                      <Field label={option.label} layout="split">
                        <Select
                          label={`${provider.label} ${option.label}`}
                          size="sm"
                          value={record().pinned[provider.id]?.[option.id] ?? ''}
                          options={[
                            { value: '', label: `Whatever ${provider.label} picks` },
                            ...option.values.map((value) => ({ value: value.value, label: value.label, title: value.description })),
                          ]}
                          onChange={(value) => choose(provider.id, option.id, value)}
                        />
                      </Field>
                    )}
                  </For>
                </Stack>
              </Show>
            </Section>
          )}
        </For>
      </Show>

      <Section label="Transcript">
        <Field
          label="Tool call display"
          hint="How a tool call's output starts out when it first appears. This one is a setting for this device, not for a provider."
          layout="split"
        >
          <Select
            label="Tool call display"
            size="sm"
            value={fold().mode}
            onChange={(value) => chooseFold(value as AgentToolFoldMode)}
            options={[...AGENT_TOOL_FOLD_CHOICES]}
          />
        </Field>
      </Section>

      <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
    </Stack>
  )
}
