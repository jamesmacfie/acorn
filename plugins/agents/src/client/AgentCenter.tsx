import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import {
  activateTaskSignals, activeNodeId, createFleetQuery, nodes, pathForTask, readJson, setActiveNode,
  type Task, tasksOptions, workspaceForProject, workspacesOptions,
} from '@acorn/plugin-api/client'
import { tasksRoute } from '@acorn/protocol/api.ts'
import { isActiveAgent, needsAttention } from './agentActivity'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import { openManagedSession } from './managedSelection'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import {
  Alert, Card, DetailColumn, EmptyState, Facts, Heading, Icon, Inline, Input, ListDetail, Row, Rows,
  SegmentedControl, Select, Stack, StatusDot, Text,
} from '@acorn/plugin-api/ui'
import RuntimeStateIcon from './RuntimeStateIcon'
import { providerTone } from './stateTone'

const elapsed = (timestamp: number): string => {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1_440)}d`
}

// One row, whichever scope produced it. `nodeId` is always present, the active node in workspace
// scope, so `open` has one code path instead of branching on the scope.
type AgentRow = { session: AgentSession; nodeId: string; nodeLabel: string; task: Task | undefined }

// The Agents rail source: every managed session in the workspace, or across the fleet.
//
// A `header-body` surface that is not a pane, so it takes the kit's one-column split as its box
// rather than a layout: a layout is a pane's arrangement and this is a source's
// (docs/panes.md § Layout model).
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
  // The harness's own glyph, falling back to the label's first letter. Deriving it from the provider
  // id draws Codex's mark for every harness that is not Claude.
  const providerGlyph = (providerId: string): string => {
    const provider = providers()?.find((candidate) => candidate.id === providerId)
    return provider?.glyph ?? (provider?.label ?? providerId).slice(0, 1).toUpperCase()
  }
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
    onCleanup(managedAgentStore.activate())
  })

  createEffect(on(workspaceId, () => {
    setError('')
  }, { defer: true }))

  const taskById = createMemo(() => new Map(workspaceTasks().map((task) => [task.id, task])))

  // Rows, in whichever scope is selected. Both branches produce the same shape, so the filters, counts,
  // sort, and open below are written once.
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
  // Two nodes may hold the same session id, so a row's key names both (docs/architecture-overview.md
  // § Fleet semantics).
  const rowKey = (row: AgentRow) => `${row.nodeId}:${row.session.id}`

  function open(row: AgentRow) {
    if (!row.task) return setError('The session’s task is no longer available.')
    // The node switches first, because everything below resolves against the active node.
    // `activateTaskSignals` writes per-task client state and `navigate` lands on a route the shell
    // reads through the active node's query cache. Opening a remote row without switching first
    // addresses the wrong machine, or collides with a local task holding the same id.
    if (row.nodeId && row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
    activateTaskSignals(row.task, { pane: 'agents' })
    openManagedSession(row.task.id, row.session.id)
    navigate(pathForTask(row.task))
  }

  return (
    <ListDetail>
      <DetailColumn scroll>
        <Stack gap="section">
          <Inline wrap>
            <Heading level={1} eyebrow={fleetScope() ? 'Fleet' : 'Workspace'}>Agent Center</Heading>
            <Facts
              items={[
                { label: 'active', value: String(sourceSessions().filter((session) => isActiveAgent(session)).length) },
                { label: 'need you', value: String(sourceSessions().filter((session) => needsAttention(session)).length) },
                { label: 'sessions', value: String(sourceSessions().length) },
              ]}
            />
          </Inline>
          <Text emphasis="muted" wrap>
            {fleetScope()
              ? 'Managed sessions across every paired node. Remote rows refresh on load rather than live.'
              : 'Managed Claude Code and Codex sessions across this workspace’s tasks and worktrees.'}
          </Text>

          <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>

          {/* Partial node results remain visible while the unavailable-node banner explains the gap. */}
          <For each={unavailable()}>
            {(entry) => <Alert tone="warn" variant="banner">{entry.label} unavailable — {entry.reason}</Alert>}
          </For>

          <Inline wrap>
            <For each={providers() ?? []}>
              {(provider) => (
                <Card pad="sm">
                  <Inline>
                    <StatusDot
                      tone={providerTone(provider.installed ? provider.authenticated === false ? 'error' : 'ok' : 'missing')}
                      label={provider.installed ? provider.authenticated === false ? 'Authentication required' : 'Available' : 'Not installed'}
                    />
                    <Stack gap="none">
                      <Text emphasis="strong">{provider.label}</Text>
                      <Text emphasis="muted">{provider.executableVersion ?? provider.driverVersion}</Text>
                    </Stack>
                  </Inline>
                </Card>
              )}
            </For>
          </Inline>

          {/* Not a `Toolbar`: this is a page, and a toolbar is a chrome strip with a background and a
              rule that reaches the surface's edges. In the middle of a padded column it read as a
              stray band. */}
          <Inline wrap gap="row">
            <Input
              type="search"
              value={query()}
              label="Search sessions"
              placeholder="Search sessions, tasks and repositories…"
              onInput={(value) => setQuery(value)}
            />
            <Select
              label="Provider"
              width="auto"
              value={providerFilter()}
              onChange={(value) => setProviderFilter(value)}
              options={[
                { value: '', label: 'All providers' },
                ...(providers() ?? []).map((provider) => ({ value: provider.id, label: provider.label })),
              ]}
            />
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
          </Inline>

          <Show
            when={shown().length}
            fallback={
              <EmptyState icon={<Icon name="sparkles" tone="accent" />}>
                No sessions match these filters.
              </EmptyState>
            }
          >
            <Card pad="sm">
              <Rows
                id="agents:center"
                ariaLabel="Managed sessions"
                items={shown().map((row) => ({ key: rowKey(row), label: row.session.title }))}
                onActivate={(key) => {
                  const row = shown().find((candidate) => rowKey(candidate) === key)
                  if (row) open(row)
                }}
              >
                {(item, itemProps) => {
                  const row = () => shown().find((candidate) => rowKey(candidate) === item.key)
                  return (
                    <Show when={row()}>
                      {(current) => (
                        <Row
                          item={itemProps}
                          variant="stacked"
                          leading={<Icon name={providerGlyph(current().session.providerId)} tone="brand" />}
                          meta={
                            <>
                              <Inline>
                                <RuntimeStateIcon state={current().session.runtimeState} />
                                <Text emphasis="muted">
                                  {current().session.runtimeState}
                                  {current().session.attention === 'none'
                                    ? ''
                                    : ` · ${current().session.attention.replace('_', ' ')}`}
                                </Text>
                              </Inline>
                              <Text emphasis="muted">{elapsed(current().session.updatedAt)}</Text>
                            </>
                          }
                          metaFields={2}
                          onPress={() => open(current())}
                        >
                          <Text emphasis="strong">{current().session.title}</Text>
                          <Text emphasis="muted">
                            {current().session.providerId} · {current().session.kind} ·{' '}
                            {current().task?.title ?? 'Missing task'}
                            {/* The node only when there is a fleet to disambiguate — otherwise it names
                                the only machine there is. */}
                            {current().nodeLabel ? ` · ${current().nodeLabel}` : ''}
                          </Text>
                        </Row>
                      )}
                    </Show>
                  )
                }}
              </Rows>
            </Card>
          </Show>
        </Stack>
      </DetailColumn>
    </ListDetail>
  )
}
