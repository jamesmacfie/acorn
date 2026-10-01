import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createResource, For, Show } from 'solid-js'
import { createSettingSave, prefsOptions } from '@acorn/plugin-api/client'
import { Alert, Badge, Checkbox, Inline, Link, Select, SettingRow, SettingsSection, Text } from '@acorn/plugin-api/ui'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import {
  AGENT_ARCHIVED_HISTORY_CHOICES,
  AGENT_IDLE_STOP_CHOICES,
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
  defaultAgentToolFoldPrefs,
  type AgentToolFoldMode,
  readAgentToolFoldPrefs,
  saveAgentToolFoldMode,
} from '../sessions/toolFoldPrefs'
import { saveStartupContextInjection, startupContextInjection } from './startupContext'

/** The line under a harness's name: its version and sign-in, or why it is missing. The row's badge says
 *  whether it is installed. */
const harnessState = (provider: AgentProviderDescriptor): string | undefined => {
  if (!provider.installed) return provider.diagnostics[0]
  const parts = [provider.executableVersion ? `Version ${provider.executableVersion}.` : '', provider.authenticated === false ? 'Not signed in.' : '']
  return parts.filter(Boolean).join(' ') || undefined
}

// Settings -> Agents -> Harnesses and defaults: the harnesses this node can run, and what a new session
// of each one starts on (docs/managed-agents.md § New-session defaults). Every control saves when it
// changes, and a failure is said on the row that failed. A default seeds new sessions only; each row
// that is one says which control changes a session already open. The fixed sections match the ones
// `../index.ts` declares for search; the one per harness depends on what is installed, so search does
// not list it.
// The one piece of the settings page context this page uses. Optional, so the page draws on its own
// in a test.
type PageContext = { navigate: (target: string) => void }

