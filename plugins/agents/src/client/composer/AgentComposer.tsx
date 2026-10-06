import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js'
import type { AgentAttachment, AgentConfigOption, AgentSession } from '../../contract/wire.ts'
import { agentContextBudget, type AgentContextContribution, type AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import { AGENT_COMPOSER_ACTIONS_POINT } from '@acorn/protocol/extensionPoints.ts'
import { managedAgentApi } from '../sessions/managedClient'
import { activeNodeId, agentContextContributions, formatChord } from '@acorn/plugin-api/client'
import {
  Alert, Button, Chip, ChipRow, CodeBlock, Field, Icon, IconButton, Inline, Kbd, MentionTextarea, Only, Picker,
  Popover, SectionHeader, Select, Stack, Text, Toolbar, type MentionSegment, type MentionSource,
} from '@acorn/plugin-api/ui'
import { Slot } from '@acorn/plugin-api/ui/host'
import { consumeComposerFocus } from '../sessions/managedSelection'
import { composerDraftState, hydrateComposerDraft } from './composerState'
import { sameAgentConfigOptions } from '../settings/agentConfigOptions'
import { agentComposerDisabledMessage } from './agentComposerState'
import { canStopAgent } from '../sessions/agentActivity'
import { fileMentionSuggestions, formatFileMention } from './fileMentions'
import { advertisedSuggestions, composerSegments, MAX_HIGHLIGHT_LENGTH } from './composerTokens'
import { useWorktreeFiles } from './worktreeFiles'
import AgentContextPickerModal from './AgentContextPickerModal'
import { AttachmentSlot } from './AttachmentSlot'
import TerminalComposerShortcut from './TerminalComposerShortcut'
import { addDraftFiles, pickDraftAttachments, removeDraftAttachment, replaceDraftAttachment } from './attachmentOperations'
import { captureContext, contextBelongsTo, refreshAutomaticContext } from './contextOperations'
import { submitTurn } from './submitOperation'
import {
  AUTOMATIC_TASK_CONTEXT_SOURCE,
  TASK_CONTEXT_CONTRIBUTION_ID,
  automaticTaskContextPayload,
} from './automaticTaskContext'

type InsertChoice = {
  id: string
  label: string
  description?: string
  value: string
}

// The `footer` of the Agent pane's detail: what is going to be sent, and everything that can be
// added to it.
//
// The field is the kit's `MentionTextarea` (docs/ui-design/closed-kit.md § The closed kit): `@file`,
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
  /** Focus on navigation and answer explicit session selections. Only the Agent pane opts in,
   *  so another composer showing the same session cannot take its caret. */
  autoFocus?: boolean
  previousAutomaticContext?: AgentContextSnapshot
  /** Desktop controls for the transcript above, drawn beside the config selects. The terminal uses
   *  shortcuts instead. Owned by the conversation, which sees both transcript and composer. */
  viewControls?: JSX.Element
  /** Opens the session's MCP panel. Present, `/mcp` on its own is acorn's command and is never sent. */
  onMcp?: () => void
  onSent: () => void
  onSessionUpdated: (session: AgentSession) => void
}) {
  // The turn's own payload and the guards over sending it belong to the session, because a session can
  // be open in two panes and both draw a composer (./composerState.ts). Read through `shared()` on
  // every access rather than destructured once: `props.session.id` changes without a remount, and a
  // captured pair would go on writing the previous session's draft.
  //
  // `replacing` is the sharpest of them. It is the id of an attachment mid-swap, and submit is
  // disabled for the duration: the editor overlay normally covers the composer, but a turn must not be
  // able to enqueue an id that is being replaced, and correctness here cannot depend on what is on
  // top — or on which pane the reader happens to be looking at.
  const shared = createMemo(() => composerDraftState(props.session.id, activeNodeId()))
  const capture = () => {
    const state = shared()
    const session = props.session
    return { state, session, nodeId: state.nodeId,
      visible: () => state.valid() && shared() === state }
  }
  createEffect(() => onCleanup(shared().hold()))
  const attachments = () => shared().attachments()
  const contexts = () => shared().contexts()
  const setContexts = (next: AgentContextSnapshot[] | ((current: AgentContextSnapshot[]) => AgentContextSnapshot[])) =>
    shared().setContexts(next)
  const error = () => shared().error()
  const sending = () => shared().sending()
  const uploading = () => shared().uploading()
  const replacing = () => shared().replacing()
  // Picker visibility, height, and automatic-context dismissal belong to this surface. The guard
  // over context capture belongs to the shared draft, so another surface cannot send midway through it.
  const capturingContext = () => shared().capturing()
  const [contextPickerId, setContextPickerId] = createSignal('')
  const [dismissedAutomaticPayload, setDismissedAutomaticPayload] = createSignal<string>()
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
  const terminalOptions = createMemo(() => configOptions().filter((option) => option.category !== 'permission'))
  const commands = createMemo(() => {
    const value = props.session.config.commands
    const advertised = Array.isArray(value) ? value as Array<{ name: string; description?: string }> : []
    // acorn answers `/mcp` itself (../sessions/AgentMcpPanel.tsx), so it is offered to every harness and
    // described as what it does here. Claude Code advertises its own, which in a session like this
    // only prints a one-line count.
    return props.onMcp
      ? [{ name: 'mcp', description: 'Manage this session’s MCP servers' }, ...advertised.filter((command) => command.name !== 'mcp')]
      : advertised
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

  // Navigation mounts a composer or changes its session. A selection request also covers clicking
  // the session already on screen. Session metadata and streamed events must not move the caret.
  let field: HTMLTextAreaElement | undefined
  let focusedSessionId: string | undefined
  createEffect(() => {
    if (!props.autoFocus) { focusedSessionId = undefined; return }
    const id = composerSessionId()
    const requested = consumeComposerFocus(id)
    if (focusedSessionId === id && !requested) return
    focusedSessionId = id
    const target = field
    queueMicrotask(() => {
      if (target?.isConnected && !target.disabled && props.autoFocus && composerSessionId() === id)
        target.focus({ preventScroll: true })
    })
  })

  // Two halves, because they have two owners. This composer's view state resets on every mount that
  // sees a new session; the session's own draft is read back once, however many composers asked, since
  // the read fetches attachment metadata. A second mount still resets its own view state.
  let pickerTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(pickerTimer))
  createEffect(on(shared, (state) => {
    clearTimeout(pickerTimer)
    const owner = capture()
    setExpanded(false)
    setContextPickerId('')
    setDismissedAutomaticPayload(undefined)
    hydrateComposerDraft(state.sessionId, async () => {
      const revision = state.revisions()[1]
      const fork = owner.session.config.pendingForkContext
      if (fork && typeof fork === 'object' && (fork as { type?: unknown }).type === 'context') {
        state.preserveForkHydration()
        if (!state.contexts().length) state.setContexts([fork as AgentContextSnapshot])
      }
      if (state.attachmentIds().length === state.attachments().length
        && state.attachmentIds().every((id, index) => state.attachments()[index]?.id === id)) return
      const items = await Promise.all(state.attachmentIds().map((id) =>
        managedAgentApi.attachment(id, owner)))
      if (state.valid() && state.revisions()[1] === revision) {
        state.setAttachments(items.filter((item): item is AgentAttachment => item != null))
      }
    }, state)
  }))

  createEffect(on(() => [shared(), automaticContextKey()], () => {
    const owner = capture()
    if (owner.session.kind !== 'interactive') return
    void refreshAutomaticContext(owner, automaticContextKey(),
      props.previousAutomaticContext, dismissedAutomaticPayload()).catch((caught) => {
      owner.state.setError(caught instanceof Error ? caught.message : 'Unable to attach task context.')
    })
  }))
  const draft = () => shared().text()
  const setDraft = (value: string | ((current: string) => string)) => {
    shared().setText(typeof value === 'function' ? value(draft()) : value)
  }

  const effectivePolicy = (): Record<string, unknown> =>
    Object.fromEntries(configOptions().flatMap((option) =>
      option.currentValue == null ? [] : [[option.id === 'reasoning' ? 'effort' : option.id, option.currentValue]]))

  const nothingToSend = () => !draft().trim() && !attachments().length && !contexts().length

  async function send() {
    const owner = capture()
    const text = owner.state.text().trim()
    if (props.onMcp && /^\/mcp$/.test(text)) {
      props.onMcp()
      owner.state.setText('')
      return
    }
    if (nothingToSend() || !owner.state.hydrated() || owner.state.sending() || owner.state.uploading()
      || owner.state.capturing() || owner.state.replacing() || props.disabled || props.submitDisabled) return
    const automaticKey = automaticContextKey()
    const previousAutomaticContext = props.previousAutomaticContext
    const dismissedPayload = dismissedAutomaticPayload()
    await submitTurn({
      origin: owner,
      paths: files.paths(),
      policy: effectivePolicy(),
      refreshContext: () => refreshAutomaticContext(owner, automaticKey,
        previousAutomaticContext, dismissedPayload),
      onSent: props.onSent,
    })
  }

  // Escape in the composer, which is the same request as the header's Stop button and reaches the
  // same route. The draft is deliberately left alone: Escape is a reflex key, and a composer that
  // threw away typed text on it would lose work nothing can get back.
  async function stop() {
    if (!canStopAgent(props.session)) return
    const owner = capture()
    owner.state.setError('')
    try {
      await managedAgentApi.cancel(owner.session.id)
    } catch (caught) {
      owner.state.setError(caught instanceof Error ? caught.message : 'Unable to stop this agent.')
    }
  }

  async function updateOption(option: AgentConfigOption, value: string) {
    const owner = capture()
    const nextOptions = configOptions().map((item) =>
      item.id === option.id ? { ...item, currentValue: value } : item)
    try {
      const updated = await managedAgentApi.patch(owner.session.id, {
        config: { ...owner.session.config, configOptions: nextOptions },
      }, owner)
      if (owner.visible()) props.onSessionUpdated(updated)
    } catch (caught) {
      owner.state.setError(caught instanceof Error ? caught.message : 'Unable to update agent configuration.')
    }
  }

  const insert = (value: string) => {
    setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${value} `)
  }

  const attach = () => pickDraftAttachments(capture())
  const addFiles = (files: File[]) => addDraftFiles(capture(), files)
  const removeAttachment = (attachment: AgentAttachment) => removeDraftAttachment(capture(), attachment)
  const replaceAttachment = (expected: AgentAttachment, payload: unknown) =>
    replaceDraftAttachment(capture(), expected, payload)

  function removeContext(context: AgentContextSnapshot) {
    if (context.source === AUTOMATIC_TASK_CONTEXT_SOURCE) {
      setDismissedAutomaticPayload(automaticTaskContextPayload(context))
    }
    setContexts((current) => current.filter((item) => item.contextId !== context.contextId))
  }

  const selectedContextOptionIds = (contribution: AgentContextContribution): string[] =>
    contexts().flatMap((context) =>
      context.source === contribution.source && context.resourceId ? [context.resourceId] : [])

  const captureSelectedContext = (contributionId: string, optionIds: readonly string[]) =>
    captureContext(capture(), contributionId, optionIds, () => setContextPickerId(''))

  // Read when the field first takes focus, so the list is there by the time somebody types `@`. A
  // visit that never writes to the agent never pays for the worktree walk.
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
      : composerSegments(value, advertisedNames(), files.paths()).map((segment) => segment.token
        ? {
          text: segment.text,
          tone: TOKEN_TONE[segment.token.kind],
          tip: segment.token.kind === 'file' ? undefined : describe(segment.token.kind, segment.token.name),
          caret: segment.token.end,
        }
        : { text: segment.text })

  return (
    <Stack gap="row">
      <Only hosts={['tui']}>
        <TerminalComposerShortcut toggle={() => setExpanded((current) => !current)} />
      </Only>
      <Only hosts={['dom']}>
        <Show when={configOptions().length || props.viewControls}>
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
            <Show when={props.viewControls}>
              <Toolbar.Spacer />
              {props.viewControls}
            </Show>
          </Inline>
        </Show>
      </Only>
      <Only hosts={['tui']}>
        <Show when={terminalOptions().length}>
          <Inline wrap>
            <For each={terminalOptions()}>
              {(option) => (
                <Inline>
                  <Text emphasis="muted">{option.label}</Text>
                  <Select
                    label={option.label}
                    kind="bare"
                    size="sm"
                    width="auto"
                    value={option.currentValue ?? ''}
                    disabled={props.disabled || props.submitDisabled}
                    onChange={(value) => void updateOption(option, value)}
                    options={option.values.map((value) => ({ value: value.value, label: value.label, title: value.description }))}
                  />
                </Inline>
              )}
            </For>
          </Inline>
        </Show>
      </Only>

      <Show when={attachments().length || contexts().length}>
        <ChipRow ariaLabel="Attached to this turn">
          <For each={attachments()}>
            {(attachment) => (
              <AttachmentSlot
                attachment={attachment}
                taskId={props.session.taskId}
                sessionId={props.session.id}
                onRemove={() => {
                  // Refused while this one is being swapped, for the same reason Submit is: the
                  // compare-and-swap is holding this slot.
                  if (replacing() === attachment.id) return
                  removeAttachment(attachment)
                }}
                onReplace={(payload) => replaceAttachment(attachment, payload)}
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
        ref={(element) => { field = element }}
        label="Message agent"
        value={draft()}
        disabled={props.disabled}
        placeholder={disabledMessage() ?? 'Ask the agent…  @file  /command  $skill'}
        rows={expanded() ? 18 : 3}
        sources={sources()}
        segments={segments}
        onInput={setDraft}
        onFocus={files.want}
        onFiles={addFiles}
        onSubmit={() => void send()}
        onCancel={canStopAgent(props.session) ? () => void stop() : undefined}
        onToggleExpand={() => setExpanded((current) => !current)}
        overlay={
          <Only hosts={['dom']}>
            <IconButton
              icon={expanded() ? 'minimize-2' : 'maximize-2'}
              label={expanded() ? 'Collapse the message box' : 'Expand the message box'}
              pressed={expanded()}
              tip={expanded() ? 'Collapse' : 'Expand'}
              tipKey={formatChord('meta+shift+enter')}
              onPress={() => setExpanded((current) => !current)}
            />
          </Only>
        }
      />

      <Toolbar variant="actions" size="sm">
        <Button
          size="sm"
          title="Attach files"
          disabled={uploading() || props.disabled}
          busy={uploading()}
          onPress={() => void attach()}
        >
          Attach
        </Button>
        <Picker<AgentContextContribution>
          label="Context"
          ariaLabel="Add Acorn context"
          size="sm"
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
            //
            // Bare, not `window.setTimeout`: the terminal host defines `window` as an object holding
            // `acorn` and nothing else, on the grounds that a `window` answering every question is
            // worse than none (docs/tui/host-switch.md § Booting client-core under Node). Reaching through it
            // threw a TypeError out of a keymap handler and this row did nothing there. The global is
            // the same function on both hosts, and only the DOM has the delegation this defers past.
            clearTimeout(pickerTimer)
            const owner = capture()
            pickerTimer = setTimeout(() => { if (owner.visible()) setContextPickerId(contribution.id) }, 0)
          }}
          disabled={props.disabled}
          placement="top-start"
        />
        <Picker<InsertChoice>
          label="Insert"
          ariaLabel="Insert provider command or skill"
          size="sm"
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
            <Stack gap="row">
              <SectionHeader level="group">Sent context</SectionHeader>
              <CodeBlock wrap maxHeight="block">
                {contexts().map((context) => `## ${context.label}\n${context.content}`).join('\n\n')}
              </CodeBlock>
            </Stack>
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
        <Text emphasis="muted"><Kbd size="xs">{formatChord('shift+enter')}</Kbd> for newline</Text>
        <Button
          variant="solid"
          tone="accent"
          size="sm"
          busy={sending()}
          title={props.submitDisabled ? 'Wait for the agent to finish connecting.' : undefined}
          disabled={nothingToSend() || !shared().hydrated() || uploading() || !!capturingContext() || !!replacing() || contextBudget().overLimit || props.disabled || props.submitDisabled}
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
            onAttach={(optionIds) => void captureSelectedContext(contribution().id, optionIds)}
            onClose={() => setContextPickerId('')}
          />
        )}
      </Show>
    </Stack>
  )
}
