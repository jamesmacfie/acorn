import { createEffect, createMemo, createResource, createSignal, on, onCleanup } from 'solid-js'
import { saveFile, setTerminalOpen, type Task } from '@acorn/plugin-api/client'
import type { AgentProviderDescriptor, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { managedAgentApi } from './managedClient'
import { downloadName } from './downloadName'
import { managedAgentStore } from './managedStore'
import { latestAutomaticTaskContext } from '../composer/automaticTaskContext'
import {
  clearManagedSession,
  selectManagedSession,
  selectedManagedSession,
} from './managedSelection'

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
  run(): void
}

/** Prompt-for-text is not arm-to-confirm, and neither is archiving: `window.prompt` and
 *  `window.confirm` are unstyled in the shell and suppressed outright in a sandboxed frame, so both
 *  are dialogs. The session travels with the dialog, because the sidebar's row menu can act on a
 *  session that is not the open one. */
export type AgentDialog = { kind: 'rename' | 'archive'; session: AgentSession }

export type AgentPaneModel = ReturnType<typeof createAgentPaneModel>

const capability = (provider: AgentProviderDescriptor | undefined, name: string): boolean =>
  provider?.capabilities.includes(name as never) ?? false

export function createAgentPaneModel(task: Task) {
  const [error, setError] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [dialog, setDialog] = createSignal<AgentDialog | null>(null)
  const [renameText, setRenameText] = createSignal('')
  const [providers, { refetch: refreshProviders }] = createResource(() => managedAgentApi.providers())

  const taskSessions = createMemo(() =>
    managedAgentStore.sessions()
      .filter((session) => session.taskId === task.id && !session.archivedAt)
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)))
  const selected = createMemo(() => {
    const id = selectedManagedSession(task.id)
    return taskSessions().find((session) => session.id === id) ?? taskSessions()[0]
  })
  const selectedSessionId = createMemo(() => selected()?.id)
  const snapshot = createMemo(() => {
    const session = selected()
    return session ? managedAgentStore.snapshots()[session.id] : undefined
  })
  const provider = createMemo(() =>
    providers()?.find((candidate) => candidate.id === selected()?.providerId))
  const previousAutomaticContext = createMemo(() =>
    latestAutomaticTaskContext(snapshot()?.turns ?? []))

  const releaseSocket = managedAgentStore.activate()
  onCleanup(releaseSocket)
  void managedAgentStore.loadTask(task.id)
    .then((sessions) => {
      if (!selectedManagedSession(task.id) && sessions[0]) selectManagedSession(task.id, sessions[0].id)
    })
    .catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load agent sessions.'))

  // The dep must be the memo, not an inline `() => selected()?.id`. Solid's `on()` runs its callback on
  // every notification without comparing the input, so an inline getter re-fires whenever `selected()`
  // changes identity, and `loadSnapshot` below ends in `upsertSession`, which replaces that object. That
  // was an infinite reload loop; a memo dedupes with `===` and keeps it quiet.
  createEffect(on(selectedSessionId, (sessionId) => {
    setError('')
    if (!sessionId) return
    void managedAgentStore.loadSnapshot(sessionId).catch((caught) => {
      if (selected()?.id !== sessionId) return
      setError(caught instanceof Error ? caught.message : 'Unable to load the agent transcript.')
    })
  }))

  let readTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    const session = selected()
    if (!session || session.lastEventSeq <= session.lastReadSeq) return
    if (readTimer) clearTimeout(readTimer)
    readTimer = setTimeout(() => {
      void managedAgentApi.patch(session.id, { lastReadSeq: session.lastEventSeq })
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

  async function createSession(descriptor: AgentProviderDescriptor) {
    if (!descriptor.installed || creating()) return
    setCreating(true)
    setError('')
    try {
      const session = await managedAgentApi.createSession({
        taskId: task.id,
        providerId: descriptor.id,
        profileId: descriptor.profileId,
        kind: 'interactive',
        config: {},
      })
      managedAgentStore.upsertSession(session)
      selectManagedSession(task.id, session.id)
      await managedAgentStore.loadSnapshot(session.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start the managed agent.')
    } finally {
      setCreating(false)
    }
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
    return [
      { id: 'fork', label: 'Fork session', run: () => void fork() },
      ...(snapshot()?.turns.some((turn) => turn.status === 'failed' || turn.status === 'interrupted')
        ? [{
            id: 'retry',
            label: 'Retry last turn with partial history',
            run: () => void retryLastTurn(),
          }]
        : []),
      ...(capability(provider(), 'compact')
        ? [{
            id: 'compact',
            label: 'Compact context',
            run: () => void action(() => managedAgentApi.compact(session.id)),
          }]
        : []),
      ...(session.controller === 'acorn'
        ? [{
            id: 'terminal',
            label: 'Continue in terminal',
            description: session.providerSessionRef
              ? undefined
              : 'The provider has not supplied a resumable session reference.',
            disabled: !capability(provider(), 'resume') || !session.providerSessionRef,
            run: () => void handoff(),
          }]
        : []),
      ...(session.controller === 'terminal'
        ? [{ id: 'managed', label: 'Return to managed mode', run: () => void resumeManaged() }]
        : []),
      ...(session.controller === 'external' && session.kind === 'imported'
        ? [{
            id: 'verify',
            label: 'Verify & resume provider session',
            disabled: typeof session.config.importedProviderSessionRef !== 'string',
            run: () => void verifyImportedResume(),
          }]
        : []),
      { id: 'rename', label: 'Rename session', run: () => sessionAction(session, 'rename') },
      { id: 'export-markdown', label: 'Export Markdown', run: () => void exportHistory('markdown') },
      { id: 'export-json', label: 'Export lossless JSON', run: () => void exportHistory('json') },
      { id: 'archive', label: 'Archive session…', run: () => sessionAction(session, 'archive') },
    ]
  })

  return {
    task,
    providers: () => providers() ?? [],
    refreshProviders,
    taskSessions,
    selected,
    selectedSessionId,
    snapshot,
    previousAutomaticContext,
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
