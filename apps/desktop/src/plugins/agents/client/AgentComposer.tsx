import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import type { AgentAttachment, AgentConfigOption, AgentInputPart, AgentSession } from '../../../core/shared/managedAgents'
import { agentContextBudget, type AgentContextSnapshot } from '../../../core/shared/agentContext'
import { managedAgentApi } from './managedClient'
import { agentContextContributions } from '../../../core/client/registries/agentContexts'
import { Field, Select } from '../../../core/client/ui/primitives'
import { hydrateManagedDraft, managedDraft, setManagedDraft } from './managedDrafts'
import { sameAgentConfigOptions } from './agentConfigOptions'
import { agentComposerDisabledMessage } from './agentComposerState'
import { parseFileMentions } from './fileMentions'
import {
  AUTOMATIC_TASK_CONTEXT_SOURCE,
  TASK_CONTEXT_CONTRIBUTION_ID,
  automaticTaskContextFor,
  automaticTaskContextPayload,
} from './automaticTaskContext'

const draftKey = (sessionId: string): string => `acorn.agent-draft.${sessionId}`
const attachmentDraftKey = (sessionId: string): string => `acorn.agent-attachments.${sessionId}`
const contextDraftKey = (sessionId: string): string => `acorn.agent-context.${sessionId}`

