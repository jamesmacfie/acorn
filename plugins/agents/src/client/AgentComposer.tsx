import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import type { AgentAttachment, AgentConfigOption, AgentInputPart, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { agentContextBudget, type AgentContextContribution, type AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import { AGENT_COMPOSER_ACTIONS_POINT } from '@acorn/protocol/extensionPoints.ts'
import { managedAgentApi } from './managedClient'
import { agentContextContributions } from '@acorn/plugin-api/client'
import {
  Alert, Button, Chip, ChipRow, CodeBlock, Field, Icon, Inline, Kbd, MentionTextarea, Picker,
  Popover, Select, Stack, Text, Toolbar,
  type MentionSegment, type MentionSource,
} from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import { hydrateManagedDraft, managedDraft, setManagedDraft } from './managedDrafts'
import { sameAgentConfigOptions } from './agentConfigOptions'
import { agentComposerDisabledMessage } from './agentComposerState'
import { canStopAgent } from './agentActivity'
import { fileMentionSuggestions, formatFileMention, parseFileMentions } from './fileMentions'
import { advertisedSuggestions, composerSegments, MAX_HIGHLIGHT_LENGTH } from './composerTokens'
import { useWorktreeFiles } from './worktreeFiles'
import AgentContextPickerModal from './AgentContextPickerModal'
import { AttachmentSlot } from './AttachmentSlot'
import {
  AUTOMATIC_TASK_CONTEXT_SOURCE,
  TASK_CONTEXT_CONTRIBUTION_ID,
  automaticTaskContextFor,
  automaticTaskContextPayload,
} from './automaticTaskContext'

const draftKey = (sessionId: string): string => `acorn.agent-draft.${sessionId}`
const attachmentDraftKey = (sessionId: string): string => `acorn.agent-attachments.${sessionId}`
const contextDraftKey = (sessionId: string): string => `acorn.agent-context.${sessionId}`

type InsertChoice = {
  id: string
  label: string
  description?: string
  value: string
}

// The `footer` of the Agent pane's detail: what is going to be sent, and everything that can be
// added to it.
//
// The field is the kit's `MentionTextarea` (docs/ui-design.md § The closed kit): `@file`,
// `/command` and `$skill` are three `sources`, and the colour behind the text is `segments`. What
// this file still owns is what those three mean here — the worktree walk, the commands the session
// advertised, and which spans of the draft the turn will actually send as file parts.
//
// A colour per kind, so a path does not read as a command.
const TOKEN_TONE = { file: 'accent', command: 'warn', skill: 'ok' } as const

export default function AgentComposer(props: {
  session: AgentSession
  disabled?: boolean
  /** Startup keeps the draft editable, but cannot accept a turn until metadata and defaults settle. */
  submitDisabled?: boolean
  previousAutomaticContext?: AgentContextSnapshot
  onSent: () => void
  onSessionUpdated: (session: AgentSession) => void
}) {
  const [sending, setSending] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [attachments, setAttachments] = createSignal<AgentAttachment[]>([])
  const [contexts, setContexts] = createSignal<AgentContextSnapshot[]>([])
  const [capturingContext, setCapturingContext] = createSignal('')
  const [contextPickerId, setContextPickerId] = createSignal('')
  const [dismissedAutomaticPayload, setDismissedAutomaticPayload] = createSignal<string>()
  const [error, setError] = createSignal('')
  // Session-only, like the terminal drawer's own maximise: a composer that stayed tall across a
  // relaunch would hide the transcript of a session nobody had started typing into yet.
  const [expanded, setExpanded] = createSignal(false)
  const composerSessionId = createMemo(() => props.session.id)
  const configOptions = createMemo<AgentConfigOption[]>(
    () => {
      const value = props.session.config.configOptions
      return Array.isArray(value) ? value as AgentConfigOption[] : []
    },
    [],
    { equals: sameAgentConfigOptions },
  )
  const commands = createMemo(() => {
    const value = props.session.config.commands
    return Array.isArray(value) ? value as Array<{ name: string; description?: string }> : []
  })
  const skills = createMemo(() => {
    const value = props.session.config.skills
    return Array.isArray(value) ? value as Array<{ name: string; description?: string }> : []
  })
  const insertChoices = createMemo<InsertChoice[]>(() => [
    ...commands().map((command) => ({
      id: `command:${command.name}`,
      label: `/${command.name}`,
      description: command.description,
      value: `/${command.name}`,
    })),
    ...skills().map((skill) => ({
      id: `skill:${skill.name}`,
      label: `$${skill.name}`,
      description: skill.description,
      value: `$${skill.name}`,
    })),
  ])
  const contextBudget = createMemo(() => agentContextBudget(contexts()))
  const disabledMessage = createMemo(() => agentComposerDisabledMessage(props.session, props.disabled))
  const contextPicker = createMemo(() =>
    agentContextContributions().find((contribution) => contribution.id === contextPickerId()))
  const taskContextAdded = createMemo(() => contexts().some((context) =>
    context.source === AUTOMATIC_TASK_CONTEXT_SOURCE || context.source === 'context.task'))
  const automaticContextKey = createMemo(() => {
    const contribution = agentContextContributions()
      .find((item) => item.id === TASK_CONTEXT_CONTRIBUTION_ID)
    const revision = contribution?.revision?.({ taskId: props.session.taskId }) ?? 0
    return [
      props.session.id,
      props.session.taskId,
      props.session.kind,
      contribution?.id ?? 'unavailable',
      revision,
      props.previousAutomaticContext?.contextId ?? 'none',
    ].join(':')
  })

  createEffect(on(composerSessionId, (sessionId) => {
    hydrateManagedDraft(sessionId, localStorage.getItem(draftKey(sessionId)) ?? '')
    setError('')
    setExpanded(false)
    setContextPickerId('')
    setDismissedAutomaticPayload(undefined)
    let ids: string[] = []
    try {
      const value = JSON.parse(localStorage.getItem(attachmentDraftKey(sessionId)) ?? '[]') as unknown
      if (Array.isArray(value)) ids = value.filter((item): item is string => typeof item === 'string')
    } catch {
      ids = []
    }
    try {
      const stored = JSON.parse(localStorage.getItem(contextDraftKey(sessionId)) ?? '[]') as unknown
      const restored = Array.isArray(stored)
        ? stored.filter((item): item is AgentContextSnapshot =>
            typeof item === 'object' && item != null && (item as { type?: unknown }).type === 'context')
        : []
      const forkContext = props.session.config.pendingForkContext
      setContexts(restored.length
        ? restored
        : forkContext && typeof forkContext === 'object'
          && (forkContext as { type?: unknown }).type === 'context'
          ? [forkContext as AgentContextSnapshot]
          : [])
    } catch {
      setContexts([])
      if (props.session.config.pendingForkContext) {
        const { pendingForkContext: _sent, ...config } = props.session.config
        void managedAgentApi.patch(props.session.id, { config })
          .then(props.onSessionUpdated)
          .catch(() => undefined)
      }
    }
    void Promise.all(ids.map((id) => managedAgentApi.attachment(id).catch(() => null)))
      .then((items) => setAttachments(items.filter((item): item is AgentAttachment => item != null)))
  }))

  let automaticCaptureVersion = 0
  createEffect(on(automaticContextKey, () => {
    const sessionId = props.session.id
    if (props.session.kind !== 'interactive') return
    void refreshAutomaticContext().catch((caught) => {
      if (props.session.id !== sessionId) return
      setError(caught instanceof Error ? caught.message : 'Unable to attach task context.')
    })
  }))
  const draft = () => managedDraft(props.session.id)
  const setDraft = (value: string | ((current: string) => string)) => {
    const next = typeof value === 'function' ? value(draft()) : value
    setManagedDraft(props.session.id, next)
  }
  createEffect(() => localStorage.setItem(draftKey(props.session.id), draft()))
  createEffect(() => localStorage.setItem(
    attachmentDraftKey(props.session.id),
    JSON.stringify(attachments().map((attachment) => attachment.id)),
  ))
  createEffect(() => {
    try {
      localStorage.setItem(contextDraftKey(props.session.id), JSON.stringify(contexts()))
    } catch {
      // A captured context can exceed localStorage. The immutable copy still persists with the turn;
      // this only means the unsent draft cannot survive a reload.
    }
  })

  const effectivePolicy = (): Record<string, unknown> =>
    Object.fromEntries(configOptions().flatMap((option) =>
      option.currentValue == null ? [] : [[option.id === 'reasoning' ? 'effort' : option.id, option.currentValue]]))

  async function refreshAutomaticContext(): Promise<AgentContextSnapshot[]> {
    if (props.session.kind !== 'interactive') return contexts()
    // A manually selected task-context snapshot is authoritative for this draft. Do not add a
    // second automatic copy on send or when the Context pane revision changes underneath it.
    if (contexts().some((context) => context.source === 'context.task')) return contexts()
    const contribution = agentContextContributions()
      .find((item) => item.id === TASK_CONTEXT_CONTRIBUTION_ID)
    if (!contribution) return contexts()
    const sessionId = props.session.id
    const captureVersion = ++automaticCaptureVersion
    const captured = (await contribution.capture({ taskId: props.session.taskId }))[0]
    if (!captured || props.session.id !== sessionId || captureVersion !== automaticCaptureVersion) return contexts()
    const automatic = automaticTaskContextFor(captured, props.previousAutomaticContext)
    const next = contexts().filter((context) => context.source !== AUTOMATIC_TASK_CONTEXT_SOURCE)
    if (automatic && automaticTaskContextPayload(automatic) !== dismissedAutomaticPayload()) next.push(automatic)
    setContexts(next)
    return next
  }

  const nothingToSend = () => !draft().trim() && !attachments().length && !contexts().length

  async function send() {
    const text = draft().trim()
    if (nothingToSend() || sending() || props.disabled || props.submitDisabled) return
    setSending(true)
    setError('')
    try {
      const turnContexts = await refreshAutomaticContext()
      if (agentContextBudget(turnContexts).overLimit) {
        setError('Remove some context before sending; Acorn snapshots are limited to 512 KiB per turn.')
        return
      }
      const input: AgentInputPart[] = [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...parseFileMentions(text),
        ...attachments().map((attachment): AgentInputPart => attachment.mediaType.startsWith('image/')
          ? { type: 'image', attachmentId: attachment.id, alt: attachment.filename }
          : { type: 'attachment', attachmentId: attachment.id }),
        ...turnContexts,
      ]
      await managedAgentApi.enqueue(props.session.id, {
        input,
        source: 'interactive',
        effectivePolicy: effectivePolicy(),
      })
      setDraft('')
      setAttachments([])
      setContexts([])
      localStorage.removeItem(draftKey(props.session.id))
      localStorage.removeItem(attachmentDraftKey(props.session.id))
      localStorage.removeItem(contextDraftKey(props.session.id))
      props.onSent()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to queue this turn.')
    } finally {
      setSending(false)
    }
  }

  // Escape in the composer, which is the same request as the header's Stop button and reaches the
  // same route. The draft is deliberately left alone: Escape is a reflex key, and a composer that
  // threw away typed text on it would lose work nothing can get back.
  async function stop() {
    if (!canStopAgent(props.session)) return
    setError('')
    try {
      await managedAgentApi.cancel(props.session.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to stop this agent.')
    }
  }

  async function updateOption(option: AgentConfigOption, value: string) {
    const nextOptions = configOptions().map((item) =>
      item.id === option.id ? { ...item, currentValue: value } : item)
    try {
      props.onSessionUpdated(await managedAgentApi.patch(props.session.id, {
        config: { ...props.session.config, configOptions: nextOptions },
      }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update agent configuration.')
    }
  }

  const insert = (value: string) => {
    setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${value} `)
  }

  async function addFiles(files: File[]) {
    if (!files.length || uploading()) return
    if (attachments().length + files.length > 8) {
      setError('A turn can include at most eight attachments.')
      return
    }
    const aggregate = attachments().reduce((total, item) => total + item.byteSize, 0)
      + files.reduce((total, file) => total + file.size, 0)
    if (aggregate > 25 * 1024 * 1024) {
      setError('Turn attachments are limited to 25 MiB in total.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const uploaded = await Promise.all(files.map((file) => managedAgentApi.uploadAttachment(props.session.taskId, file)))
      setAttachments((current) => [...current, ...uploaded.filter((item) => !current.some((existing) => existing.id === item.id))])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to upload attachment.')
    } finally {
      setUploading(false)
    }
  }

  function removeAttachment(attachment: AgentAttachment) {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    void managedAgentApi.removeAttachment(attachment.id).catch(() => undefined)
  }

  function removeContext(context: AgentContextSnapshot) {
    if (context.source === AUTOMATIC_TASK_CONTEXT_SOURCE) {
      setDismissedAutomaticPayload(automaticTaskContextPayload(context))
    }
    setContexts((current) => current.filter((item) => item.contextId !== context.contextId))
  }

  const contextBelongsTo = (
    context: AgentContextSnapshot,
    contribution: AgentContextContribution,
  ): boolean =>
    context.source === contribution.source
      || (contribution.id === TASK_CONTEXT_CONTRIBUTION_ID
        && context.source === AUTOMATIC_TASK_CONTEXT_SOURCE)

  const selectedContextOptionIds = (contribution: AgentContextContribution): string[] =>
    contexts().flatMap((context) =>
      context.source === contribution.source && context.resourceId ? [context.resourceId] : [])

  async function captureContext(contributionId: string, optionIds: readonly string[]) {
    const contribution = agentContextContributions().find((item) => item.id === contributionId)
    if (!contribution || capturingContext()) return
    setCapturingContext(contributionId)
    setError('')
    try {
      const captured = await contribution.capture({ taskId: props.session.taskId }, optionIds)
      setContexts((current) => [
        ...current.filter((item) => !contextBelongsTo(item, contribution)),
        ...captured,
      ])
      setContextPickerId('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to capture Acorn context.')
    } finally {
      setCapturingContext('')
    }
  }

  // Only fetched once something asks for a file. A session whose composer never types `@` never pays
  // for the worktree walk.
  const files = useWorktreeFiles(() => props.session.taskId)
  const advertised = (sigil: '/' | '$', items: readonly { name: string; description?: string }[], query: string) =>
    advertisedSuggestions(items, query).map((item) => ({
      value: `${sigil}${item.name}`,
      label: `${sigil}${item.name}`,
      detail: item.description,
    }))
  const sources = createMemo<MentionSource[]>(() => [
    {
      sigil: '@',
      label: 'Worktree files',
      emptyText: 'No matching files.',
      loading: files.loading(),
      error: files.error() ? 'Unable to load worktree files.' : undefined,
      suggest: (query) => fileMentionSuggestions(files.paths(), query).map((path) => {
        const slash = path.lastIndexOf('/')
        return {
          value: formatFileMention(path),
          label: slash < 0 ? path : path.slice(slash + 1),
          detail: slash < 0 ? undefined : path.slice(0, slash),
        }
      }),
    },
    {
      sigil: '/',
      label: 'Provider commands',
      emptyText: 'No matching commands.',
      suggest: (query) => advertised('/', commands(), query),
    },
    {
      sigil: '$',
      label: 'Provider skills',
      emptyText: 'No matching skills.',
      suggest: (query) => advertised('$', skills(), query),
    },
  ])
  const advertisedNames = createMemo(() => ({
    commands: commands().map((command) => command.name),
    skills: skills().map((skill) => skill.name),
  }))
  const describe = (kind: 'command' | 'skill', name: string) =>
    (kind === 'command' ? commands() : skills()).find((item) => item.name === name)?.description
  // Above the cap the mirror is dropped and the field paints its own text again: a pasted stack trace
  // is still a draft somebody has to be able to type into.
  const segments = (value: string): MentionSegment[] | null =>
    value.length > MAX_HIGHLIGHT_LENGTH
      ? null
      : composerSegments(value, advertisedNames()).map((segment) => segment.token
        ? {
          text: segment.text,
          tone: TOKEN_TONE[segment.token.kind],
          tip: segment.token.kind === 'file' ? undefined : describe(segment.token.kind, segment.token.name),
          caret: segment.token.end,
        }
        : { text: segment.text })

  let fileInput: HTMLInputElement | undefined

  return (
    <Stack gap="row">
      <Show when={configOptions().length}>
        <Inline wrap>
          <For each={configOptions()}>
            {(option) => (
              <Field label={option.label} layout="row">
                <Select
                  label={option.label}
                  size="sm"
                  width="auto"
                  value={option.currentValue ?? ''}
                  disabled={props.disabled || props.submitDisabled}
                  onChange={(value) => void updateOption(option, value)}
                  options={option.values.map((value) => ({ value: value.value, label: value.label, title: value.description }))}
                />
              </Field>
            )}
          </For>
        </Inline>
      </Show>

      {/* `hidden`, not a class: the picker is the Attach button and this element only exists to open
          the platform's file dialog. */}
      <input
        ref={fileInput}
        hidden
        type="file"
        multiple
        accept=".txt,.md,.json,.yaml,.yml,.toml,.xml,.csv,.ts,.tsx,.js,.jsx,.css,.html,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.hpp,.swift,.sh,.sql,.diff,.patch,image/jpeg,image/png,image/gif,image/webp,application/pdf"
        onChange={(event) => {
          void addFiles([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ''
        }}
      />

      <Show when={attachments().length || contexts().length}>
        <ChipRow ariaLabel="Attached to this turn">
          <For each={attachments()}>
            {(attachment) => (
              <AttachmentSlot
                attachment={attachment}
                taskId={props.session.taskId}
                onRemove={() => removeAttachment(attachment)}
              />
            )}
          </For>
          <For each={contexts()}>
            {(context) => (
              <Chip
                title={context.provenance}
                leading={<Icon name="diamond" />}
                onRemove={() => removeContext(context)}
              >
                {context.label} · ~{(context.estimatedTokens ?? Math.ceil((context.byteSize ?? context.content.length) / 4)).toLocaleString()} tok
              </Chip>
            )}
          </For>
        </ChipRow>
      </Show>
      <Show when={contexts().find((context) => context.source === AUTOMATIC_TASK_CONTEXT_SOURCE)}>
        {(context) => (
          <Text emphasis="muted" wrap>
            {context().label.endsWith('updated')
              ? 'Context changed since it was last sent. The refreshed snapshot will be attached to this turn.'
              : 'Acorn attached the task’s selected Context-pane information to the first turn.'}
          </Text>
        )}
      </Show>

      <MentionTextarea
        label="Message agent"
        value={draft()}
        disabled={props.disabled}
        placeholder={disabledMessage() ?? 'Ask the agent…  @file  /command  $skill'}
        rows={expanded() ? 18 : 3}
        sources={sources()}
        segments={segments}
        onInput={setDraft}
        onFiles={(dropped) => void addFiles(dropped)}
        onSubmit={() => void send()}
        onCancel={canStopAgent(props.session) ? () => void stop() : undefined}
        onKeyDown={(event) => {
          // The shell's own meta+shift+enter maximises the focused pane, and its dispatcher skips a
          // typing target for anything but a global binding, so the chord is unclaimed in here. Same
          // fingers, nearest meaning: the surface you are typing in grows.
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Enter') {
            event.preventDefault()
            setExpanded((current) => !current)
          }
        }}
        overlay={
          <Button
            variant="bare"
            size="sm"
            iconOnly
            label={expanded() ? 'Collapse the message box' : 'Expand the message box'}
            pressed={expanded()}
            tip={expanded() ? 'Collapse' : 'Expand'}
            tipKey="⌘⇧↩"
            onPress={() => setExpanded((current) => !current)}
          >
            <Icon name={expanded() ? 'minimize-2' : 'maximize-2'} size={12} />
          </Button>
        }
      />

      <Toolbar variant="actions" size="sm">
        <Button
          size="sm"
          title="Attach files"
          disabled={uploading() || props.disabled}
          busy={uploading()}
          onPress={() => fileInput?.click()}
        >
          Attach
        </Button>
        <Picker<AgentContextContribution>
          label="Context"
          ariaLabel="Add Acorn context"
          placeholder="Filter context sources…"
          emptyText="No context sources available."
          results={(query) => agentContextContributions().filter((contribution) =>
            contribution.label.toLowerCase().includes(query.trim().toLowerCase()))}
          rowLabel={(contribution) => contribution.label}
          rowDescription={(contribution) => contribution.description}
          isActive={(contribution) => contexts().some((context) => contextBelongsTo(context, contribution))}
          isDisabled={(contribution) =>
            !!capturingContext()
              || (contribution.id === TASK_CONTEXT_CONTRIBUTION_ID && taskContextAdded())}
          onSelect={(contribution) => {
            // Solid delegates click handlers at the document. Mounting a backdrop synchronously
            // lets the selecting click reach the new backdrop and dismiss the modal immediately.
            window.setTimeout(() => setContextPickerId(contribution.id), 0)
          }}
          disabled={props.disabled}
          placement="top-start"
        />
        <Picker<InsertChoice>
          label="Insert"
          ariaLabel="Insert provider command or skill"
          placeholder="Filter commands and skills…"
          emptyText="No commands or skills advertised."
          results={(query) => insertChoices().filter((choice) =>
            `${choice.label} ${choice.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))}
          rowLabel={(choice) => choice.label}
          rowDescription={(choice) => choice.description}
          isActive={() => false}
          onSelect={(choice) => insert(choice.value)}
          disabled={props.disabled}
          placement="top-start"
        />
        <Show when={contexts().length}>
          {/* Was a <details> with an absolutely-positioned <pre>, which the composer's own overflow
              clipped. Popover portals it and adds Escape + outside-click. */}
          <Popover
            placement="top-start"
            ariaLabel="Sent context preview"
            role="dialog"
            trigger={({ toggle, open }) => (
              <Button variant="bare" size="sm" expanded={open()} onPress={toggle}>
                Preview sent context · ~{contextBudget().estimatedTokens.toLocaleString()} tokens · {(contextBudget().bytes / 1024).toFixed(1)} KiB
              </Button>
            )}
          >
            <CodeBlock wrap maxHeight="block">
              {contexts().map((context) => `## ${context.label}\n${context.content}`).join('\n\n')}
            </CodeBlock>
          </Popover>
        </Show>
        {/* Room for another plugin beside this pane's own controls. A `stack` point: several plugins
            with something to offer a draft is a real answer, and four is the owner's ceiling because
            it is the owner's bar. */}
        <Slot
          point={AGENT_COMPOSER_ACTIONS_POINT}
          taskId={props.session.taskId}
          props={() => ({ taskId: props.session.taskId, sessionId: props.session.id })}
        />
        <Toolbar.Spacer />
        <Text emphasis="muted"><Kbd size="xs">Shift+Enter</Kbd> for newline</Text>
        <Button
          variant="solid"
          tone="accent"
          size="sm"
          busy={sending()}
          title={props.submitDisabled ? 'Wait for the agent to finish connecting.' : undefined}
          disabled={nothingToSend() || contextBudget().overLimit || props.disabled || props.submitDisabled}
          onPress={() => void send()}
        >
          Send
        </Button>
      </Toolbar>

      <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <Show when={contextPicker()}>
        {(contribution) => (
          <AgentContextPickerModal
            contribution={contribution()}
            taskId={props.session.taskId}
            initialSelectedIds={selectedContextOptionIds(contribution())}
            attaching={capturingContext() === contribution().id}
            onAttach={(optionIds) => void captureContext(contribution().id, optionIds)}
            onClose={() => setContextPickerId('')}
          />
        )}
      </Show>
    </Stack>
  )
}
