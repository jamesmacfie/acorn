import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createResource, createSignal, For, Show, type Accessor } from 'solid-js'
import { pluginLabel, useSettingsDetail, useUnsavedChanges } from '@acorn/plugin-api/client'
import {
  Alert, Button, Chip, Field, Inline, Input, Select, SettingRow, SettingsSection, Stack, Text, Textarea, Toolbar,
} from '@acorn/plugin-api/ui'
import { confirmAction } from '@acorn/plugin-api/ui/host'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import { MAX_CUSTOM_AGENT_INSTRUCTIONS, type CustomAgent, type CustomAgentInput } from '../../shared/customAgents'
import { managedAgentApi } from '../sessions/managedClient'
import ProviderGlyph from '../sessions/ProviderGlyph'
import { advertisedOptionsByProvider } from './agentConfigOptions'
import { customAgentsOptions, deleteCustomAgent, saveCustomAgent } from './customAgentsClient'

// Settings -> Agents -> Custom agents: saved starts for a managed session (docs/managed-agents.md §
// Custom agents). A list, then one agent's editor in the same pane, which the settings header names
// and offers the way back from (useSettingsDetail). The editor is a form with Save and Cancel rather
// than saving on each change, unlike the rest of Settings, because an agent is a record that needs a
// name and a harness before it can exist at all. Delete sits in the editor's danger zone. The
// sections match the ones `../index.ts` declares.

// The harnesses whose system prompt acorn can add to. Every other one gets the instructions as context
// at the start of the session instead (server/drivers/acpDriver.ts).
const SYSTEM_PROMPT_HARNESSES: ReadonlySet<string> = new Set(['claude', 'codex'])

const TOOL_ACCESS = [
  { value: '', label: 'Every tool the session may use' },
  { value: 'write', label: 'Read and change, no running things' },
  { value: 'read', label: 'Read only' },
]

/** `opened` is the record as the editor first showed it, which is what "unsaved changes" is measured
 *  against. */
type Editing = { id: string | null; draft: CustomAgentInput; opened: CustomAgentInput }

// Option ids in a fixed order, because clearing an option and choosing it again appends its key.
const sameDraft = (left: CustomAgentInput, right: CustomAgentInput) => {
  const plain = (input: CustomAgentInput) =>
    JSON.stringify({ ...input, options: Object.fromEntries(Object.entries(input.options).sort()) })
  return plain(left) === plain(right)
}

export default function CustomAgentsSettings() {
  const agents = createQuery(() => customAgentsOptions())
  // Both only fill in the editor's choices, so a node that does not answer leaves them empty rather
  // than taking the page and its list of agents down with it.
  const [providers] = createResource(() => managedAgentApi.providers().catch(() => undefined))
  const [recent] = createResource(() => managedAgentApi.sessions({}).catch(() => undefined))
  const advertised = createMemo(() => advertisedOptionsByProvider(recent()?.sessions ?? []))
  const [editing, setEditing] = createSignal<Editing | null>(null)

  const providerFor = (id: string): AgentProviderDescriptor | undefined =>
    providers()?.find((provider) => provider.id === id)

  const open = (id: string | null, draft: CustomAgentInput) => setEditing({ id, draft, opened: draft })
  const create = () => {
    const first = providers()?.find((provider) => provider.installed)
    open(null, { name: '', providerId: first?.id ?? '', profileId: first?.profileId ?? '', options: {} })
  }
  const inputOf = ({ id: _id, source: _source, ...input }: CustomAgent): CustomAgentInput => input

  const summary = (agent: CustomAgent): string => [
    providerFor(agent.providerId)?.label ?? agent.providerId,
    ...Object.values(agent.options),
    ...(agent.maxToolRisk ? [TOOL_ACCESS.find((access) => access.value === agent.maxToolRisk)?.label ?? agent.maxToolRisk] : []),
  ].join(' · ')

  // A plugin's agents are read-only, so they sit apart under their own heading and offer Duplicate.
  const own = () => (agents.data ?? []).filter((agent) => agent.source.kind === 'user')
  const fromPlugins = () => (agents.data ?? []).filter((agent) => agent.source.kind === 'plugin')

  const row = (agent: CustomAgent) => (
    <SettingRow label={agent.name} description={agent.description || summary(agent)}>
      <Inline>
        <ProviderGlyph glyph={agent.glyph ?? providerFor(agent.providerId)?.glyph} label={agent.name} />
        <Show when={agent.source.kind === 'plugin' ? agent.source.pluginId : undefined}>
          {(pluginId) => <Chip size="xs">From {pluginLabel(pluginId())}</Chip>}
        </Show>
        <Show when={agent.source.kind === 'user'}>
          <Button size="sm" variant="ghost" onPress={() => open(agent.id, inputOf(agent))}>Edit</Button>
        </Show>
        <Button size="sm" variant="ghost" onPress={() => open(null, { ...inputOf(agent), name: `${agent.name} copy` })}>
          Duplicate
        </Button>
      </Inline>
    </SettingRow>
  )

  return (
    <>
      <Show when={agents.error}>
        <Alert>{agents.error instanceof Error ? agents.error.message : 'Custom agents could not be loaded.'}</Alert>
      </Show>
      <Show
        when={editing()}
        fallback={
          <>
            <SettingsSection
              id="agents"
              label="Custom agents"
              description="A custom agent is a harness with the settings, instructions, and tool access a session should start on. Each one appears under New in the Agent pane and in the command palette. Editing an agent changes the sessions you start from it later, not the ones already running."
              actions={
                <Button onPress={create} disabled={!providers()?.some((provider) => provider.installed)}>
                  New agent
                </Button>
              }
            >
              <For each={own()} fallback={<Show when={agents.isSuccess}><Text emphasis="muted">No custom agents yet.</Text></Show>}>{row}</For>
            </SettingsSection>
            <Show when={fromPlugins().length}>
              <SettingsSection
                id="from-plugins"
                label="From plugins"
                description="Agents a plugin adds. Duplicate one to change it."
              >
                <For each={fromPlugins()}>{row}</For>
              </SettingsSection>
            </Show>
          </>
        }
      >
        {(current) => (
          <AgentEditor
            editing={current}
            providers={providers() ?? []}
            advertised={advertised()}
            onChange={(draft) => setEditing({ ...current(), draft })}
            onClose={() => setEditing(null)}
          />
        )}
      </Show>
    </>
  )
}

