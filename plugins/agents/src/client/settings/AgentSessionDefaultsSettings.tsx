import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { prefsOptions } from '@acorn/plugin-api/client'
import { Alert, Checkbox, Field, Section, Select, Stack, Text } from '@acorn/plugin-api/ui'
import {
  defaultAgentSessionDefaults,
  type AgentSessionDefaults,
} from '../../shared/sessionDefaults'
import { managedAgentApi } from '../sessions/managedClient'
import ProviderGlyph from '../sessions/ProviderGlyph'
import { advertisedOptionsByProvider } from './agentConfigOptions'
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

  // Pickers only for what a recent session advertised (./agentConfigOptions.ts says why).
  const advertised = createMemo(() => advertisedOptionsByProvider(recent()?.sessions ?? []))

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
  const inlineProvider = createMemo(() => record().inline.providerId ?? providers()?.find((provider) => provider.installed)?.id ?? '')
  const chooseInlineProvider = (providerId: string) => void save({ inline: { ...record().inline, providerId } })
  const chooseInlineOption = (providerId: string, optionId: string, value: string) => {
    const current = { ...record().inline.pinned[providerId] }
    if (value) current[optionId] = value
    else delete current[optionId]
    void save({ inline: {
      ...record().inline,
      pinned: { ...record().inline.pinned, [providerId]: current },
    } })
  }

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        Defaults Acorn applies to managed agent sessions, including how a paused usage window resumes
        and what a new session starts on. Provider option changes are written into the transcript so
        a session reads back under the settings it ran with.
      </Text>

      <Show when={stored.error}>
        <Alert>
          {stored.error instanceof Error ? stored.error.message : 'Agent defaults could not be loaded.'}
        </Alert>
      </Show>

      <Section label="Usage limits">
        <Checkbox
          checked={record().continueAfterUsageLimit}
          label="Continue when usage resets"
          hint="If an agent stops because its plan usage is exhausted and reports a reset time, Acorn keeps the turn queued and continues it after that time."
          onChange={(checked) => void save({ continueAfterUsageLimit: checked })}
        />
      </Section>

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

      <Section label="Inline diff chats">
        <Field label="Provider" layout="split">
          <Select label="Inline chat provider" size="sm" value={inlineProvider()}
            options={(providers() ?? []).filter((provider) => provider.installed).map((provider) => ({ value: provider.id, label: provider.label }))}
            onChange={chooseInlineProvider} />
        </Field>
        <For each={(advertised()[inlineProvider()] ?? []).filter((option) => option.category === 'model' || option.category === 'reasoning')}>
          {(option) => <Field label={option.label} layout="split">
            <Select label={`Inline chat ${option.label}`} size="sm"
              value={record().inline.pinned[inlineProvider()]?.[option.id] ?? ''}
              options={[{ value: '', label: 'Provider default' }, ...option.values.map((value) => ({ value: value.value, label: value.label }))]}
              onChange={(value) => chooseInlineOption(inlineProvider(), option.id, value)} />
          </Field>}
        </For>
      </Section>

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
