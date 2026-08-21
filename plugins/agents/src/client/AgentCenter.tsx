import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { activateTaskSignals, activeNodeId, createFleetQuery, nodes, pathForTask, readJson, setActiveNode, type Task, tasksOptions, workspaceForProject, workspacesOptions } from '@acorn/plugin-api/client'
import { tasksRoute } from '@acorn/protocol/api.ts'
import { isActiveAgent, needsAttention } from './agentActivity'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import { openManagedSession } from './managedSelection'
import type { AgentProviderDescriptor, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { Alert, EmptyState, Input, Row, SegmentedControl, Select, StatusDot } from '@acorn/plugin-api/ui'
import { providerTone, runtimeTone } from './stateTone'
import './agent-center.css'


const elapsed = (timestamp: number): string => {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1_440)}d`
}

// One row, whichever scope produced it. `nodeId` is always present: in workspace scope it is the
// active node, so `open` has one code path instead of branching on the scope that happened to be
// selected.
type AgentRow = { session: AgentSession; nodeId: string; nodeLabel: string; task: Task | undefined }

export default function AgentCenter() {
  const navigate = useNavigate()
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const activeWorkspace = createMemo(() =>
    workspaceForProject(workspaces.data, params.projectId))
  const workspaceId = createMemo(() => activeWorkspace()?.id ?? '')
  const workspaceProjectIds = createMemo(() => new Set(activeWorkspace()?.projects.map((project) => project.id) ?? []))
  const workspaceTasks = createMemo(() =>
    (tasks.data ?? []).filter((task) => workspaceProjectIds().has(task.projectId)))
  const workspaceTaskIds = createMemo(() => new Set(workspaceTasks().map((task) => task.id)))
  const [providers] = createResource(() => managedAgentApi.providers())
  const [query, setQuery] = createSignal('')
  const [scope, setScope] = createSignal<'workspace' | 'fleet'>('workspace')
  const fleetScope = () => scope() === 'fleet' && nodes().length > 1
  const [searchResults] = createResource(
    () => {
      const value = query().trim()
      const activeId = workspaceId()
      return value && activeId && !fleetScope() ? { value, activeId } : null
    },
    (target) => managedAgentApi.search(target.value, { workspaceId: target.activeId }),
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

  // The fleet halves. Sessions and tasks are two fan-outs because a row needs both: the session comes from
  // the agents plugin's route and the task title from core's, on the same node. A remote node's tasks are
  // not in `tasks.data`, which is the active node's own query.
  const [fleetSessions] = createFleetQuery(
    () => ['agents', 'sessions', 'fleet'] as const,
    async (nodeId, dep: boolean, signal) =>
      dep ? (await managedAgentApi.sessions({ archived: false }, { nodeId, signal })).sessions : [],
    fleetScope,
  )
  const [fleetTasks] = createFleetQuery(
    () => ['tasks', 'fleet'] as const,
    async (nodeId, dep: boolean, signal) => (dep ? await readJson<Task[]>(tasksRoute, { nodeId, signal }) : []),
    fleetScope,
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

  // Rows, in whichever scope is selected. Both branches produce the same shape, so everything downstream
  // (filters, counts, sort, open) is written once.
  const rows = createMemo<AgentRow[]>(() => {
    if (fleetScope()) {
      // Per node, because a task id is only meaningful on its own node (docs/architecture-overview.md § Fleet semantics:
      // two nodes may hold the same UUID). A single flat map would resolve one node's task title against
      // another node's session.
      const tasksByNode = new Map(
        fleetTasks().rows.map((row) => [row.nodeId, new Map(row.data.map((task) => [task.id, task]))]),
      )
      return fleetSessions().rows.flatMap((row) =>
        row.data.map((session) => ({
          session,
          nodeId: row.nodeId,
          nodeLabel: row.node.label,
          task: tasksByNode.get(row.nodeId)?.get(session.taskId),
        })),
      )
    }
    void workspaceSessions()
    const sessions = stateFilter() === 'archived'
      ? (archived() ?? [])
      : query().trim()
        ? (searchResults() ?? [])
        : managedAgentStore.sessions().filter((session) => !session.archivedAt && workspaceTaskIds().has(session.taskId))
    const active = activeNodeId() ?? ''
    return sessions.map((session) => ({ session, nodeId: active, nodeLabel: '', task: taskById().get(session.taskId) }))
  })

  const sourceSessions = createMemo(() => rows().map((row) => row.session))
  const shown = createMemo(() => {
    const needle = fleetScope() ? query().trim().toLowerCase() : ''
    return rows().filter(({ session, task }) => {
      if (providerFilter() && session.providerId !== providerFilter()) return false
      if (stateFilter() === 'active' && !isActiveAgent(session)) return false
      if (stateFilter() === 'attention' && !needsAttention(session)) return false
      // Fleet search is client-side over the fetched rows. The server search takes a workspaceId, which
      // only names a workspace on one node, so there is nothing to fan a server search out with.
      if (needle && !`${session.title} ${session.providerId} ${task?.title ?? ''} ${task?.github?.name ?? task?.projectId ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    }).sort((a, b) =>
      Number(needsAttention(b.session)) - Number(needsAttention(a.session)) || b.session.updatedAt - a.session.updatedAt,
    )
  })
  const unavailable = () => (fleetScope() ? fleetSessions().unavailable : [])

  function open(row: AgentRow) {
    if (!row.task) return setError('The session’s task is no longer available.')
    // The node switches first. Everything below resolves against the active node: `activateTaskSignals`
    // writes per-task client state, and `navigate` lands on a route the shell reads through the active
    // node's query cache. Opening a remote row without switching first would address the wrong machine, or
    // collide with a local task holding the same id.
    if (row.nodeId && row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
    activateTaskSignals(row.task, { pane: 'agents' })
    openManagedSession(row.task.id, row.session.id)
    navigate(pathForTask(row.task))
  }

  return (
    <main class="agent-center">
      <header class="agent-center-head">
        <div>
          <span class="agent-center-kicker">{fleetScope() ? 'Fleet' : 'Workspace'}</span>
          <h1>Agent Center</h1>
          <p>
            {fleetScope()
              ? 'Managed sessions across every paired node. Remote rows refresh on load rather than live.'
              : 'Managed Claude Code and Codex sessions across this workspace’s tasks and worktrees.'}
          </p>
        </div>
        <div class="agent-center-stats">
          <span><strong>{sourceSessions().filter((session) => isActiveAgent(session)).length}</strong> active</span>
          <span><strong>{sourceSessions().filter((session) => needsAttention(session)).length}</strong> need you</span>
          <span><strong>{sourceSessions().length}</strong> sessions</span>
        </div>
      </header>

      <Show when={error()}><Alert class="agent-center-error">{error()}</Alert></Show>

      {/* Partial node results remain visible while the unavailable-node banner explains the gap. */}
      <Show when={unavailable().length}>
        <For each={unavailable()}>
          {(entry) => <Alert tone="warn" variant="banner" class="agent-center-banner">{entry.label} unavailable — {entry.reason}</Alert>}
        </For>
      </Show>

      <section class="agent-center-providers">
        <For each={providers() ?? []}>
          {(provider: AgentProviderDescriptor) => (
            <div class="agent-center-provider" data-health={provider.installed ? provider.authenticated === false ? 'error' : 'ok' : 'missing'}>
              <StatusDot tone={providerTone(provider.installed ? provider.authenticated === false ? 'error' : 'ok' : 'missing')} />
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
        {/* With one node the workspace and fleet scopes answer identically, so the switch is unnecessary. */}
        <Show when={nodes().length > 1}>
          <SegmentedControl
            ariaLabel="Scope"
            size="sm"
            value={scope()}
            onChange={setScope}
            options={[
              { value: 'workspace', label: 'workspace' },
              { value: 'fleet', label: 'fleet' },
            ]}
          />
        </Show>
        <SegmentedControl
          ariaLabel="Session state"
          size="sm"
          value={stateFilter()}
          onChange={setStateFilter}
          options={(fleetScope()
            ? (['all', 'active', 'attention'] as const)
            : (['all', 'active', 'attention', 'archived'] as const)
          ).map((filter) => ({ value: filter, label: filter }))}
        />
      </section>

      <section class="agent-center-list">
        <div class="agent-center-list-head">
          <span>Session</span><span>Task</span><span>State</span><span>Updated</span>
        </div>
        <For
          each={shown()}
          fallback={<EmptyState icon={<span class="agent-empty-mark">✦</span>}>No sessions match these filters.</EmptyState>}
        >
          {(row) => {
            const session = row.session
            const task = () => row.task
            return (
              <Row class="agent-center-row" onActivate={() => open(row)}>
                <span class="agent-center-session">
                  <span class="agent-center-session-icon" data-provider={session.providerId}>{session.providerId === 'claude' ? 'C' : '⌘'}</span>
                  <span><strong>{session.title}</strong><small>{session.providerId} · {session.kind}</small></span>
                </span>
                <span>
                  <strong>{task()?.title ?? 'Missing task'}</strong>
                  <small>
                    {task() ? (task()!.github ? `${task()!.github!.owner}/${task()!.github!.name}` : task()!.projectId) : session.taskId}
                    {/* The node only when there is a fleet to disambiguate — otherwise it names the only
                        machine there is. */}
                    <Show when={row.nodeLabel}>{(label) => <> · {label()}</>}</Show>
                  </small>
                </span>
                <span class="agent-center-state">
                  <StatusDot tone={runtimeTone(session.runtimeState)} />
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
