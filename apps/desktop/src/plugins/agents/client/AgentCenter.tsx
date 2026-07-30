import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { tasksOptions, workspacesOptions } from '../../../core/client/queries'
import { activateTaskSignals, pathForTask } from '../../../core/client/tasks/activate'
import { workspaceForRepo } from '../../../core/client/workspaces/activeWorkspace'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import { openManagedSession } from './managedSelection'
import type { AgentProviderDescriptor, AgentSession } from '../../../core/shared/managedAgents'
import { Button, Input, Row, Select } from '../../../core/client/ui/primitives'
import './agent-center.css'

const ACTIVE_STATES = new Set(['creating', 'connecting', 'replaying', 'working', 'waiting', 'cancelling', 'reconnecting'])

const elapsed = (timestamp: number): string => {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1_440)}d`
}

export default function AgentCenter() {
  const navigate = useNavigate()
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const activeWorkspace = createMemo(() =>
    workspaceForRepo(workspaces.data, params.owner, params.repo))
  const workspaceId = createMemo(() => activeWorkspace()?.id ?? '')
  const workspaceRepoKeys = createMemo(() =>
    new Set((activeWorkspace()?.repos ?? []).map((repo) => `${repo.owner}/${repo.name}`)))
  const workspaceTasks = createMemo(() =>
    (tasks.data ?? []).filter((task) => workspaceRepoKeys().has(`${task.repoOwner}/${task.repoName}`)))
  const workspaceTaskIds = createMemo(() => new Set(workspaceTasks().map((task) => task.id)))
  const [providers] = createResource(() => managedAgentApi.providers())
  const [query, setQuery] = createSignal('')
  const [searchResults] = createResource(
    () => {
      const value = query().trim()
      const activeId = workspaceId()
      return value && activeId ? { value, activeId } : null
    },
    (scope) => managedAgentApi.search(scope.value, { workspaceId: scope.activeId }),
  )
  const [workspaceSessions] = createResource(
    workspaceId,
    async (activeId) => {
      if (!activeId) return []
      const page = await managedAgentApi.sessions({ workspaceId: activeId, archived: false })
      page.sessions.forEach(managedAgentStore.upsertSession)
      return page.sessions
    },
  )
  const [archived] = createResource(
    workspaceId,
    async (activeId) => activeId
      ? (await managedAgentApi.sessions({ workspaceId: activeId, archived: true })).sessions
      : [],
  )
  const [providerFilter, setProviderFilter] = createSignal('')
  const [stateFilter, setStateFilter] = createSignal<'all' | 'active' | 'attention' | 'archived'>('all')
  const [error, setError] = createSignal('')

  onMount(() => {
    const deactivate = managedAgentStore.activate()
    onCleanup(deactivate)
  })

  createEffect(on(workspaceId, () => {
    setError('')
  }, { defer: true }))

  const taskById = createMemo(() => new Map(workspaceTasks().map((task) => [task.id, task])))
  const sourceSessions = createMemo(() => {
    void workspaceSessions()
    if (stateFilter() === 'archived') return archived() ?? []
    if (query().trim()) return searchResults() ?? []
    return managedAgentStore.sessions().filter((session) =>
      !session.archivedAt && workspaceTaskIds().has(session.taskId))
  })
  const shown = createMemo(() => {
    return sourceSessions().filter((session) => {
      if (providerFilter() && session.providerId !== providerFilter()) return false
      if (stateFilter() === 'active' && !ACTIVE_STATES.has(session.runtimeState)) return false
      if (stateFilter() === 'attention' && ['none', 'unread'].includes(session.attention)) return false
      return true
    }).sort((a, b) => {
      const aNeeds = !['none', 'unread'].includes(a.attention)
      const bNeeds = !['none', 'unread'].includes(b.attention)
      return Number(bNeeds) - Number(aNeeds) || b.updatedAt - a.updatedAt
    })
  })
  function open(session: AgentSession) {
    const task = taskById().get(session.taskId)
    if (!task) return setError('The session’s task is no longer available.')
    activateTaskSignals(task, { pane: 'agents' })
    openManagedSession(task.id, session.id)
    navigate(pathForTask(task))
  }

  return (
    <main class="agent-center">
      <header class="agent-center-head">
        <div>
          <span class="agent-center-kicker">Workspace</span>
          <h1>Agent Center</h1>
          <p>Managed Claude Code and Codex sessions across this workspace’s tasks and worktrees.</p>
        </div>
        <div class="agent-center-stats">
          <span><strong>{sourceSessions().filter((session) => ACTIVE_STATES.has(session.runtimeState)).length}</strong> active</span>
          <span><strong>{sourceSessions().filter((session) => !['none', 'unread'].includes(session.attention)).length}</strong> need you</span>
          <span><strong>{sourceSessions().length}</strong> sessions</span>
        </div>
      </header>

      <Show when={error()}><div class="action-error agent-center-error" role="alert">{error()}</div></Show>

      <section class="agent-center-providers">
        <For each={providers() ?? []}>
          {(provider: AgentProviderDescriptor) => (
            <div class="agent-center-provider" data-health={provider.installed ? provider.authenticated === false ? 'error' : 'ok' : 'missing'}>
              <span class="agent-center-provider-dot" />
              <span><strong>{provider.label}</strong><small>{provider.executableVersion ?? provider.driverVersion}</small></span>
              <span class="muted">{provider.installed ? provider.authenticated === false ? 'Authentication required' : 'Available' : 'Not installed'}</span>
            </div>
          )}
        </For>
      </section>

      <section class="agent-center-filters">
        <Input type="search" value={query()} placeholder="Search sessions, tasks and repositories…" onInput={(event) => setQuery(event.currentTarget.value)} />
        <Select value={providerFilter()} onChange={(event) => setProviderFilter(event.currentTarget.value)}>
          <option value="">All providers</option>
          <For each={providers() ?? []}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For>
        </Select>
        <div class="agent-center-segments">
          <For each={['all', 'active', 'attention', 'archived'] as const}>
            {(filter) => (
              <Button
                variant="bare"
                size="sm"
                classList={{ active: stateFilter() === filter }}
                onClick={() => setStateFilter(filter)}
              >
                {filter}
              </Button>
            )}
          </For>
        </div>
      </section>

      <section class="agent-center-list">
        <div class="agent-center-list-head">
          <span>Session</span><span>Task</span><span>State</span><span>Updated</span>
        </div>
        <For
          each={shown()}
          fallback={<div class="agent-center-empty"><span>✦</span><p>No sessions match these filters.</p></div>}
        >
          {(session) => {
            const task = () => taskById().get(session.taskId)
            return (
              <Row class="agent-center-row" onActivate={() => open(session)}>
                <span class="agent-center-session">
                  <span class="agent-center-session-icon" data-provider={session.providerId}>{session.providerId === 'claude' ? 'C' : '⌘'}</span>
                  <span><strong>{session.title}</strong><small>{session.providerId} · {session.kind}</small></span>
                </span>
                <span><strong>{task()?.title ?? 'Missing task'}</strong><small>{task() ? `${task()!.repoOwner}/${task()!.repoName}` : session.taskId}</small></span>
                <span class="agent-center-state">
                  <span data-state={session.runtimeState} />
                  <span>{session.runtimeState}<small>{session.attention === 'none' ? '' : session.attention.replace('_', ' ')}</small></span>
                </span>
                <span class="muted">{elapsed(session.updatedAt)}</span>
              </Row>
            )
          }}
        </For>
      </section>
    </main>
  )
}
