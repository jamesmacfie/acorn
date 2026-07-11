import { createEffect, createSignal, For, on, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { linearProjectsOptions, tasksKey, tasksOptions, workspaceProjectsKey, workspaceProjectsOptions, workspaceLinearIssuesOptions, workspacesOptions } from '../../../core/client/queries'
import { setWorkspaceProjects } from '../../github/client/mutations'
import type { LinearProjectIssue, Task, WorkspaceProject } from '../../../core/shared/api'
import { workspaceForRepo } from '../../../core/client/workspaces/activeWorkspace'
import { activateTaskSignals, pathForTask } from '../../../core/client/tasks/activate'
import { sourceRegistry, type SourceContribution } from '../../../core/client/registries/sources'
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
  const linkedProjects = () => linked.data?.projects ?? []
  const issues = createQuery(() => workspaceLinearIssuesOptions(linkedProjects(), linkedProjects().length > 0))
  const [selectedIssue, setSelectedIssue] = createSignal<LinearProjectIssue | null>(null)
  const isSelected = (issue: LinearProjectIssue) => {
    const selected = selectedIssue()
    return selected !== null && issueKey(selected) === issueKey(issue)
  }

  // ponytail: local selection signal, add a route param only if issues need deep-linking.
  // The source component survives repo navigation, so explicitly keep this session-only selection
  // scoped to the routed repo rather than showing an issue from the workspace we just left.
  createEffect(on(
    () => `${params.owner ?? ''}/${params.repo ?? ''}`,
    () => setSelectedIssue(null),
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
      const result = await projects.refetch()
      if (result.isError) {
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
    await setWorkspaceProjects(id, chosen)
    await qc.invalidateQueries({ queryKey: workspaceProjectsKey(id) })
    setPickerOpen(false)
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
    const promotion = (sourceRegistry.get('linear') as SourceContribution<LinearProjectIssue>).promotion
    const context = { owner, repo }
    if (!promotion.canPromote(it, context)) return
    const w = await promotion.create(await promotion.prepare(it, context))
    await promotion.afterCreate?.(w, it, context)
    await qc.invalidateQueries({ queryKey: tasksKey })
    activateTaskSignals(w, { pane: 'linear' }) // a promoted ticket lands on its Linear pane
    navigate(`/${owner}/${repo}`)
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
              <Show when={(issues.data?.issues ?? []).length} fallback={<p class="placeholder">No active issues in the selected project(s).</p>}>
                <ul class="linear-browse-list">
                  <For each={issues.data?.issues ?? []}>
                    {(it) => (
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
                          <span class="linear-browse-id">{it.identifier}</span>
                          <span class="linear-browse-title">{it.title}</span>
                          <Show when={it.state}>{(s) => <span class="linear-browse-state" style={{ '--state-color': s().color }}>{s().name}</span>}</Show>
                          <button
                            type="button"
                            class="linear-browse-ws-btn"
                            title="Open as task"
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              void promote(it)
                            }}
                          >
                            + ws
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
    </main>
  )
}
