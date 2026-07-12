import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { integrationsOptions, linearProjectsOptions, tasksKey, tasksOptions, workspaceProjectsKey, workspaceProjectsOptions, workspaceLinearIssuesOptions, workspacesOptions } from '../../../core/client/queries'
import { setWorkspaceProjects } from '../../../core/client/workspaces/mutations'
import type { LinearProjectIssue, Task, WorkspaceProject } from '../../../core/shared/api'
import { workspaceForRepo } from '../../../core/client/workspaces/activeWorkspace'
import { activateTaskSignals, pathForTask } from '../../../core/client/tasks/activate'
import { replaceWorkspaceProjectsForProvider, workspaceProjectsForProvider } from '../../../core/client/integrations/workspaceProjects'
import { PromoteToTaskModal } from '../../../core/client/integrations/PromoteToTaskModal'
import { formatRelativeTime } from '../../../core/client/lib/formatRelativeTime'
import { emptyLinearFilter, filterLinearIssues, groupLinearIssuesByState, linearFacets, priorityMeta, sortLinearIssues, type LinearFilter } from './model'
import LinearIssuePanel from './LinearIssuePanel'

// The Linear Source browse (docs/workspaces-and-tasks.md). Linear projects are linked at the WORKSPACE level
// and may span several connected Linear workspaces; each linked project is an (integrationId,
// externalId) pair. Issues are scoped to the workspace's linked projects; selecting one opens its
// detail, while the row's explicit action promotes it to a task on the current repo.
const projKey = (p: WorkspaceProject) => `${p.integrationId}:${p.externalId}`
const issueKey = (issue: LinearProjectIssue) => `${issue.integrationId}:${issue.identifier}`

