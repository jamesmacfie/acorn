import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import {
  Alert, Button, Chip, ConfirmButton, Field, Inline, Input, Modal, Section, Select, Stack, Text, Textarea,
} from '@acorn/plugin-api/ui'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { MAX_CUSTOM_AGENT_INSTRUCTIONS, type CustomAgent, type CustomAgentInput } from '../../shared/customAgents'
import { managedAgentApi } from '../sessions/managedClient'
import ProviderGlyph from '../sessions/ProviderGlyph'
import { advertisedOptionsByProvider } from './agentConfigOptions'
import { customAgentsOptions, deleteCustomAgent, saveCustomAgent } from './customAgentsClient'

// Settings -> Custom agents: saved starts for a managed session (docs/managed-agents.md § Custom
// agents). A list, and one editor in a dialog. The editor saves on its button rather than on each
// change, unlike the rest of Settings, because an agent is a record that needs a name and a harness
// before it can exist at all.

// The harnesses whose system prompt acorn can add to. Every other one gets the instructions as context
// at the start of the session instead (server/drivers/acpDriver.ts).
const SYSTEM_PROMPT_HARNESSES: ReadonlySet<string> = new Set(['claude', 'codex'])

const TOOL_ACCESS = [
  { value: '', label: 'Every tool the session may use' },
  { value: 'write', label: 'Read and change, no running things' },
  { value: 'read', label: 'Read only' },
]

type Editing = { id: string | null; draft: CustomAgentInput }

