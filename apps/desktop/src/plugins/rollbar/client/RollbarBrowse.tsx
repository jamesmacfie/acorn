import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, rollbarItemsOptions, tasksKey, tasksOptions, workspaceProjectsKey, workspaceProjectsOptions, workspacesOptions } from '../../../core/client/queries'
import type { Integration, RollbarItemSummary, Task, WorkspaceProject } from '../../../core/shared/api'
import { sourceRegistry, type SourceContribution } from '../../../core/client/registries/sources'
import { activeTaskId } from '../../../core/client/tasks/tasks'
import { activateTaskSignals, pathForTask } from '../../../core/client/tasks/activate'
import { PromoteToTaskModal } from '../../../core/client/integrations/PromoteToTaskModal'
import { workspaceForRepo } from '../../../core/client/workspaces/activeWorkspace'
import { replaceWorkspaceProjectsForProvider, workspaceProjectsForProvider } from '../../../core/client/integrations/workspaceProjects'
import { setWorkspaceProjects } from '../../../core/client/workspaces/mutations'
import { emptyRollbarFilter, filterRollbarItems, isRegressed, rollbarFacets, sortRollbarItems, type RollbarFilter, type RollbarSortOrder } from './model'
import RollbarItemPanel, { type RollbarTarget } from './RollbarItemPanel'
import './rollbar.css'