export default function LinearBrowse() {
  const navigate = useNavigate()
  const params = useParams()
  const qc = useQueryClient()
  const workspaces = createQuery(() => workspacesOptions(true))
  const ws = () => workspaceForRepo(workspaces.data, params.owner, params.repo)
  const wsId = () => ws()?.id ?? null

  const linked = createQuery(() => workspaceProjectsOptions(wsId(), true))
  const integrations = createQuery(() => integrationsOptions(true))
  const allLinkedProjects = () => linked.data?.projects ?? []
  const connections = () => integrations.data?.integrations ?? []
  const linkedProjects = () => workspaceProjectsForProvider(allLinkedProjects(), connections(), 'linear')
  const issues = createQuery(() => workspaceLinearIssuesOptions(linkedProjects(), linkedProjects().length > 0))
  const allIssues = () => issues.data?.issues ?? []
  const facets = createMemo(() => linearFacets(allIssues()))
  const [selectedIssue, setSelectedIssue] = createSignal<LinearProjectIssue | null>(null)
  const isSelected = (issue: LinearProjectIssue) => {
    const selected = selectedIssue()
    return selected !== null && issueKey(selected) === issueKey(issue)
  }

  // Triage is client-side over the one browse fetch (mirrors the Rollbar browse). Filter → sort by
  // priority/recency → group by workflow-state.
  const [filter, setFilter] = createSignal<LinearFilter>(emptyLinearFilter)
  const patch = (part: Partial<LinearFilter>) => setFilter((f) => ({ ...f, ...part }))
  const groups = createMemo(() => groupLinearIssuesByState(sortLinearIssues(filterLinearIssues(allIssues(), filter()))))

  // ponytail: local selection signal, add a route param only if issues need deep-linking.
  // The source component survives repo navigation, so explicitly keep this session-only selection
  // (and the filter) scoped to the routed repo rather than carrying state from the workspace we left.
  createEffect(on(
    () => `${params.owner ?? ''}/${params.repo ?? ''}`,
    () => {
      setSelectedIssue(null)
      setFilter(emptyLinearFilter)
    },
    { defer: true },
  ))

  // Project picker — lists projects across every connected Linear, tagged by connection.
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [pickerOpening, setPickerOpening] = createSignal(false)
  const [pickerError, setPickerError] = createSignal('')
  const projects = createQuery(() => linearProjectsOptions(pickerOpen()))
  const [checked, setChecked] = createSignal<Set<string>>(new Set())
  async function openPicker() {
    if (pickerOpening()) return
    setPickerError('')
    setPickerOpening(true)
    try {
      // The picker must make its empty-state decision from a live Linear read, not the
      // five-minute client cache. Manual refetch works while the query is disabled.
      const [projectResult, integrationResult] = await Promise.all([projects.refetch(), integrations.refetch()])
      if (projectResult.isError || integrationResult.isError) {
        setPickerError('Could not refresh Linear projects. Check the connection and try again.')
        return
      }
      setChecked(new Set(linkedProjects().map(projKey)))
      setPickerOpen(true)
    } finally {
      setPickerOpening(false)
    }
  }
  function toggle(key: string) {
    const s = new Set(checked())
    s.has(key) ? s.delete(key) : s.add(key)
    setChecked(s)
  }
  async function savePicker() {
    const id = wsId()
    if (!id) return setPickerOpen(false)
    const chosen = (projects.data?.projects ?? [])
      .filter((p) => checked().has(`${p.integrationId}:${p.id}`))
      .map((p) => ({ integrationId: p.integrationId, externalId: p.id }))
    await setWorkspaceProjects(id, replaceWorkspaceProjectsForProvider(allLinkedProjects(), connections(), 'linear', chosen))
    await qc.invalidateQueries({ queryKey: workspaceProjectsKey(id) })
    setPickerOpen(false)
  }

  // +TASK: the create-or-attach modal (docs/workspaces-and-tasks.md — one task, many linked tickets).
  const tasks = createQuery(() => tasksOptions(true))
  const [promoteIssue, setPromoteIssue] = createSignal<LinearProjectIssue | null>(null)

  // Active tasks eligible to attach to: scoped to the routed workspace, matching the rail roster.
  const attachTasks = () => {
    const inWs = new Set((ws()?.repos ?? []).map((r) => `${r.owner}/${r.name}`))
    return (tasks.data ?? []).filter((t) => t.status === 'active' && (inWs.size === 0 || inWs.has(`${t.repoOwner}/${t.repoName}`)))
  }

  async function promote(it: LinearProjectIssue) {
    const { owner, repo } = params
    if (!owner || !repo) return
    // If a task for this ticket already exists, focus it instead of creating a duplicate.
    const existing = (await qc.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[]))
      .find((t) => t.status === 'active' && t.links.some((l) => l.providerId === 'linear' && l.connectionId === it.integrationId && l.identifier === it.identifier))
    if (existing) {
      activateTaskSignals(existing, { pane: 'linear' })
      return navigate(pathForTask(existing))
    }
    setPromoteIssue(it)
  }

  function afterPromote(w: Task) {
    setPromoteIssue(null)
    void qc.invalidateQueries({ queryKey: tasksKey })
    activateTaskSignals(w, { pane: 'linear' }) // a promoted ticket lands on its Linear pane
    navigate(pathForTask(w))
  }

  return (
    <main class="panes linear-browse-panes">
      <section class="pane pane-left linear-browse">
        <div class="section-header">
          Linear{ws() ? ` · ${ws()!.name}` : ''}
          <Show when={wsId()}>
            <button type="button" class="new-pr-btn" title="Choose Linear projects for this workspace" disabled={pickerOpening()} onClick={() => void openPicker()}>
              {pickerOpening() ? 'Refreshing…' : `Projects${linkedProjects().length ? ` (${linkedProjects().length})` : ''}`}
            </button>
          </Show>
        </div>
        <Show when={pickerError()}><div class="action-error" role="alert">{pickerError()}</div></Show>

        <Show when={wsId()} fallback={<p class="placeholder">Select a workspace to browse its Linear issues.</p>}>
          <Show
            when={linkedProjects().length}
            fallback={
              <div class="workspace-empty-inner">
                <p class="muted">No Linear projects linked to {ws()?.name}.</p>
                <button type="button" class="overlay-btn" disabled={pickerOpening()} onClick={() => void openPicker()}>
                  {pickerOpening() ? 'Refreshing projects…' : 'Choose projects'}
                </button>
              </div>
            }
          >
            <Show when={!issues.isPending} fallback={<p class="placeholder">Loading…</p>}>
              <Show when={allIssues().length} fallback={<p class="placeholder">No active issues in the selected project(s).</p>}>
                <div class="linear-filters">
                  <input
                    class="linear-search"
                    type="text"
                    placeholder="Search title / ENG-…"
                    value={filter().search}
                    onInput={(e) => patch({ search: e.currentTarget.value })}
                  />
                  <Show when={facets().assignees.length > 1}>
                    <select value={filter().assignee} onChange={(e) => patch({ assignee: e.currentTarget.value })}>
                      <option value="">All assignees</option>
                      <For each={facets().assignees}>{(a) => <option value={a}>{a}</option>}</For>
                    </select>
                  </Show>
                  <Show when={facets().labels.length > 0}>
                    <select value={filter().label} onChange={(e) => patch({ label: e.currentTarget.value })}>
                      <option value="">All labels</option>
                      <For each={facets().labels}>{(l) => <option value={l}>{l}</option>}</For>
                    </select>
                  </Show>
                </div>
                <Show when={groups().length} fallback={<p class="placeholder">No issues match the current filters.</p>}>
                  <ul class="linear-browse-list">
                    <For each={groups()}>
                      {(group) => (
                        <>
                          <li class="linear-browse-group">
                            <span>{group.label}</span>
                            <span class="linear-browse-group-count">{group.issues.length}</span>
                          </li>
                          <For each={group.issues}>
                            {(it) => {
                              const prio = priorityMeta(it.priority, it.priorityLabel)
                              return (
                                <li>
                                  <div
                                    class="linear-browse-row"
                                    classList={{ active: isSelected(it) }}
                                    role="button"
                                    tabindex="0"
                                    aria-pressed={isSelected(it)}
                                    onClick={() => setSelectedIssue(it)}
                                    onKeyDown={(event) => {
                                      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                                      event.preventDefault()
                                      setSelectedIssue(it)
                                    }}
                                  >
                                    <span class="linear-browse-prio" data-p={prio.level} title={prio.label} aria-label={prio.label}>
                                      <i /><i /><i />
                                    </span>
                                    <span class="linear-browse-id">{it.identifier}</span>
                                    <span class="linear-browse-title">{it.title}</span>
                                    <For each={it.labels.slice(0, 2)}>
                                      {(l) => <span class="linear-label-chip" style={{ '--label-color': l.color }}>{l.name}</span>}
                                    </For>
                                    <Show when={formatRelativeTime(it.updatedAt)}>{(age) => <span class="linear-browse-when">{age()}</span>}</Show>
                                    <button
                                      type="button"
                                      class="linear-browse-ws-btn"
                                      title="New task or attach to an existing one"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        void promote(it)
                                      }}
                                    >
                                      +TASK
                                    </button>
                                  </div>
                                </li>
                              )
                            }}
                          </For>
                        </>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
      </section>

      <section class="pane pane-right linear-browse-detail">
        <Show
          when={selectedIssue()}
          fallback={<div class="pane-empty"><p class="placeholder">Select an issue.</p></div>}
        >
          {(selected) => (
            <LinearIssuePanel
              variant="pane"
              target={{ identifier: selected().identifier, connectionId: selected().integrationId }}
              onClose={() => setSelectedIssue(null)}
              onContentClick={() => {}}
            />
          )}
        </Show>
      </section>

      <Show when={pickerOpen()}>
        <div class="overlay-backdrop" onClick={() => setPickerOpen(false)}>
          <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="overlay-title">Linear projects — {ws()?.name}</div>
            <div class="overlay-body">
              <Show when={!projects.isPending} fallback={<p class="muted">Loading projects…</p>}>
                <Show when={(projects.data?.projects ?? []).length} fallback={<p class="muted">No projects found in the connected Linear workspace(s).</p>}>
                  <ul class="linear-project-picker">
                    <For each={projects.data?.projects ?? []}>
                      {(p) => (
                        <li>
                          <label>
                            <input type="checkbox" checked={checked().has(`${p.integrationId}:${p.id}`)} onChange={() => toggle(`${p.integrationId}:${p.id}`)} />
                            {p.name} <span class="muted">· {p.integrationLabel}</span>
                          </label>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
              <div class="integration-key-row" style={{ 'justify-content': 'flex-end' }}>
                <button type="button" class="overlay-btn" onClick={savePicker}>Save</button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={promoteIssue()}>
        {(issue) => (
          <PromoteToTaskModal
            providerId="linear"
            item={issue()}
            headerLabel={`+TASK — ${issue().identifier}`}
            itemTitle={issue().title}
            attachTasks={attachTasks()}
            existingBranches={(tasks.data ?? []).map((t) => t.branch)}
            onClose={() => setPromoteIssue(null)}
            onCreated={afterPromote}
            onAttached={afterPromote}
          />
        )}
      </Show>
    </main>
  )
}