export default function CustomAgentsSettings() {
  const queryClient = useQueryClient()
  const agents = createQuery(() => customAgentsOptions())
  const [providers] = createResource(() => managedAgentApi.providers())
  const [recent] = createResource(() => managedAgentApi.sessions({}))
  const advertised = createMemo(() => advertisedOptionsByProvider(recent()?.sessions ?? []))
  const [editing, setEditing] = createSignal<Editing | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')

  const providerFor = (id: string): AgentProviderDescriptor | undefined =>
    providers()?.find((provider) => provider.id === id)

  const open = (id: string | null, draft: CustomAgentInput) => {
    setError('')
    setEditing({ id, draft })
  }
  const create = () => {
    const first = providers()?.find((provider) => provider.installed)
    open(null, { name: '', providerId: first?.id ?? '', profileId: first?.profileId ?? '', options: {} })
  }
  const inputOf = ({ id: _id, source: _source, ...input }: CustomAgent): CustomAgentInput => input
  const update = (patch: Partial<CustomAgentInput>) => {
    const current = editing()
    if (current) setEditing({ ...current, draft: { ...current.draft, ...patch } })
  }
  const chooseHarness = (providerId: string) => {
    const provider = providerFor(providerId)
    // Options belong to one harness, so a switch starts the new one on its own choices.
    if (provider) update({ providerId, profileId: provider.profileId, options: {} })
  }
  const chooseOption = (optionId: string, value: string) => {
    const options = { ...editing()?.draft.options }
    if (value) options[optionId] = value
    else delete options[optionId]
    update({ options })
  }

  const save = async () => {
    const current = editing()
    if (!current) return
    if (!current.draft.name.trim()) return setError('Give the agent a name.')
    if (!current.draft.providerId) return setError('Pick a harness for the agent to run on.')
    setSaving(true)
    setError('')
    try {
      await saveCustomAgent(queryClient, current.id, current.draft)
      setEditing(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  const remove = async (agent: CustomAgent) => {
    setError('')
    try {
      await deleteCustomAgent(queryClient, agent.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent could not be deleted.')
    }
  }

  const summary = (agent: CustomAgent): string => [
    providerFor(agent.providerId)?.label ?? agent.providerId,
    ...Object.values(agent.options),
    ...(agent.maxToolRisk ? [TOOL_ACCESS.find((access) => access.value === agent.maxToolRisk)?.label ?? agent.maxToolRisk] : []),
  ].join(' · ')

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        A custom agent is a harness with the settings, instructions, and tool access a session should
        start on. Each one appears under New in the Agent pane and in the command palette. Editing an
        agent changes the sessions you start from it later, not the ones already running.
      </Text>

      <Show when={agents.error}>
        <Alert>{agents.error instanceof Error ? agents.error.message : 'Custom agents could not be loaded.'}</Alert>
      </Show>
      <Show when={!editing() && error()}>{(message) => <Alert>{message()}</Alert>}</Show>

      <Inline>
        <Button variant="solid" onPress={create} disabled={!providers()?.some((provider) => provider.installed)}>
          New agent
        </Button>
      </Inline>

      <For
        each={agents.data ?? []}
        fallback={<Text emphasis="muted">No custom agents yet.</Text>}
      >
        {(agent) => (
          <Section
            label={agent.name}
            actions={
              <Inline>
                <Show when={agent.source.kind === 'plugin' ? agent.source.pluginId : undefined}>
                  {(pluginId) => <Chip size="xs">From {pluginId()}</Chip>}
                </Show>
                <Show when={agent.source.kind === 'user'}>
                  <Button size="sm" variant="ghost" onPress={() => open(agent.id, inputOf(agent))}>Edit</Button>
                </Show>
                <Button size="sm" variant="ghost" onPress={() => open(null, { ...inputOf(agent), name: `${agent.name} copy` })}>
                  Duplicate
                </Button>
                <Show when={agent.source.kind === 'user'}>
                  <ConfirmButton size="sm" variant="ghost" tone="danger" confirmLabel="Delete?" onConfirm={() => void remove(agent)}>
                    Delete
                  </ConfirmButton>
                </Show>
              </Inline>
            }
          >
            <Inline>
              <ProviderGlyph glyph={agent.glyph ?? providerFor(agent.providerId)?.glyph} label={agent.name} />
              <Text emphasis="muted" wrap>{agent.description || summary(agent)}</Text>
            </Inline>
          </Section>
        )}
      </For>

      <Show when={editing()}>
        {(current) => {
          const draft = () => current().draft
          const provider = () => providerFor(draft().providerId)
          return (
            <Modal onDismiss={() => setEditing(null)} title={current().id ? 'Edit agent' : 'New agent'} size="md">
              <Modal.Body>
                <Stack gap="row">
                  <Field label="Name">
                    <Input
                      value={draft().name}
                      placeholder="Bug reviewer"
                      maxLength={100}
                      ref={(el) => queueMicrotask(() => el.focus())}
                      onInput={(name) => update({ name })}
                    />
                  </Field>
                  <Field label="Description" hint="Shown under the name in New. Leave it empty to show the harness and its settings.">
                    <Input value={draft().description ?? ''} maxLength={500} onInput={(description) => update({ description: description || undefined })} />
                  </Field>
                  <Field label="Icon" hint="A Lucide icon name, such as bug. Leave it empty to use the harness's mark.">
                    <Input value={draft().glyph ?? ''} maxLength={200} onInput={(glyph) => update({ glyph: glyph.trim() || undefined })} />
                  </Field>
                  <Field label="Harness" layout="split">
                    <Select
                      label="Harness"
                      size="sm"
                      value={draft().providerId}
                      options={(providers() ?? [])
                        .filter((candidate) => candidate.installed || candidate.id === draft().providerId)
                        .map((candidate) => ({ value: candidate.id, label: candidate.label }))}
                      onChange={chooseHarness}
                    />
                  </Field>
                  <Show
                    when={advertised()[draft().providerId]?.length}
                    fallback={
                      <Text emphasis="muted" wrap>
                        Open a {provider()?.label ?? 'session on this harness'} session once. The model, effort,
                        and mode it offers appear here after that.
                      </Text>
                    }
                  >
                    <For each={advertised()[draft().providerId]}>
                      {(option) => (
                        <Field label={option.label} layout="split">
                          <Select
                            label={option.label}
                            size="sm"
                            value={draft().options[option.id] ?? ''}
                            options={[
                              { value: '', label: 'Your usual default' },
                              ...option.values.map((value) => ({ value: value.value, label: value.label, title: value.description })),
                            ]}
                            onChange={(value) => chooseOption(option.id, value)}
                          />
                        </Field>
                      )}
                    </For>
                  </Show>
                  <Field label="Acorn tools" hint="The most this agent may do with Acorn's own tools. It never widens what your tool settings allow." layout="split">
                    <Select
                      label="Acorn tools"
                      size="sm"
                      value={draft().maxToolRisk ?? ''}
                      options={TOOL_ACCESS}
                      onChange={(value) => update({ maxToolRisk: (value || undefined) as CustomAgentInput['maxToolRisk'] })}
                    />
                  </Field>
                  <Field
                    label="Instructions"
                    hint={SYSTEM_PROMPT_HARNESSES.has(draft().providerId)
                      ? `Added to ${provider()?.label ?? 'the agent'}'s system prompt for every session started from this agent.`
                      : 'This harness has no system prompt Acorn can add to, so these go in front of the first message instead. A compaction can drop them.'}
                  >
                    <Textarea
                      value={draft().instructions ?? ''}
                      rows={8}
                      maxLength={MAX_CUSTOM_AGENT_INSTRUCTIONS}
                      placeholder="Review the change for correctness. Report each bug with the file and line, and say how sure you are."
                      onInput={(instructions) => update({ instructions: instructions || undefined })}
                    />
                  </Field>
                  <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
                </Stack>
              </Modal.Body>
              <Modal.Actions>
                <Button variant="bare" onPress={() => setEditing(null)}>Cancel</Button>
                <Button variant="solid" busy={saving()} onPress={() => void save()}>Save</Button>
              </Modal.Actions>
            </Modal>
          )
        }}
      </Show>
    </Stack>
  )
}