const relTime = (at: number | null): string => {
  if (!at) return ''
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

const itemKey = (i: { integrationId: string; identifier: string }) => `${i.integrationId}:${i.identifier}`
const projectKey = (project: WorkspaceProject) => `${project.integrationId}:${project.externalId}`

// The Rollbar Source browse (docs/integrations.md): a two-column master/detail. The left column lists
// active items across projects mapped to the routed workspace; selection opens detail on the right.
// Row click only selects — the +TASK action (create a new task or attach to an existing one) is explicit.
export default function RollbarBrowse() {
  const navigate = useNavigate()
  const params = useParams()
  const qc = useQueryClient()
  const workspaces = createQuery(() => workspacesOptions(true))
  const workspace = () => workspaceForRepo(workspaces.data, params.owner, params.repo)
  const workspaceId = () => workspace()?.id ?? null
  const linked = createQuery(() => workspaceProjectsOptions(workspaceId(), true))
  const integrations = createQuery(() => integrationsOptions(true))
  const allLinkedProjects = () => linked.data?.projects ?? []
  const connections = () => integrations.data?.integrations ?? []
  const rollbarConnections = () => connections().filter((connection) => connection.providerId === 'rollbar')
  const linkedProjects = () => workspaceProjectsForProvider(allLinkedProjects(), connections(), 'rollbar')
  const linkedConnectionIds = () => linkedProjects().map((project) => project.integrationId)
  const tasks = createQuery(() => tasksOptions(true))
  const items = createQuery(() => rollbarItemsOptions(linkedConnectionIds(), linkedConnectionIds().length > 0))

  const rows = () => items.data?.items ?? []
  const facets = createMemo(() => rollbarFacets(rows()))
  const [filter, setFilter] = createSignal<RollbarFilter>(emptyRollbarFilter)
  const [sort, setSort] = createSignal<RollbarSortOrder>('recent')
  const patch = (part: Partial<RollbarFilter>) => setFilter((f) => ({ ...f, ...part }))
  const visible = createMemo(() => sortRollbarItems(filterRollbarItems(rows(), filter()), sort()))

  const [selected, setSelected] = createSignal<RollbarTarget | null>(null)
  const isSelected = (i: RollbarItemSummary) => selected() !== null && targetKeyEq(selected()!, i)
  const selectedSummary = () => rows().find((i) => selected() !== null && targetKeyEq(selected()!, i))
  // Selection/filter state is session-only and scoped to the routed repo; reset both when a repo
  // switch changes the workspace mapping so an old connection filter cannot hide the new list.
  createEffect(on(() => `${params.owner ?? ''}/${params.repo ?? ''}`, () => {
    setSelected(null)
    setFilter(emptyRollbarFilter)
    setSort('recent')
  }, { defer: true }))

  // Rollbar project picker — one Rollbar connection represents one project. Mappings live at the
  // workspace boundary, matching Linear, and scope both browsing and the repo used for promotion.
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [pickerOpening, setPickerOpening] = createSignal(false)
  const [pickerError, setPickerError] = createSignal('')
  const [checked, setChecked] = createSignal<Set<string>>(new Set())
  const projectForConnection = (connection: Integration): WorkspaceProject => ({
    integrationId: connection.id,
    externalId: connection.account?.id ?? connection.id,
  })
  async function openPicker() {
    if (pickerOpening()) return
    setPickerError('')
    setPickerOpening(true)
    try {
      const result = await integrations.refetch()
      if (result.isError) {
        setPickerError('Could not refresh Rollbar projects. Check the connections and try again.')
        return
      }
      setChecked(new Set(linkedProjects().map(projectKey)))
      setPickerOpen(true)
    } finally {
      setPickerOpening(false)
    }
  }
  function toggleProject(key: string) {
    const next = new Set(checked())
    next.has(key) ? next.delete(key) : next.add(key)
    setChecked(next)
  }
  async function savePicker() {
    const id = workspaceId()
    if (!id) return setPickerOpen(false)
    const chosen = rollbarConnections()
      .map(projectForConnection)
      .filter((project) => checked().has(projectKey(project)))
    await setWorkspaceProjects(
      id,
      replaceWorkspaceProjectsForProvider(allLinkedProjects(), connections(), 'rollbar', chosen),
    )
    await qc.invalidateQueries({ queryKey: workspaceProjectsKey(id) })
    setSelected(null)
    setPickerOpen(false)
  }

  // +TASK: the create-or-attach modal. Selecting an item opens it; the project mapping supplies the
  // repo (docs/workspaces-and-tasks.md — one task, many linked errors).
  const [promoteItem, setPromoteItem] = createSignal<RollbarItemSummary | null>(null)
  const [attachMessage, setAttachMessage] = createSignal('')

  // Active tasks eligible to attach to: scoped to the routed workspace, matching the rail roster.
  const attachTasks = () => {
    const inWs = new Set((workspace()?.repos ?? []).map((r) => `${r.owner}/${r.name}`))
    return (tasks.data ?? []).filter((t) => t.status === 'active' && (inWs.size === 0 || inWs.has(`${t.repoOwner}/${t.repoName}`)))
  }

  async function promote(item: RollbarItemSummary) {
    // Focus an existing active task for the same (connection, counter) instead of duplicating it.
    const existing = (await qc.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[]))
      .find((t) => t.status === 'active' && t.links.some((l) => l.providerId === 'rollbar' && l.connectionId === item.integrationId && l.identifier === item.identifier))
    if (existing) {
      activateTaskSignals(existing, { pane: 'rollbar' })
      return navigate(pathForTask(existing))
    }
    setPromoteItem(item)
  }

  function afterPromote(w: Task) {
    setPromoteItem(null)
    void qc.invalidateQueries({ queryKey: tasksKey })
    activateTaskSignals(w, { pane: 'rollbar' })
    navigate(pathForTask(w))
  }

  // Rollbar's most common flow: the error belongs to the task you're already on.
  async function attach() {
    const item = selectedSummary()
    const taskId = activeTaskId()
    if (!item) return
    setAttachMessage('')
    if (!taskId) return setAttachMessage('No active task — open one first, or use +TASK.')
    const promotion = (sourceRegistry.get('rollbar') as SourceContribution<RollbarItemSummary>).promotion
    if (!promotion.attachToCurrentTask) return
    await promotion.attachToCurrentTask(taskId, item)
    await qc.invalidateQueries({ queryKey: tasksKey })
    setAttachMessage('Attached to the current task.')
  }

  const hasActiveTask = () => activeTaskId() != null

  return (
    <main class="panes rollbar-browse-panes">
      <section class="pane pane-left rollbar-browse">
        <div class="section-header">
          Rollbar{workspace() ? ` · ${workspace()!.name}` : ''}
          <span class="rollbar-header-actions">
            <Show when={workspaceId()}>
              <button type="button" class="new-pr-btn" title="Choose Rollbar projects for this workspace" disabled={pickerOpening()} onClick={() => void openPicker()}>
                {pickerOpening() ? 'Refreshing…' : `Projects${linkedProjects().length ? ` (${linkedProjects().length})` : ''}`}
              </button>
            </Show>
            <button type="button" class="new-pr-btn" disabled={!linkedProjects().length || items.isFetching} onClick={() => void items.refetch()}>
              {items.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </span>
        </div>
        <Show when={pickerError()}><div class="action-error" role="alert">{pickerError()}</div></Show>

        <Show when={workspaceId()} fallback={<p class="placeholder">Select a workspace to browse its Rollbar errors.</p>}>
          <Show
            when={linkedProjects().length}
            fallback={
              <div class="workspace-empty-inner">
                <p class="muted">No Rollbar projects linked to {workspace()?.name}.</p>
                <button type="button" class="overlay-btn" disabled={pickerOpening()} onClick={() => void openPicker()}>
                  {pickerOpening() ? 'Refreshing projects…' : 'Choose projects'}
                </button>
              </div>
            }
          >
            <div class="rollbar-filters">
              <input class="rollbar-search" type="text" placeholder="Search title / #counter" value={filter().search} onInput={(e) => patch({ search: e.currentTarget.value })} />
              <Show when={facets().connections.length > 1}>
                <select value={filter().connectionId} onChange={(e) => patch({ connectionId: e.currentTarget.value })}>
                  <option value="">All projects</option>
                  <For each={facets().connections}>{(c) => <option value={c.id}>{c.label}</option>}</For>
                </select>
              </Show>
              <select value={filter().level} onChange={(e) => patch({ level: e.currentTarget.value })}>
                <option value="">All levels</option>
                <For each={facets().levels}>{(l) => <option value={l}>{l}</option>}</For>
              </select>
              <select value={filter().environment} onChange={(e) => patch({ environment: e.currentTarget.value })}>
                <option value="">All envs</option>
                <For each={facets().environments}>{(env) => <option value={env}>{env}</option>}</For>
              </select>
              <select value={sort()} onChange={(e) => setSort(e.currentTarget.value as RollbarSortOrder)} title="Sort order">
                <option value="recent">Last seen</option>
                <option value="occurrences">Occurrences</option>
                <option value="level">Level</option>
              </select>
            </div>

            <Show when={(items.data?.failures ?? []).length}>
              <div class="action-error" role="alert">{items.data!.failures.length} Rollbar connection(s) failed; showing what loaded.</div>
            </Show>
            <Show when={(items.data?.cappedIntegrationIds ?? []).length}>
              <div class="rollbar-capped" role="status">Showing the 300 most recent active items per capped project.</div>
            </Show>

            <Show when={!items.isPending} fallback={<p class="placeholder">Loading…</p>}>
              <Show when={rows().length} fallback={<p class="placeholder">{items.isError ? 'Could not load Rollbar items.' : 'No active items.'}</p>}>
                <Show when={visible().length} fallback={<p class="placeholder">No items match the current filters.</p>}>
                  <ul class="rollbar-list">
                    <For each={visible()}>
                      {(item) => (
                        <li>
                          <div
                            class="rollbar-row"
                            classList={{ active: isSelected(item) }}
                            role="button"
                            tabindex="0"
                            aria-pressed={isSelected(item)}
                            onClick={() => setSelected({ connectionId: item.integrationId, identifier: item.identifier })}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                              event.preventDefault()
                              setSelected({ connectionId: item.integrationId, identifier: item.identifier })
                            }}
                          >
                            <span class="rollbar-level" data-level={item.level}>✗ {item.level}</span>
                            <span class="rollbar-row-title">{item.title}</span>
                            <Show when={isRegressed(item)}><span class="rollbar-regressed-chip" title="Resolved and came back">regressed</span></Show>
                            <Show when={facets().connections.length > 1}><span class="rollbar-row-conn muted">{item.integrationLabel}</span></Show>
                            <span class="rollbar-row-meta muted">×{item.totalOccurrences} · {item.environment} · {relTime(item.lastOccurrenceAt)}</span>
                            <button
                              type="button"
                              class="rollbar-ws-btn"
                              title="New task or attach to an existing one"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                void promote(item)
                              }}
                            >
                              +TASK
                            </button>
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
      </section>

      <section class="pane pane-right rollbar-browse-detail">
        <Show when={selected()} fallback={<div class="pane-empty"><p class="placeholder">Select an item.</p></div>}>
          {(target) => (
            <RollbarItemPanel
              variant="detail"
              target={target()}
              summary={selectedSummary()}
              actions={
                <>
                  <button
                    type="button"
                    class="overlay-btn"
                    disabled={!hasActiveTask()}
                    title={hasActiveTask() ? 'Attach this item to the active task' : 'No active task — open one first'}
                    onClick={() => void attach()}
                  >
                    Attach to current task
                  </button>
                  <Show when={selectedSummary()}>{(item) => <button type="button" class="overlay-btn" onClick={() => void promote(item())}>+TASK</button>}</Show>
                  <Show when={attachMessage()}><span class="muted" role="status">{attachMessage()}</span></Show>
                </>
              }
            />
          )}
        </Show>
      </section>

      <Show when={promoteItem()}>
        {(item) => (
          <PromoteToTaskModal
            providerId="rollbar"
            item={item()}
            headerLabel={`+TASK — #${item().identifier}`}
            itemTitle={item().title}
            attachTasks={attachTasks()}
            existingBranches={(tasks.data ?? []).map((t) => t.branch)}
            onClose={() => setPromoteItem(null)}
            onCreated={afterPromote}
            onAttached={afterPromote}
          />
        )}
      </Show>

      <Show when={pickerOpen()}>
        <div class="overlay-backdrop" onClick={() => setPickerOpen(false)}>
          <div class="overlay" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div class="overlay-title">Rollbar projects — {workspace()?.name}</div>
            <div class="overlay-body">
              <Show when={rollbarConnections().length} fallback={<p class="muted">No Rollbar projects are connected. Add one in Settings → Integrations.</p>}>
                <ul class="rollbar-project-picker">
                  <For each={rollbarConnections()}>
                    {(connection) => {
                      const project = () => projectForConnection(connection)
                      return (
                        <li>
                          <label>
                            <input
                              type="checkbox"
                              checked={checked().has(projectKey(project()))}
                              onChange={() => toggleProject(projectKey(project()))}
                            />
                            {connection.label}
                            <Show when={connection.status !== 'connected'}><span class="muted"> · {connection.status}</span></Show>
                          </label>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </Show>
              <div class="integration-key-row" style={{ 'justify-content': 'flex-end' }}>
                <button type="button" class="overlay-btn" onClick={() => void savePicker()}>Save</button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </main>
  )
}

const targetKeyEq = (t: RollbarTarget, i: { integrationId: string; identifier: string }) => targetKey(t) === itemKey(i)
const targetKey = (t: RollbarTarget) => `${t.connectionId}:${t.identifier}`
