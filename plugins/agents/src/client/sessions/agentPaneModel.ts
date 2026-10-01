import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId, defaultDeliveryContext, markAttentionSeen, saveFile, setTerminalOpen, type PaneModelContext, type Task,
} from '@acorn/plugin-api/client'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import type { AgentAttachment, AgentProviderDescriptor, AgentSession, AgentSessionSnapshot } from '../../contract/wire.ts'
import { AUTOMATIC_TASK_CONTEXT_SOURCE } from '../composer/automaticTaskContext'
import { composerDraftState } from '../composer/composerState'
import { managedDraft } from './managedDrafts'
import { managedAgentApi } from './managedClient'
import { downloadName } from './downloadName'
import { managedAgentStore } from './managedStore'
import {
  agentAttentionItemId,
  clearManagedSubagent,
  clearManagedSession,
  requestComposerFocus,
  selectManagedSession,
  selectedManagedSession,
} from './managedSelection'
import { agentSessionRoster } from './sessionRoster'
import { newSessionChoices, type NewSessionChoice } from './newSessionChoices'
import { customAgentsOptions } from '../settings/customAgentsClient'
import { agentProvidersOptions, refreshAgentProviders } from '../providersClient'

// Everything the Agent pane's two regions have to agree on.
//
// The pane is a `list-detail` layout, so the sidebar and the conversation are two components the host
// mounts side by side (docs/panes.md § Layout model). Which session is open, what went wrong, and
// which dialog is up are shared between them, so none of it can live in either. Held once per task,
// the same shape github's PR pane uses for the pull it is showing (github/pullDetail/prTabs.ts).

export type SessionAction = {
  id: string
  label: string
  description?: string
  disabled?: boolean
  /** A Lucide name, drawn before the label. */
  icon?: string
  /** `danger` for an action that removes something. The menu draws it last, below a rule. */
  tone?: 'danger'
  run(): void
}

/** Prompt-for-text is not arm-to-confirm, and neither is archiving: `window.prompt` and
 *  `window.confirm` are unstyled in the shell and suppressed outright in a sandboxed frame, so both
 *  are dialogs. The session travels with the dialog, because the sidebar's row menu can act on a
 *  session that is not the open one. */
export type AgentDialog = { kind: 'rename' | 'archive'; session: AgentSession }

/** Nothing to lose by archiving: no turns and an empty draft. The task context the composer attaches
 *  on its own does not count as input. An unloaded snapshot means we cannot tell, so we ask. */
export function sessionIsBlank(
  snapshot: Pick<AgentSessionSnapshot, 'turns'> | undefined,
  draft: { text: string; attachments: AgentAttachment[]; contexts: AgentContextSnapshot[] },
): boolean {
  return !!snapshot && !snapshot.turns.length && !draft.text.trim() && !draft.attachments.length
    && draft.contexts.every((context) => context.source === AUTOMATIC_TASK_CONTEXT_SOURCE)
}

export type AgentPaneModel = ReturnType<typeof createAgentPaneModel>

const capability = (provider: AgentProviderDescriptor | undefined, name: string): boolean =>
  provider?.capabilities.includes(name as never) ?? false

