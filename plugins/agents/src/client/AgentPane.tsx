import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { setTerminalOpen, type Task } from '@acorn/plugin-api/client'
import type { AgentProviderDescriptor, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import {
  clearManagedSession,
  focusedManagedRequest,
  openManagedSession,
  clearManagedSubagent,
  selectManagedSession,
  selectManagedSubagent,
  selectedManagedSession,
  selectedManagedSubagent,
} from './managedSelection'
import AgentTranscript from './AgentTranscript'
import AgentComposer from './AgentComposer'
import AgentTaskSidebar from './AgentTaskSidebar'
import AgentUsageIndicator from './AgentUsageIndicator'
import ProviderGlyph from './ProviderGlyph'
import QueuedAgentTurns from './QueuedAgentTurns'
import { latestAutomaticTaskContext } from './automaticTaskContext'
import { canStopAgent } from './agentActivity'
import { Alert, Button, Card, EmptyState, Field, Icon, Input, ListDetail, Menu, Modal, Picker } from '@acorn/plugin-api/ui'
import RuntimeStateIcon from './RuntimeStateIcon'
import './managed-agents.css'

const capability = (provider: AgentProviderDescriptor | undefined, name: string): boolean =>
  provider?.capabilities.includes(name as never) ?? false

type SessionAction = {
  id: string
  label: string
  description?: string
  disabled?: boolean
  run(): void
}

export default function AgentPane(props: { task: Task }) {
  const [error, setError] = createSignal('')
  const [creating, setCreating] = createSignal(false)
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

  onMount(() => {
    const deactivate = managedAgentStore.activate()
    void managedAgentStore.loadTask(props.task.id)
      .then((sessions) => {
        if (!selectedManagedSession(props.task.id) && sessions[0]) selectManagedSession(props.task.id, sessions[0].id)
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load agent sessions.'))
    onCleanup(() => {
      deactivate()
    })
  })

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

  async function createSession(providerDescriptor: AgentProviderDescriptor) {
    if (!providerDescriptor.installed || creating()) return
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

  async function archive(session: AgentSession) {
    setDialog(null)
    const next = taskSessions().find((candidate) => candidate.id !== session.id)
    await action(async () => {
      managedAgentStore.upsertSession(await managedAgentApi.patch(session.id, { archived: true }))
      if (next) selectManagedSession(props.task.id, next.id)
      else clearManagedSession(props.task.id, session.id)
    }, false)
  }

  // Prompt-for-text is not arm-to-confirm, and neither is archiving: window.prompt and
  // window.confirm are unstyled in Electron and suppressed outright in a sandboxed frame, so both
  // become dialogs. `dialog` carries which one is open and which session it addresses, because the
  // sidebar's row menu can act on a session that is not the open one.
  const [dialog, setDialog] = createSignal<{ kind: 'rename' | 'archive'; session: AgentSession } | null>(null)
  const [renameText, setRenameText] = createSignal('')

  // One entry point for both menus: the header's, which always addresses the open session, and the
  // sidebar row's, which names its own.
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

  const sessionActions = createMemo<SessionAction[]>(() => {
    const session = selected()
    if (!session) return []
    return [
      {
        id: 'fork',
        label: 'Fork session',
        run: () => void fork(),
      },
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
        ? [{
            id: 'managed',
            label: 'Return to managed mode',
            run: () => void resumeManaged(),
          }]
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
              <span class="managed-agent-state">
                <RuntimeStateIcon state={session().runtimeState} />{session().runtimeState}
              </span>
              <Button
                disabled={!canStopAgent(session())}
                onClick={() => void action(() => managedAgentApi.cancel(session().id))}
              >
                Stop
              </Button>
              {/* Was a Picker — a filter input over five or six actions, which is the wrong
                  affordance: nobody types to find "Rename session". A Menu is the shape. */}
              <Menu
                class="managed-agent-action-menu"
                ariaLabel="Session actions"
                placement="bottom-end"
                trigger={({ toggle, open }) => (
                  <Button
                    iconOnly
                    aria-label="Session actions"
                    aria-haspopup="menu"
                    aria-expanded={open()}
                    onClick={toggle}
                  >
                    <Icon name="ellipsis" />
                  </Button>
                )}
              >
                {(menu) => (
                  <For each={sessionActions()}>
                    {(item) => (
                      <Menu.Item
                        context={menu}
                        disabled={!!item.disabled}
                        title={item.description}
                        onSelect={() => item.run()}
                      >
                        {item.label}
                      </Menu.Item>
                    )}
                  </For>
                )}
              </Menu>
            </>
          )}
        </Show>
        <AgentUsageIndicator />
        <Picker<AgentProviderDescriptor>
          label={<><Icon name="plus" class="glyph" /> New</>}
          ariaLabel="New"
          placement="bottom-end"
          placeholder="Filter providers…"
          emptyText="No managed providers available."
          results={(query) => (providers() ?? []).filter((item) =>
            item.label.toLowerCase().includes(query.trim().toLowerCase()))}
          leading={(item) => <ProviderGlyph glyph={item.glyph} label={item.label} />}
          rowLabel={(item) => item.label}
          rowDescription={(item) =>
            item.installed ? item.executableVersion ?? 'Available' : item.diagnostics[0] ?? 'Not installed'}
          isActive={() => false}
          isDisabled={(item) => !item.installed || creating()}
          onSelect={(item) => void createSession(item)}
          buttonClass="repo-picker-button managed-agent-picker-button"
          tools={
            <Button
              variant="bare"
              iconOnly
              title="Refresh provider health"
              aria-label="Refresh provider health"
              onClick={() => void refreshProviders()}
            >
              <Icon name="refresh-cw" />
            </Button>
          }
        />
      </header>

      <ListDetail
        listLabel="Agents in this task"
        listClass="agent-task-sidebar"
        detailClass="managed-agent-conversation"
        list={
          <AgentTaskSidebar
            task={props.task}
            managedSessions={taskSessions()}
            selectedSessionId={selectedSessionId()}
            selectedSubagentId={selectedSessionId() ? selectedManagedSubagent(selectedSessionId()!) : undefined}
            onSelectSession={(sessionId, requestId) => {
              // Picking the session row is how you come back out of a subagent's run.
              clearManagedSubagent(sessionId)
              openManagedSession(props.task.id, sessionId, requestId)
            }}
            onSelectSubagent={(sessionId, subagentId) => {
              // The session first: a sub-row under a session that is not the open one has to bring its
              // parent's transcript up before there is a card to scroll to.
              if (sessionId !== selectedSessionId()) openManagedSession(props.task.id, sessionId)
              selectManagedSubagent(sessionId, subagentId)
            }}
            onSessionAction={sessionAction}
            onError={setError}
          />
        }
      >
        <Show when={error()}><Alert class="managed-agent-error">{error()}</Alert></Show>
        <Show
          when={selected()}
          fallback={
            <EmptyState
              class="managed-agent-onboarding"
              icon={<span class="agent-empty-mark">✦</span>}
              title="Start a managed coding session"
            >
              <div class="managed-agent-provider-cards">
                <For each={providers() ?? []}>
                  {(providerDescriptor) => (
                    <Card
                      class="managed-agent-provider-card"
                      interactive
                      disabled={!providerDescriptor.installed || creating()}
                      onActivate={() => void createSession(providerDescriptor)}
                    >
                      <strong>
                        <ProviderGlyph glyph={providerDescriptor.glyph} label={providerDescriptor.label} />
                        {providerDescriptor.label}
                      </strong>
                      <span>{providerDescriptor.installed ? 'Start managed session' : providerDescriptor.diagnostics[0] ?? 'Unavailable'}</span>
                    </Card>
                  )}
                </For>
              </div>
            </EmptyState>
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
                      focusSubagentId={selectedManagedSubagent(session().id)}
                      onExitSubagent={() => clearManagedSubagent(session().id)}
                      onRequestResolved={() => void managedAgentStore.loadSnapshot(session().id)}
                    />
                    <QueuedAgentTurns
                      sessionId={session().id}
                      runtimeState={value().session.runtimeState}
                      turns={value().turns}
                      onChanged={() => managedAgentStore.loadSnapshot(session().id)}
                      onError={setError}
                    />
                  </>
                )}
              </Show>
              {/* Gone while a subagent's run owns the window. The composer only ever addresses the
                  session, so leaving it under a subagent's transcript would read as "reply to this
                  subagent", which is not a thing either harness offers. The draft survives: it lives in
                  a module signal keyed by session (managedDrafts.ts) plus localStorage, not in the
                  component, so stepping into a subagent and back leaves half-typed text alone. */}
              <Show when={!selectedManagedSubagent(session().id)}>
                <AgentComposer
                  session={session()}
                  disabled={session().controller !== 'acorn' || session().runtimeState === 'archived'}
                  previousAutomaticContext={previousAutomaticContext()}
                  onSessionUpdated={managedAgentStore.upsertSession}
                  onSent={() => void managedAgentStore.loadSnapshot(session().id)}
                />
              </Show>
            </>
          )}
        </Show>

      </ListDetail>
      <Show when={dialog()?.kind === 'rename'}>
        <Modal onClose={() => setDialog(null)} title="Rename session" size="sm">
          <Modal.Body>
            <Field label="Title">
              <Input
                value={renameText()}
                ref={(el) => queueMicrotask(() => el.focus())}
                onInput={(event) => setRenameText(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void rename() }}
              />
            </Field>
          </Modal.Body>
          <Modal.Actions>
            <Button variant="bare" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="solid" onClick={() => void rename()}>Rename</Button>
          </Modal.Actions>
        </Modal>
      </Show>

      <Show when={dialog()?.kind === 'archive' ? dialog()!.session : undefined}>
        {(session) => (
          <Modal onClose={() => setDialog(null)} title="Archive session" size="sm" role="alertdialog">
            <Modal.Body>
              <p>Archive “{session().title}”? It leaves this task’s list and stays readable under the archived filter in Agent Center.</p>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="bare" onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="solid" onClick={() => void archive(session())}>Archive</Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>
    </section>
  )
}
