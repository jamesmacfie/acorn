import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from 'solid-js'
import type { AgentAttachment, AgentConfigOption, AgentInputPart, AgentSession } from '../../contract/wire.ts'
import { agentContextBudget, type AgentContextContribution, type AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import { AGENT_COMPOSER_ACTIONS_POINT } from '@acorn/protocol/extensionPoints.ts'
import { managedAgentApi } from '../sessions/managedClient'
import { activeNodeId, agentContextContributions, formatChord, pickFiles } from '@acorn/plugin-api/client'
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
import { fileMentionSuggestions, formatFileMention, parseFileMentions } from './fileMentions'
import { advertisedSuggestions, composerSegments, MAX_HIGHLIGHT_LENGTH } from './composerTokens'
import { useWorktreeFiles } from './worktreeFiles'
import AgentContextPickerModal from './AgentContextPickerModal'
import { AttachmentSlot } from './AttachmentSlot'
import TerminalComposerShortcut from './TerminalComposerShortcut'
import { decideReplacement } from './replaceAttachment'
import {
  AUTOMATIC_TASK_CONTEXT_SOURCE,
  TASK_CONTEXT_CONTRIBUTION_ID,
  automaticTaskContextFor,
  automaticTaskContextPayload,
} from './automaticTaskContext'

// What the attach dialog offers, as bare extensions because that is what the platform seam takes.
// Text the harnesses read, plus the image and document types they can look at.
const ATTACHMENT_EXTENSIONS = [
  'txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv', 'ts', 'tsx', 'js', 'jsx', 'css', 'html',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'swift', 'sh', 'sql', 'diff', 'patch',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf',
]

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
  createEffect(on(shared, (state) => {
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
    void refreshAutomaticContext(owner).catch((caught) => {
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

  async function refreshAutomaticContext(owner = capture()): Promise<AgentContextSnapshot[]> {
    const { state, session } = owner
    const key = automaticContextKey()
    if (state.automaticCapture?.key === key) return state.automaticCapture.run
    const run = (async () => {
      const before = state.contexts()
      if (state.capturing()) return before
      if (session.kind !== 'interactive' || before.some((context) => context.source === 'context.task')) return before
      const contribution = agentContextContributions().find((item) => item.id === TASK_CONTEXT_CONTRIBUTION_ID)
      if (!contribution) return before
      const revision = state.revisions()[2]
      const captureVersion = state.captureRevision()
      const previous = props.previousAutomaticContext
      const dismissed = dismissedAutomaticPayload()
      const captured = (await contribution.capture({ taskId: session.taskId }))[0]
      if (!captured || activeNodeId() !== owner.nodeId || !state.captureCurrent(captureVersion)
        || state.revisions()[2] !== revision) return before
      const automatic = automaticTaskContextFor(captured, previous)
      const next = before.filter((context) => context.source !== AUTOMATIC_TASK_CONTEXT_SOURCE)
      if (automatic && automaticTaskContextPayload(automatic) !== dismissed) next.push(automatic)
      state.setContexts(next)
      return next
    })().finally(() => { if (state.automaticCapture?.run === run) state.automaticCapture = undefined })
    state.automaticCapture = { key, run }
    return run
  }

  const nothingToSend = () => !draft().trim() && !attachments().length && !contexts().length

  async function send() {
    const owner = capture()
    const { state, session } = owner
    const text = state.text().trim()
    if (props.onMcp && /^\/mcp$/.test(text)) {
      props.onMcp()
      state.setText('')
      return
    }
    if (nothingToSend() || !shared().hydrated() || sending() || uploading() || capturingContext() || replacing() || props.disabled || props.submitDisabled) return
    const revisions = [...state.revisions()]
    const submittedAttachments = state.attachments()
    const paths = files.paths()
    const policy = effectivePolicy()
    state.setSending(true)
    state.setError('')
    try {
      const turnContexts = await refreshAutomaticContext(owner)
      if (!state.valid()) return
      // Context refreshed by this send is acknowledged only if no concurrent edit replaced it.
      if (state.contexts() === turnContexts) revisions[2] = state.revisions()[2]
      if (agentContextBudget(turnContexts).overLimit) {
        state.setError('Remove some context before sending; Acorn snapshots are limited to 512 KiB per turn.')
        return
      }
      const input: AgentInputPart[] = [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...parseFileMentions(text, paths),
        ...submittedAttachments.map((attachment): AgentInputPart => attachment.mediaType.startsWith('image/')
          ? { type: 'image', attachmentId: attachment.id, alt: attachment.filename }
          : { type: 'attachment', attachmentId: attachment.id }),
        ...turnContexts,
      ]
      await managedAgentApi.enqueue(session.id, { input, source: 'interactive', effectivePolicy: policy }, undefined, owner)
      state.acknowledge(revisions, submittedAttachments, turnContexts)
      if (owner.visible()) props.onSent()
    } catch (caught) {
      state.setError(caught instanceof Error ? caught.message : 'Unable to queue this turn.')
    } finally {
      state.setSending(false)
    }
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

  // The dialog is the platform's, not the page's, so what comes back is bytes. `File` is the shape
  // the drop and paste path already hands `addFiles` through the kit's `onFiles`, and the upload
  // reads its bytes back out, so the two paths meet here rather than one layer down.
  async function attach() {
    const owner = capture()
    if (owner.state.uploading()) return
    owner.state.setUploading(true)
    try {
      const picked = await pickFiles({ accept: ATTACHMENT_EXTENSIONS })
      await addFiles(picked.map((file) => new File([file.bytes as BlobPart], file.name, { type: file.type })), owner, true)
    } catch (caught) {
      owner.state.setError(caught instanceof Error ? caught.message : 'Unable to upload attachment.')
    } finally { owner.state.setUploading(false) }
  }

  async function addFiles(files: File[], owner = capture(), picking = false) {
    const { state, session } = owner
    if (!state.valid() || !files.length || (!picking && state.uploading())) return
    state.setUploading(true)
    state.setError('')
    try {
      await state.hydration
      if (!state.hydrated() || !state.valid()) return
      if (state.attachments().length + files.length > 8) {
        state.setError('A turn can include at most eight attachments.')
        return
      }
      const aggregate = state.attachments().reduce((total, item) => total + item.byteSize, 0)
        + files.reduce((total, file) => total + file.size, 0)
      if (aggregate > 25 * 1024 * 1024) {
        state.setError('Turn attachments are limited to 25 MiB in total.')
        return
      }
      // Preserve each successful upload even when a sibling file fails.
      const uploaded = await Promise.allSettled(files.map((file) => managedAgentApi.uploadAttachment(session.taskId, file, owner)))
      state.setAttachments((current) => [...current, ...uploaded.flatMap(result =>
        result.status === 'fulfilled' && !current.some(item => item.id === result.value.id) ? [result.value] : [])])
      if (uploaded.some(result => result.status === 'rejected')) state.setError('Unable to upload attachment.')
    } catch (caught) {
      state.setError(caught instanceof Error ? caught.message : 'Unable to upload attachment.')
    } finally { state.setUploading(false) }
  }

  function removeAttachment(attachment: AgentAttachment) {
    const owner = capture()
    owner.state.setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    void managedAgentApi.removeAttachment(attachment.id, owner).catch(() => undefined)
  }

  /**
   * A contributor asking this composer to put a different attachment in one slot
   * (docs/plugins.md § Asking the owner; docs/managed-agents.md § Draft attachments).
   *
   * A compare-and-swap, because there is no transaction to be had. The draft is an array in this
   * component and the replacement is a row on the node, so "atomic" here can only mean: either the id
   * we were told to expect is still in that slot and it is replaced once, or nothing changes at all. A
   * reader who removed the attachment, sent the turn, or switched sessions while an editor was open
   * gets the second.
   *
   * The order at the end is load-bearing. The new id is written to the draft before the old one is
   * cleaned up, so a crash in between leaves an extra unreferenced row for the garbage collector rather
   * than a draft pointing at content that has been deleted.
   */
  async function replaceDraftAttachment(expected: AgentAttachment, payload: unknown): Promise<void> {
    const { expectedAttachmentId, replacementAttachmentId } = (payload ?? {}) as {
      expectedAttachmentId?: unknown
      replacementAttachmentId?: unknown
    }
    if (typeof replacementAttachmentId !== 'string' || !replacementAttachmentId) {
      throw new Error('A replacement needs an attachment id.')
    }
    if (replacing()) throw new Error('Another replacement is already in progress.')
    if (!attachments().some((item) => item.id === expected.id)) {
      throw new Error('That attachment is no longer in this draft.')
    }
    const owner = capture()
    const { state, session } = owner
    state.setReplacing(expected.id)
    try {
      const replacement = await managedAgentApi.attachment(replacementAttachmentId, owner)
      if (!state.valid()) return
      // The draft is re-read here rather than captured before the await: fetching the metadata gave the
      // reader time to remove something. Every rule about whether the swap is allowed lives in the pure
      // decision (./replaceAttachment.ts), where the cases that would lose an attachment are testable.
      const decision = decideReplacement({
        current: state.attachments(),
        expectedId: expected.id,
        claimedExpectedId: expectedAttachmentId,
        replacement,
        taskId: session.taskId,
      })
      if (decision.kind === 'noop') return
      if (decision.kind === 'refuse') {
        // The candidate the contributor created and this composer refused. Nobody references it, so
        // the sweep would get it eventually; asking now keeps a rejected edit from leaving content
        // behind. The decision never refuses when the candidate IS the source, so this cannot delete
        // the reader's own attachment.
        void managedAgentApi.removeAttachment(replacement.id, owner).catch(() => undefined)
        throw new Error(decision.reason)
      }
      // The shared owner writes the replacement before source cleanup. A failed durable write keeps
      // both blobs, so the stored draft still resolves after a reload.
      if (!state.setAttachments(decision.next)) return
      // Best effort, deliberately. The swap is already durable; a failure here leaves an unreferenced
      // row that the store's own 24-hour sweep collects.
      void managedAgentApi.removeAttachment(expected.id, owner).catch(() => undefined)
    } finally {
      state.setReplacing('')
    }
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
    const owner = capture()
    const { state, session } = owner
    if (!contribution || state.capturing()) return
    const revision = state.revisions()[2]
    const operation = state.captureRevision()
    state.setCapturing(contributionId)
    state.setError('')
    try {
      const captured = await contribution.capture({ taskId: session.taskId }, optionIds)
      if (!state.captureCurrent(operation) || activeNodeId() !== owner.nodeId || state.revisions()[2] !== revision) return
      state.setContexts((current) => [...current.filter((item) => !contextBelongsTo(item, contribution)), ...captured])
      if (owner.visible()) setContextPickerId('')
    } catch (caught) {
      state.setError(caught instanceof Error ? caught.message : 'Unable to capture Acorn context.')
    } finally { state.setCapturing('') }
  }

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
                onReplace={(payload) => replaceDraftAttachment(attachment, payload)}
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
            setTimeout(() => setContextPickerId(contribution.id), 0)
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
            onAttach={(optionIds) => void captureContext(contribution().id, optionIds)}
            onClose={() => setContextPickerId('')}
          />
        )}
      </Show>
    </Stack>
  )
}