export default function AgentComposer(props: {
  session: AgentSession
  disabled?: boolean
  previousAutomaticContext?: AgentContextSnapshot
  onSent: () => void
  onSessionUpdated: (session: AgentSession) => void
}) {
  const [sending, setSending] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [attachments, setAttachments] = createSignal<AgentAttachment[]>([])
  const [contexts, setContexts] = createSignal<AgentContextSnapshot[]>([])
  const [capturingContext, setCapturingContext] = createSignal('')
  const [dismissedAutomaticPayload, setDismissedAutomaticPayload] = createSignal<string>()
  const [error, setError] = createSignal('')
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
  const contextBudget = createMemo(() => agentContextBudget(contexts()))
  const disabledMessage = createMemo(() => agentComposerDisabledMessage(props.session, props.disabled))
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

  createEffect(on(() => props.session.id, (sessionId) => {
    hydrateManagedDraft(sessionId, localStorage.getItem(draftKey(sessionId)) ?? '')
    setError('')
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

  async function send() {
    const text = draft().trim()
    if ((!text && !attachments().length && !contexts().length) || sending() || props.disabled) return
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

  async function updateOption(option: AgentConfigOption, value: string) {
    const nextOptions = configOptions().map((item) =>
      item.id === option.id ? { ...item, currentValue: value } : item)
    try {
      const session = await managedAgentApi.patch(props.session.id, {
        config: { ...props.session.config, configOptions: nextOptions },
      })
      props.onSessionUpdated(session)
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

  async function captureContext(contributionId: string) {
    const contribution = agentContextContributions().find((item) => item.id === contributionId)
    if (!contribution || capturingContext()) return
    setCapturingContext(contributionId)
    setError('')
    try {
      const captured = await contribution.capture({ taskId: props.session.taskId })
      setContexts((current) => [
        ...current.filter((item) => !captured.some((next) => next.source === item.source)),
        ...captured,
      ])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to capture Acorn context.')
    } finally {
      setCapturingContext('')
    }
  }

  let fileInput: HTMLInputElement | undefined

  return (
    <div class="agent-composer-shell">
      <div class="agent-composer-context">
        <span class="agent-policy">
          Provider policy
          <strong>{configOptions().find((option) => option.category === 'permission')?.currentValue ?? 'provider default'}</strong>
        </span>
        <For each={configOptions()}>
          {(option) => (
            <Field class="agent-config-field" label={option.label} layout="row">
              <Select
                aria-label={option.label}
                size="sm"
                width="auto"
                value={option.currentValue ?? ''}
                disabled={props.disabled}
                onChange={(event) => void updateOption(option, event.currentTarget.value)}
              >
                <For each={option.values}>
                  {(value) => <option value={value.value} title={value.description}>{value.label}</option>}
                </For>
              </Select>
            </Field>
          )}
        </For>
      </div>
      <div class="agent-composer">
        <input
          ref={fileInput}
          class="agent-file-input"
          type="file"
          multiple
          accept=".txt,.md,.json,.yaml,.yml,.toml,.xml,.csv,.ts,.tsx,.js,.jsx,.css,.html,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.hpp,.swift,.sh,.sql,.diff,.patch,image/jpeg,image/png,image/gif,image/webp,application/pdf"
          onChange={(event) => {
            void addFiles([...(event.currentTarget.files ?? [])])
            event.currentTarget.value = ''
          }}
        />
        <For each={attachments()}>
          {(attachment) => (
            <span class="agent-attachment-chip">
              <span>{attachment.mediaType.startsWith('image/') ? '▧' : '▤'}</span>
              <span title={attachment.filename}>{attachment.filename}</span>
              <small>{Math.max(1, Math.round(attachment.byteSize / 1024))} KiB</small>
              <button type="button" title={`Remove ${attachment.filename}`} onClick={() => removeAttachment(attachment)}>×</button>
            </span>
          )}
        </For>
        <For each={contexts()}>
          {(context) => (
            <span class="agent-context-chip" title={context.provenance}>
              <span>◇</span>
              <span>{context.label}</span>
              <small>~{(context.estimatedTokens ?? Math.ceil((context.byteSize ?? context.content.length) / 4)).toLocaleString()} tok</small>
              <button type="button" title={`Remove ${context.label}`} onClick={() => removeContext(context)}>×</button>
            </span>
          )}
        </For>
        <Show when={contexts().find((context) => context.source === AUTOMATIC_TASK_CONTEXT_SOURCE)}>
          {(context) => (
            <p class="agent-automatic-context-note">
              {context().label.endsWith('updated')
                ? 'Context changed since it was last sent. The refreshed snapshot will be attached to this turn.'
                : 'Acorn attached the task’s selected Context-pane information to the first turn.'}
            </p>
          )}
        </Show>
        <textarea
          value={draft()}
          disabled={props.disabled}
          aria-label="Message agent"
          placeholder={disabledMessage() ?? 'Ask the agent…  @file  /command  $skill'}
          rows="3"
          onInput={(event) => setDraft(event.currentTarget.value)}
          onPaste={(event) => {
            const files = [...(event.clipboardData?.files ?? [])]
            if (files.length) {
              event.preventDefault()
              void addFiles(files)
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
          }}
          onDrop={(event) => {
            const files = [...(event.dataTransfer?.files ?? [])]
            if (files.length) {
              event.preventDefault()
              void addFiles(files)
            }
          }}
          onKeyDown={(event) => {
            if (event.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <div class="agent-composer-actions">
          <button
            type="button"
            class="agent-attach"
            title="Attach files"
            disabled={uploading() || props.disabled}
            onClick={() => fileInput?.click()}
          >
            {uploading() ? 'Uploading…' : 'Attach'}
          </button>
          <details class="agent-insert-menu agent-context-menu">
            <summary aria-label="Add Acorn context">Context</summary>
            <div>
              <For each={agentContextContributions()}>
                {(contribution) => (
                  <button
                    type="button"
                    title={contribution.description}
                    disabled={!!capturingContext()}
                    onClick={() => void captureContext(contribution.id)}
                  >
                    {capturingContext() === contribution.id ? 'Capturing…' : contribution.label}
                  </button>
                )}
              </For>
            </div>
          </details>
          <details class="agent-insert-menu">
            <summary aria-label="Insert provider command or skill">＋</summary>
            <div>
              <For each={commands()}>{(command) => <button type="button" title={command.description} onClick={() => insert(`/${command.name}`)}>/{command.name}</button>}</For>
              <For each={skills()}>{(skill) => <button type="button" title={skill.description} onClick={() => insert(`$${skill.name}`)}>${skill.name}</button>}</For>
              {!commands().length && !skills().length ? <span class="muted">No commands or skills advertised</span> : null}
            </div>
          </details>
          <Show when={contexts().length}>
            <details class="agent-context-preview">
              <summary classList={{ 'agent-context-over-budget': contextBudget().overLimit }}>
                Preview sent context · ~{contextBudget().estimatedTokens.toLocaleString()} tokens · {(contextBudget().bytes / 1024).toFixed(1)} KiB
              </summary>
              <pre>{contexts().map((context) => `## ${context.label}\n${context.content}`).join('\n\n')}</pre>
            </details>
          </Show>
          <span class="muted agent-send-hint">Shift+Enter for newline</span>
          <button type="button" class="agent-send" disabled={(!draft().trim() && !attachments().length && !contexts().length) || contextBudget().overLimit || sending() || props.disabled} onClick={() => void send()}>
            {sending() ? 'Queueing…' : 'Send'}
          </button>
        </div>
      </div>
      {error() ? <div class="action-error agent-composer-error" role="alert">{error()}</div> : null}
    </div>
  )
}