function AgentEditor(props: {
  editing: Accessor<Editing>
  providers: AgentProviderDescriptor[]
  advertised: ReturnType<typeof advertisedOptionsByProvider>
  onChange: (draft: CustomAgentInput) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [error, setError] = createSignal('')
  const draft = () => props.editing().draft
  const providerFor = (id: string) => props.providers.find((provider) => provider.id === id)
  const provider = () => providerFor(draft().providerId)
  const dirty = () => !sameDraft(props.editing().draft, props.editing().opened)
  const update = (patch: Partial<CustomAgentInput>) => props.onChange({ ...draft(), ...patch })
  const chooseHarness = (providerId: string) => {
    const next = providerFor(providerId)
    // Options belong to one harness, so a switch starts the new one on its own choices.
    if (next) update({ providerId, profileId: next.profileId, options: {} })
  }
  const chooseOption = (optionId: string, value: string) => {
    const options = { ...draft().options }
    if (value) options[optionId] = value
    else delete options[optionId]
    update({ options })
  }

  // Settings asks before anything leaves the page while this holds changes, the header's back link and
  // ⌘[ included. Only Cancel drops the changes at once.
  useUnsavedChanges(dirty)
  const title = () => (props.editing().id ? props.editing().opened.name : 'New agent')
  const hostDrawsBack = useSettingsDetail(title, props.onClose)
  // Drawn outside settings, the page has no header, so it draws its own way back and asks itself.
  const back = () => {
    if (!dirty()) return props.onClose()
    void confirmAction({
      title: 'Discard unsaved changes',
      actionLabel: 'Discard changes',
      goes: 'The changes to this agent that are not saved yet.',
      stays: props.editing().id ? 'The agent as it was last saved.' : undefined,
      danger: true,
    }).then((discard) => { if (discard) props.onClose() })
  }

  const save = async () => {
    const current = props.editing()
    if (!current.draft.name.trim()) return setError('Give the agent a name.')
    if (!current.draft.providerId) return setError('Pick a harness for the agent to run on.')
    setSaving(true)
    setError('')
    try {
      await saveCustomAgent(queryClient, current.id, current.draft)
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    const current = props.editing()
    if (!current.id) return
    const confirmed = await confirmAction({
      title: `Delete ${current.opened.name}`,
      actionLabel: 'Delete agent',
      goes: `The custom agent ${current.opened.name}, and its place under New and in the command palette.`,
      stays: 'Sessions you already started from it keep running with the settings they started on.',
      danger: true,
    })
    if (!confirmed) return
    setDeleting(true)
    setError('')
    try {
      await deleteCustomAgent(queryClient, current.id)
      props.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Show when={!hostDrawsBack}>
        <Inline><Button variant="bare" size="sm" onPress={back}>‹ Custom agents</Button></Inline>
      </Show>
      <SettingsSection id="agent" label="Agent">
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
              options={props.providers
                .filter((candidate) => candidate.installed || candidate.id === draft().providerId)
                .map((candidate) => ({ value: candidate.id, label: candidate.label }))}
              onChange={chooseHarness}
            />
          </Field>
          <Show
            when={props.advertised[draft().providerId]?.length}
            fallback={
              <Text emphasis="muted" wrap>
                Open a {provider()?.label ?? 'session on this harness'} session once. The model, effort,
                and mode it offers appear here after that.
              </Text>
            }
          >
            <For each={props.advertised[draft().providerId]}>
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
          <Field label="Acorn tools" hint="The most this agent may do with Acorn's own tools. It never widens what Tools and permissions allows." layout="split">
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
          <Toolbar variant="actions">
            <Button tone="accent" variant="solid" busy={saving()} onPress={() => void save()}>Save</Button>
            <Button variant="ghost" onPress={props.onClose}>Cancel</Button>
          </Toolbar>
        </Stack>
      </SettingsSection>
      <Show when={props.editing().id}>
        <SettingsSection id="danger" label="Danger zone" tone="danger">
          <SettingRow label="Delete agent" description="Sessions already started from it keep running.">
            <Button tone="danger" busy={deleting()} onPress={() => void remove()}>Delete agent</Button>
          </SettingRow>
        </SettingsSection>
      </Show>
    </>
  )
}