export function createAgentPaneModel(task: Task, pane: PaneModelContext) {
  const [error, setError] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [dialog, setDialog] = createSignal<AgentDialog | null>(null)
  const [renameText, setRenameText] = createSignal('')
  const queryClient = useQueryClient()
  const providersQuery = createQuery(() => agentProvidersOptions())
  const customAgents = createQuery(() => customAgentsOptions())
  // `.data` is read only once there is some. On an empty cache solid-query suspends the boundary above
  // whoever reads it, and this model is built inside the first region that asks for it, which is the
  // list header. Reading it bare held "Agents" off the screen for the whole providers probe. The New
  // menu and the empty state say they are loading instead (./AgentPane.tsx).
  const providers = (): AgentProviderDescriptor[] | undefined =>
    providersQuery.isPending ? undefined : providersQuery.data
  const providersLoading = () => providersQuery.isPending
  const choices = createMemo(() =>
    newSessionChoices(providers() ?? [], customAgents.isPending ? [] : customAgents.data ?? []))

  const taskSessions = createMemo(() =>
    managedAgentStore.sessionsForTask(task.id)
      .filter((session) => !session.archivedAt)
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)))
  const sessionRoster = createMemo(() => agentSessionRoster(taskSessions(), managedAgentStore.delegations()))
  // With nothing chosen yet, the session that changed last. That is the order the node lists a task's
  // sessions in, and so the one the load below selects. The newest-created one opened first and then
  // switched when the list came back, which started two whole snapshot reads on a first visit.
  const selected = createMemo(() => {
    const id = selectedManagedSession(task.id)
    const sessions = taskSessions()
    return sessions.find((session) => session.id === id)
      ?? sessions.reduce<AgentSession | undefined>((last, session) =>
        !last || session.updatedAt > last.updatedAt ? session : last, undefined)
  })
  const selectedSessionId = createMemo(() => selected()?.id)
  const selectedDelegation = createMemo(() => {
    const id = selectedSessionId()
    return id ? managedAgentStore.delegations()[id] : undefined
  })
  const selectedManagedParent = createMemo(() => {
    const owner = selectedDelegation()?.owner
    if (owner?.kind !== 'managed') return undefined
    return taskSessions().find((session) => session.id === owner.parentSessionId)
  })
  const snapshot = createMemo(() => {
    const session = selected()
    return session ? managedAgentStore.snapshots()[session.id] : undefined
  })
  const provider = createMemo(() =>
    providers()?.find((candidate) => candidate.id === selected()?.providerId))

  const releaseSocket = managedAgentStore.activate()
  onCleanup(releaseSocket)
  const sessionsLoaded = managedAgentStore.loadTask(task.id)
  void sessionsLoaded
    .then((sessions) => {
      if (!selectedManagedSession(task.id) && sessions[0]) selectManagedSession(task.id, sessions[0].id)
    })
    .catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load agent sessions.'))

  // No snapshot load here. The conversation owns that, because it is the thing that needs one and it
  // is mounted in two panes now (./AgentConversation.tsx). Loading it here as well made two requests
  // for the same few thousand event rows every time a session opened. What is left is clearing the
  // pane's own error when the reader moves on.
  createEffect(on(selectedSessionId, () => setError('')))

  // Acknowledge on view. The node keeps `attention: completed` until the owner speaks again, so a
  // finished session sits in "Needs you" long after they have read it. Looking at it, in a focused
  // window, is the acknowledgement (client-core attentionInbox.ts). Looking means the pane is drawn,
  // not that the task is the active one: the active task stays set behind a rail source such as Home,
  // and this model outlives the pane.
  const acknowledgeCompleted = (): void => {
    if (!pane.shown() || !defaultDeliveryContext.focused()) return
    const nodeId = activeNodeId() ?? ''
    for (const session of taskSessions())
      if (session.attention === 'completed') markAttentionSeen(nodeId, agentAttentionItemId(session.id))
  }
  createEffect(acknowledgeCompleted)
  // The effect alone misses the commonest case: the session completed while you were elsewhere, and
  // coming back changes nothing it tracks.
  // Feature-checked rather than `typeof window`: the terminal host and the test harness both supply
  // a window-shaped object that is not a DOM one.
  if (typeof window?.addEventListener === 'function') {
    window.addEventListener('focus', acknowledgeCompleted)
    onCleanup(() => window.removeEventListener('focus', acknowledgeCompleted))
  }

  // Mark read what the reader can see. Only while the pane is drawn, because the host keeps this model
  // after they leave, and a read mark also sets the session's attention to none on the node: marking
  // from the background cleared "Needs you" on sessions nobody had looked at. Coming back re-runs this.
  let readTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    const session = selected()
    if (!pane.shown() || !session) return
    // The live number, not the row's, which stops at the row's last change (./managedStore.ts § eventSeqs).
    const seq = managedAgentStore.lastEventSeq(session)
    if (seq <= session.lastReadSeq) return
    if (readTimer) clearTimeout(readTimer)
    readTimer = setTimeout(() => {
      void managedAgentApi.patch(session.id, { lastReadSeq: seq })
        .then(managedAgentStore.upsertSession)
        .catch(() => undefined)
    }, 350)
  })
  onCleanup(() => {
    if (readTimer) clearTimeout(readTimer)
  })

  async function action(operation: () => Promise<unknown>, reload = true) {
    setError('')
    try {
      await operation()
      const session = selected()
      if (reload && session) await managedAgentStore.loadSnapshot(session.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Agent operation failed.')
    }
  }

  async function createSession({ provider: descriptor, agent }: NewSessionChoice) {
    if (!descriptor.installed || creating()) return
    setCreating(true)
    setError('')
    try {
      const session = await managedAgentStore.startSession(task.id, descriptor, agent?.id)
      selectManagedSession(task.id, session.id)
      requestComposerFocus(session.id)
      await managedAgentStore.loadSnapshot(session.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start the managed agent.')
    } finally {
      setCreating(false)
    }
  }

  function openManagedParent() {
    const parent = selectedManagedParent()
    if (!parent) return
    clearManagedSubagent(parent.id)
    selectManagedSession(task.id, parent.id)
  }

  async function fork() {
    const session = selected()
    if (!session) return
    await action(async () => {
      const next = await managedAgentApi.fork(session.id)
      managedAgentStore.upsertSession(next)
      selectManagedSession(task.id, next.id)
      await managedAgentStore.loadSnapshot(next.id)
    }, false)
  }

  async function archive(session: AgentSession) {
    setDialog(null)
    const next = taskSessions().find((candidate) => candidate.id !== session.id)
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.patch(session.id, { archived: true }))
      if (next) selectManagedSession(task.id, next.id)
      else clearManagedSession(task.id, session.id)
    }, false)
  }

  /** One entry point for both menus: the header's, which always addresses the open session, and the
   *  sidebar row's, which names its own. */
  function sessionAction(session: AgentSession, kind: 'rename' | 'archive' | 'stop') {
    if (kind === 'stop') return void action(() => managedAgentApi.cancel(session.id))
    if (kind === 'rename') setRenameText(session.title)
    if (kind === 'archive') {
      const shared = composerDraftState(session.id)
      const blank = sessionIsBlank(managedAgentStore.snapshots()[session.id], {
        text: managedDraft(session.id), attachments: shared.attachments(), contexts: shared.contexts(),
      })
      if (blank) return void archive(session)
    }
    setDialog({ kind, session })
  }

  async function rename() {
    const target = dialog()?.session
    const title = renameText().trim()
    setDialog(null)
    if (!target || !title || title === target.title) return
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.patch(target.id, { title }))
    })
  }

  async function regenerateTitle() {
    const session = selected()
    if (!session) return
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.regenerateTitle(session.id))
    }, false)
  }

  async function exportHistory(format: 'json' | 'markdown') {
    const session = selected()
    if (!session) return
    await action(async () => {
      const exported = await managedAgentApi.export(session.id, format)
      await saveFile({
        bytes: new TextEncoder().encode(exported.content),
        mimeType: format === 'json' ? 'application/json' : 'text/markdown',
        suggestedName: `${downloadName(session.title, 80) || 'agent-session'}.${format === 'json' ? 'json' : 'md'}`,
      })
    }, false)
  }

  async function retryLastTurn() {
    const session = selected()
    const value = snapshot()
    const turn = [...(value?.turns ?? [])].reverse()
      .find((candidate) => candidate.status === 'failed' || candidate.status === 'interrupted')
    if (!session || !turn) return
    await action(async () => {
      await managedAgentApi.enqueue(session.id, {
        input: turn.input,
        source: 'interactive',
        effectivePolicy: {
          ...turn.effectivePolicy,
          retryOfTurnId: turn.id,
          includePartialHistory: true,
        },
      })
    })
  }

  async function handoff() {
    const session = selected()
    if (!session) return
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.handoff(session.id))
      setTerminalOpen(task.id, true)
    })
  }

  async function resumeManaged() {
    const session = selected()
    if (!session) return
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.resumeManaged(session.id))
    })
  }

  async function verifyImportedResume() {
    const session = selected()
    if (!session) return
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.verifyImportedResume(session.id))
    })
  }

  const sessionActions = createMemo<SessionAction[]>(() => {
    const session = selected()
    if (!session) return []
    const hasTextPrompt = snapshot()?.turns[0]?.input.some((part) => part.type === 'text' && !!part.text.trim()) ?? false
    return [
      { id: 'fork', label: 'Fork session', icon: 'git-fork', run: () => void fork() },
      ...(snapshot()?.turns.some((turn) => turn.status === 'failed' || turn.status === 'interrupted')
        ? [{
            id: 'retry',
            label: 'Retry last turn with partial history',
            icon: 'rotate-ccw',
            run: () => void retryLastTurn(),
          }]
        : []),
      ...(capability(provider(), 'compact')
        ? [{
            id: 'compact',
            label: 'Compact context',
            icon: 'shrink',
            run: () => void action(() => managedAgentApi.compact(session.id)),
          }]
        : []),
      ...(session.controller === 'acorn'
        ? [{
            id: 'terminal',
            label: 'Continue in terminal',
            icon: 'square-terminal',
            description: session.providerSessionRef
              ? undefined
              : 'The provider has not supplied a resumable session reference.',
            disabled: !capability(provider(), 'resume') || !session.providerSessionRef,
            run: () => void handoff(),
          }]
        : []),
      ...(session.controller === 'terminal'
        ? [{ id: 'managed', label: 'Return to managed mode', icon: 'bot', run: () => void resumeManaged() }]
        : []),
      ...(session.controller === 'external' && session.kind === 'imported'
        ? [{
            id: 'verify',
            label: 'Reconnect session',
            description: 'Check that the provider still has this session, then continue it in acorn.',
            icon: 'refresh-cw',
            disabled: typeof session.config.importedProviderSessionRef !== 'string',
            run: () => void verifyImportedResume(),
          }]
        : []),
      {
        id: 'regenerate-title',
        label: 'Regenerate title',
        icon: 'sparkles',
        description: hasTextPrompt ? undefined : 'Send a text prompt before regenerating the title.',
        disabled: !hasTextPrompt,
        run: () => void regenerateTitle(),
      },
      { id: 'rename', label: 'Rename session', icon: 'pencil', run: () => sessionAction(session, 'rename') },
      { id: 'export-markdown', label: 'Export Markdown', icon: 'download', run: () => void exportHistory('markdown') },
      { id: 'export-json', label: 'Export lossless JSON', icon: 'download', run: () => void exportHistory('json') },
      { id: 'archive', label: 'Archive session…', icon: 'archive', tone: 'danger', run: () => sessionAction(session, 'archive') },
    ]
  })

  return {
    task,
    sessionsLoaded,
    providers: () => providers() ?? [],
    /** True until the first providers answer arrives, so a control can say so rather than look empty. */
    providersLoading,
    /** New's rows: every harness, then every custom agent (./newSessionChoices.ts). */
    choices,
    /** Probe the harnesses again, for the Refresh button in the New menu. */
    refreshProviders: () => refreshAgentProviders(queryClient)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to check the agent providers.')),
    taskSessions,
    sessionRoster,
    selected,
    selectedSessionId,
    selectedDelegation,
    selectedManagedParent,
    openManagedParent,
    snapshot,
    creating,
    error,
    setError,
    dialog,
    setDialog,
    renameText,
    setRenameText,
    action,
    createSession,
    archive,
    rename,
    sessionAction,
    sessionActions,
  }
}