export default function AgentSessionDefaultsSettings(props: { context?: PageContext }) {
  const queryClient = useQueryClient()
  const stored = createQuery(() => agentSessionDefaultsOptions())
  // Both only fill in choices, so a node that does not answer leaves them empty rather than taking the
  // page down with it.
  const [providers] = createResource(() => managedAgentApi.providers().catch(() => undefined))
  const prefs = createQuery(() => prefsOptions(true))
  const [recent] = createResource(() => managedAgentApi.sessions({}).catch(() => undefined))

  // Over the defaults rather than instead of them: a cached answer from an older node can lack a field
  // added since, and a Select with no value draws blank until the refetch lands.
  const record = (): AgentSessionDefaults => ({ ...defaultAgentSessionDefaults(), ...stored.data })

  // Pickers only for what a recent session advertised (./agentConfigOptions.ts says why).
  const advertised = createMemo(() => advertisedOptionsByProvider(recent()?.sessions ?? []))

  // Each change is the save, through the shared writer the palette's setting command also uses
  // (./sessionDefaultsClient.ts holds the cache rule). What this page adds is where the failure goes:
  // the row's own save state, which the writer's rethrow feeds.
  // Not before the record is read: a patch carries whole `pinned` and `inline` objects built from it, and
  // built from the defaults it would wipe every other harness's pins on the node.
  const save = async (patch: Partial<AgentSessionDefaults>) => {
    if (!stored.data) throw new Error('This node\'s defaults have not been read yet. Try again in a moment.')
    return writeAgentSessionDefaults(queryClient, record(), patch)
  }
  const continueAfterLimit = createSettingSave()
  const idleStop = createSettingSave()
  const archivedHistory = createSettingSave()
  const followLast = createSettingSave()
  const inlineProviderSave = createSettingSave()
  const foldSave = createSettingSave()
  const startup = createSettingSave()

  // A different store from everything above: the fold setting is this device's preference about how a
  // transcript is drawn, not part of the record the node keeps of what a session launches with.
  const fold = () => readAgentToolFoldPrefs(prefs.data)
  const chooseFold = (mode: AgentToolFoldMode) => void foldSave.run(() => saveAgentToolFoldMode(queryClient, prefs.data, mode))

  const choose = (providerId: string, optionId: string, value: string) => {
    const forProvider = { ...record().pinned[providerId] }
    if (value) forProvider[optionId] = value
    else delete forProvider[optionId]
    return save({ pinned: { ...record().pinned, [providerId]: forProvider } })
  }
  const inlineProvider = createMemo(() => record().inline.providerId ?? providers()?.find((provider) => provider.installed)?.id ?? '')
  const chooseInlineProvider = (providerId: string) =>
    void inlineProviderSave.run(() => save({ inline: { ...record().inline, providerId } }))
  const chooseInlineOption = (providerId: string, optionId: string, value: string) => {
    const current = { ...record().inline.pinned[providerId] }
    if (value) current[optionId] = value
    else delete current[optionId]
    return save({ inline: {
      ...record().inline,
      pinned: { ...record().inline.pinned, [providerId]: current },
    } })
  }

  return (
    <>
      <Show when={stored.error}>
        <Alert>
          {stored.error instanceof Error ? stored.error.message : 'Harnesses and defaults could not be loaded.'}
        </Alert>
      </Show>

      <SettingsSection
        id="harnesses"
        label="Harnesses"
        help="The agent command-line tools this computer can run. Plugins can add more."
      >
        <For each={providers() ?? []} fallback={<Text emphasis="muted">{providers.loading ? 'Loading harnesses…' : 'No harnesses on this node.'}</Text>}>
          {(provider) => (
            <SettingRow label={provider.label} description={harnessState(provider)}>
              <Inline>
                <ProviderGlyph glyph={provider.glyph} label={provider.label} />
                <Badge tone={provider.installed ? 'ok' : 'neutral'}>{provider.installed ? 'Installed' : 'Not installed'}</Badge>
              </Inline>
            </SettingRow>
          )}
        </For>
      </SettingsSection>

      <SettingsSection id="usage" label="Usage limits">
        <SettingRow
          label="Continue when usage resets"
          help="If an agent runs out of plan usage, acorn waits for the reset and then carries on."
          error={continueAfterLimit.error()}
        >
          <Checkbox
            switch
            ariaLabel="Continue when usage resets"
            checked={record().continueAfterUsageLimit}
            onChange={(checked) => continueAfterLimit.run(() => save({ continueAfterUsageLimit: checked }))}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="idle" label="Idle agents">
        <SettingRow
          label="Stop idle agents after"
          help="An idle agent can hold hundreds of megabytes. acorn stops it after this long, and your next message starts it again in the same conversation."
          error={idleStop.error()}
        >
          <Select
            label="Stop idle agents after"
            value={String(record().stopIdleAfterMinutes)}
            options={AGENT_IDLE_STOP_CHOICES.map((choice) => ({ value: String(choice.minutes), label: choice.label }))}
            onChange={(value) => void idleStop.run(() => save({ stopIdleAfterMinutes: Number(value) }))}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="archived" label="Archived tasks">
        <SettingRow
          label="Keep agent history for archived tasks"
          description="After this long, acorn deletes the agent history of archived tasks. You can't get it back."
          help="The task still lists its sessions, but the transcripts, attachments, and files are gone, and archive search no longer finds them."
          error={archivedHistory.error()}
        >
          <Select
            label="Keep agent history for archived tasks"
            value={String(record().keepArchivedHistoryDays)}
            options={AGENT_ARCHIVED_HISTORY_CHOICES.map((choice) => ({ value: String(choice.days), label: choice.label }))}
            onChange={(value) => void archivedHistory.run(() => save({ keepArchivedHistoryDays: Number(value) }))}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="new-sessions"
        label="New sessions"
        help="Each new session starts with these. To change a running session, use the pickers under its message box."
      >
        <SettingRow
          label="Carry my last session's settings forward"
          help="When on, a new session starts with the model and effort you last picked. Turn it off to always use the settings below."
          error={followLast.error()}
        >
          <Checkbox
            switch
            ariaLabel="Carry my last session's settings forward"
            checked={record().followLastSession}
            onChange={(checked) => followLast.run(() => save({ followLastSession: checked }))}
          />
        </SettingRow>
        <SettingRow
          label="Send task context at startup"
          description="The pull request, linked issues and notes, sent to an agent you start in the terminal drawer. On for new sessions only: one already running is not sent it again."
          error={startup.error()}
        >
          <Checkbox
            switch
            ariaLabel="Send task context at startup"
            checked={startupContextInjection(prefs.data)}
            onChange={(checked) => startup.run(() => saveStartupContextInjection(queryClient, checked))}
          />
        </SettingRow>
        <Show when={props.context}>
          {(context) => (
            <SettingRow
              label="MCP servers"
              description="A new session also starts with every server that is on for new sessions. To change an open session's list, type /mcp in its composer."
            >
              <Inline>
                <Link onPress={() => context().navigate('agent-mcp-servers')}>Open MCP servers</Link>
              </Inline>
            </SettingRow>
          )}
        </Show>
      </SettingsSection>

      <Show when={!record().followLastSession}>
        <For each={providers()?.filter((provider) => provider.installed) ?? []}>
          {(provider) => (
            <SettingsSection
              id={`pinned-${provider.id}`}
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
                <For each={advertised()[provider.id]}>
                  {(option) => {
                    const pin = createSettingSave()
                    return (
                      <SettingRow label={option.label} error={pin.error()}>
                        <Select
                          label={`${provider.label} ${option.label}`}
                          value={record().pinned[provider.id]?.[option.id] ?? ''}
                          options={[
                            { value: '', label: `Whatever ${provider.label} picks` },
                            ...option.values.map((value) => ({ value: value.value, label: value.label, title: value.description })),
                          ]}
                          onChange={(value) => void pin.run(() => choose(provider.id, option.id, value))}
                        />
                      </SettingRow>
                    )
                  }}
                </For>
              </Show>
            </SettingsSection>
          )}
        </For>
      </Show>

      <SettingsSection id="inline" label="Inline diff chats">
        <SettingRow label="Provider" error={inlineProviderSave.error()}>
          <Select label="Inline chat provider" value={inlineProvider()}
            options={(providers() ?? []).filter((provider) => provider.installed).map((provider) => ({ value: provider.id, label: provider.label }))}
            onChange={chooseInlineProvider} />
        </SettingRow>
        <For each={(advertised()[inlineProvider()] ?? []).filter((option) => option.category === 'model' || option.category === 'reasoning')}>
          {(option) => {
            const pin = createSettingSave()
            return (
              <SettingRow label={option.label} error={pin.error()}>
                <Select label={`Inline chat ${option.label}`}
                  value={record().inline.pinned[inlineProvider()]?.[option.id] ?? ''}
                  options={[{ value: '', label: 'Provider default' }, ...option.values.map((value) => ({ value: value.value, label: value.label }))]}
                  onChange={(value) => void pin.run(() => chooseInlineOption(inlineProvider(), option.id, value))} />
              </SettingRow>
            )
          }}
        </For>
      </SettingsSection>

      <SettingsSection id="transcript" label="Transcript">
        <SettingRow
          label="Tool call display"
          description="How a tool call's output starts out when it first appears, in every transcript this device draws."
          scope="device"
          error={foldSave.error()}
          // The default is what a transcript draws with nothing stored.
          onReset={fold().mode === defaultAgentToolFoldPrefs.mode ? undefined : () => chooseFold(defaultAgentToolFoldPrefs.mode)}
        >
          <Select
            label="Tool call display"
            value={fold().mode}
            onChange={(value) => chooseFold(value as AgentToolFoldMode)}
            options={[...AGENT_TOOL_FOLD_CHOICES]}
          />
        </SettingRow>
      </SettingsSection>
    </>
  )
}
