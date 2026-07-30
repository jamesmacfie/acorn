import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import type { Task } from '../../../core/client/queries'
import type { AgentProviderDescriptor, AgentSession } from '../../../core/shared/managedAgents'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import {
  clearManagedSession,
  focusedManagedRequest,
  openManagedSession,
  selectManagedSession,
  selectedManagedSession,
} from './managedSelection'
import AgentTranscript from './AgentTranscript'
import AgentComposer from './AgentComposer'
import AgentTaskSidebar from './AgentTaskSidebar'
import AgentUsageIndicator from './AgentUsageIndicator'
import QueuedAgentTurns from './QueuedAgentTurns'
import { setTerminalOpen } from '../../../core/client/tasks/tasks'
import { latestAutomaticTaskContext } from './automaticTaskContext'
import { Button } from '../../../core/client/ui/primitives'
import Icon from '../../../core/client/ui/Icon'
import './managed-agents.css'

const capability = (provider: AgentProviderDescriptor | undefined, name: string): boolean =>
  provider?.capabilities.includes(name as never) ?? false

export default function AgentPane(props: { task: Task }) {
  const [error, setError] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [newOpen, setNewOpen] = createSignal(false)
  const [providers, { refetch: refreshProviders }] = createResource(() => managedAgentApi.providers())
  const taskSessions = createMemo(() =>
    managedAgentStore.sessions()
      .filter((session) => session.taskId === props.task.id && !session.archivedAt)
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)))
  const selected = createMemo(() => {
    const id = selectedManagedSession(props.task.id)
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
  let menuRoot: HTMLDivElement | undefined
  let newRoot: HTMLDivElement | undefined

  onMount(() => {
    const deactivate = managedAgentStore.activate()
    const dismissPopovers = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuOpen() && !menuRoot?.contains(target)) setMenuOpen(false)
      if (newOpen() && !newRoot?.contains(target)) setNewOpen(false)
    }
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      setNewOpen(false)
    }
    document.addEventListener('pointerdown', dismissPopovers)
    window.addEventListener('keydown', dismissWithEscape)
    void managedAgentStore.loadTask(props.task.id)
      .then((sessions) => {
        if (!selectedManagedSession(props.task.id) && sessions[0]) selectManagedSession(props.task.id, sessions[0].id)
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load agent sessions.'))
    onCleanup(() => {
      deactivate()
      document.removeEventListener('pointerdown', dismissPopovers)
      window.removeEventListener('keydown', dismissWithEscape)
    })
  })

  createEffect(on(() => selected()?.id, (sessionId) => {
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

  async function createSession(providerDescriptor: AgentProviderDescriptor) {
    if (!providerDescriptor.installed || creating()) return
    setNewOpen(false)
    setCreating(true)
    setError('')
    try {
      const session = await managedAgentApi.createSession({
        taskId: props.task.id,
        providerId: providerDescriptor.id,
        profileId: providerDescriptor.profileId,
        kind: 'interactive',
        config: {},
      })
      managedAgentStore.upsertSession(session)
      selectManagedSession(props.task.id, session.id)
      await managedAgentStore.loadSnapshot(session.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start the managed agent.')
    } finally {
      setCreating(false)
    }
  }

  async function action(operation: () => Promise<unknown>, reload = true) {
    setMenuOpen(false)
    setError('')
    try {
      await operation()
      if (reload && selected()) await managedAgentStore.loadSnapshot(selected()!.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Agent operation failed.')
    }
  }

  async function fork() {
    const session = selected()
    if (!session) return
    await action(async () => {
      const next = await managedAgentApi.fork(session.id)
      managedAgentStore.upsertSession(next)
      selectManagedSession(props.task.id, next.id)
      await managedAgentStore.loadSnapshot(next.id)
    }, false)
  }

  async function archive() {
    const session = selected()
    if (!session) return
    const next = taskSessions().find((candidate) => candidate.id !== session.id)
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.patch(session.id, { archived: true }))
      if (next) selectManagedSession(props.task.id, next.id)
      else clearManagedSession(props.task.id, session.id)
    }, false)
  }

  async function rename() {
    const session = selected()
    if (!session) return
    const title = window.prompt('Session title', session.title)?.trim()
    if (!title || title === session.title) return
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.patch(session.id, { title }))
    })
  }

  async function remove() {
    const session = selected()
    if (!session || !window.confirm(`Permanently delete local history for “${session.title}”?`)) return
    const next = taskSessions().find((candidate) => candidate.id !== session.id)
    await action(async () => {
      const result = await managedAgentApi.remove(session.id)
      managedAgentStore.removeSession(session.id)
      if (next) selectManagedSession(props.task.id, next.id)
      else clearManagedSession(props.task.id, session.id)
      if (result.provider !== 'deleted') {
        setError(result.provider === 'unsupported'
          ? 'Local history was deleted. This provider does not expose remote deletion.'
          : `Local history was deleted, but provider deletion failed: ${result.detail ?? 'unknown error'}`)
      }
    }, false)
  }

  async function exportHistory(format: 'json' | 'markdown') {
    const session = selected()
    if (!session) return
    await action(async () => {
      const exported = await managedAgentApi.export(session.id, format)
      const url = URL.createObjectURL(new Blob([exported.content], {
        type: format === 'json' ? 'application/json' : 'text/markdown',
      }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${session.title.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'agent-session'}.${format === 'json' ? 'json' : 'md'}`
      anchor.click()
      URL.revokeObjectURL(url)
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
      const updated = await managedAgentApi.handoff(session.id)
      managedAgentStore.upsertSession(updated)
      setTerminalOpen(props.task.id, true)
    })
  }

  async function resumeManaged() {
    const session = selected()
    if (!session) return
    await action(async () => {
      const updated = await managedAgentApi.resumeManaged(session.id)
      managedAgentStore.upsertSession(updated)
    })
  }

  async function verifyImportedResume() {
    const session = selected()
    if (!session) return
    await action(async () => {
      const updated = await managedAgentApi.verifyImportedResume(session.id)
      managedAgentStore.upsertSession(updated)
    })
  }

  return (
    <section class="pane managed-agent-pane">
      <header class="managed-agent-head">
        <div class="managed-agent-heading">
          <strong>{selected()?.title ?? 'Agents'}</strong>
          <Show when={selected()}>
            {(session) => <span>{session().providerId}</span>}
          </Show>
        </div>
        <Show when={selected()}>
          {(session) => (
            <>
              <span class="managed-agent-state" data-state={session().runtimeState}>
                <span />{session().runtimeState}
              </span>
              <Button
                disabled={!['working', 'waiting', 'cancelling'].includes(session().runtimeState)}
                onClick={() => void action(() => managedAgentApi.cancel(session().id))}
              >
                Stop
              </Button>
              <div ref={menuRoot} class="managed-agent-menu">
                <Button
                  iconOnly
                  aria-label="Session actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen()}
                  onClick={() => {
                    setNewOpen(false)
                    setMenuOpen(!menuOpen())
                  }}
                >
                  <Icon name="ellipsis" />
                </Button>
                <Show when={menuOpen()}>
                  <div class="managed-agent-menu-popover" role="menu">
                    <button type="button" onClick={() => void fork()}>Fork session</button>
                    <Show when={snapshot()?.turns.some((turn) => turn.status === 'failed' || turn.status === 'interrupted')}>
                      <button type="button" onClick={() => void retryLastTurn()}>Retry last turn with partial history</button>
                    </Show>
                    <Show when={capability(provider(), 'compact')}>
                      <button type="button" onClick={() => void action(() => managedAgentApi.compact(session().id))}>Compact context</button>
                    </Show>
                    <Show when={session().controller === 'acorn'}>
                      <button
                        type="button"
                        disabled={!capability(provider(), 'resume') || !session().providerSessionRef}
                        title={!session().providerSessionRef ? 'The provider has not supplied a resumable session reference.' : ''}
                        onClick={() => void handoff()}
                      >
                        Continue in terminal
                      </button>
                    </Show>
                    <Show when={session().controller === 'terminal'}>
                      <button type="button" onClick={() => void resumeManaged()}>Return to managed mode</button>
                    </Show>
                    <Show when={session().controller === 'external' && session().kind === 'imported'}>
                      <button
                        type="button"
                        disabled={typeof session().config.importedProviderSessionRef !== 'string'}
                        onClick={() => void verifyImportedResume()}
                      >
                        Verify & resume provider session
                      </button>
                    </Show>
                    <button type="button" onClick={() => void rename()}>Rename session</button>
                    <button type="button" onClick={() => void exportHistory('markdown')}>Export Markdown</button>
                    <button type="button" onClick={() => void exportHistory('json')}>Export lossless JSON</button>
                    <button type="button" onClick={() => void archive()}>Archive session</button>
                    <button type="button" class="danger" onClick={() => void remove()}>Delete permanently…</button>
                  </div>
                </Show>
              </div>
            </>
          )}
        </Show>
        <AgentUsageIndicator />
        <div ref={newRoot} class="managed-agent-new">
          <Button
            aria-haspopup="menu"
            aria-expanded={newOpen()}
            onClick={() => {
              setMenuOpen(false)
              setNewOpen(!newOpen())
            }}
          >
            <Icon name="plus" /> New
          </Button>
          <Show when={newOpen()}>
            <div class="managed-agent-new-popover" role="menu">
            <For each={providers() ?? []}>
              {(providerDescriptor) => (
                <button
                  type="button"
                  disabled={!providerDescriptor.installed || creating()}
                  title={providerDescriptor.diagnostics.join('\n')}
                  onClick={() => void createSession(providerDescriptor)}
                >
                  <strong>{providerDescriptor.label}</strong>
                  <span>{providerDescriptor.installed ? providerDescriptor.executableVersion ?? 'Available' : 'Not installed'}</span>
                </button>
              )}
            </For>
            <button type="button" class="managed-agent-refresh" onClick={() => void refreshProviders()}>Refresh provider health</button>
            </div>
          </Show>
        </div>
      </header>

      <div class="managed-agent-body">
        <AgentTaskSidebar
          task={props.task}
          managedSessions={taskSessions()}
          selectedSessionId={selectedSessionId()}
          onSelectSession={(sessionId, requestId) => openManagedSession(props.task.id, sessionId, requestId)}
          onError={setError}
        />
        <div class="managed-agent-conversation">
          <Show when={error()}><div class="action-error managed-agent-error" role="alert">{error()}</div></Show>
          <Show
            when={selected()}
            fallback={
              <div class="managed-agent-onboarding">
                <span class="agent-empty-mark">✦</span>
                <h2>Start a managed coding session</h2>
                <p>Claude Code and Codex run against this task’s worktree using your existing CLI account.</p>
                <div class="managed-agent-provider-cards">
                  <For each={providers() ?? []}>
                    {(providerDescriptor) => (
                      <button
                        type="button"
                        disabled={!providerDescriptor.installed || creating()}
                        onClick={() => void createSession(providerDescriptor)}
                      >
                        <strong>{providerDescriptor.label}</strong>
                        <span>{providerDescriptor.installed ? 'Start managed session' : providerDescriptor.diagnostics[0] ?? 'Unavailable'}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            }
          >
            {(session) => (
              <>
                <Show when={snapshot()} fallback={<div class="managed-agent-loading">Loading conversation…</div>}>
                  {(value) => (
                    <>
                      <AgentTranscript
                        taskId={props.task.id}
                        snapshot={value()}
                        focusRequestId={focusedManagedRequest(session().id)}
                        onRequestResolved={() => void managedAgentStore.loadSnapshot(session().id)}
                      />
                      <QueuedAgentTurns
                        sessionId={session().id}
                        turns={value().turns}
                        onChanged={() => managedAgentStore.loadSnapshot(session().id)}
                        onError={setError}
                      />
                    </>
                  )}
                </Show>
                <AgentComposer
                  session={session()}
                  disabled={session().controller !== 'acorn' || session().runtimeState === 'archived'}
                  previousAutomaticContext={previousAutomaticContext()}
                  onSessionUpdated={managedAgentStore.upsertSession}
                  onSent={() => void managedAgentStore.loadSnapshot(session().id)}
                />
              </>
            )}
          </Show>
        </div>
      </div>
    </section>
  )
}
