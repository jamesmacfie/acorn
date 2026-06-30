import { createSignal, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { linearProjectIssuesOptions, linearProjectsOptions, tasksKey, workspaceLinearProjectsKey, workspaceLinearProjectsOptions, workspacesOptions } from '../../queries'
import { createTask, setWorkspaceLinearProjects } from '../../mutations'
import type { LinearProjectIssue } from '../../../shared/api'
import { workspaceForRepo } from '../workspaces/activeWorkspace'
import { setActivePane, setActiveTaskId, setSelectedSource } from './tasks'

// The Linear Source browse (docs/workspaces 04/P5). Linear projects are linked at the WORKSPACE
// level — one project can back many repos in the workspace. Issues are scoped to the workspace's
// linked projects; a picker edits the link set. Clicking an issue promotes it to a task on the
// current repo (the topbar repo sub-selector chooses which) on the issue's Linear branch name.
export default function LinearBrowse() {
  const navigate = useNavigate()
  const params = useParams()
  const qc = useQueryClient()
  const workspaces = createQuery(() => workspacesOptions(true))
  const ws = () => workspaceForRepo(workspaces.data, params.owner, params.repo)
  const wsId = () => ws()?.id ?? null

  const linked = createQuery(() => workspaceLinearProjectsOptions(wsId(), true))
  const selectedIds = () => linked.data?.projectIds ?? []
  const issues = createQuery(() => linearProjectIssuesOptions(selectedIds(), selectedIds().length > 0))

  // Project picker.
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const projects = createQuery(() => linearProjectsOptions(pickerOpen()))
  const [checked, setChecked] = createSignal<Set<string>>(new Set())
  function openPicker() {
    setChecked(new Set(selectedIds()))
    setPickerOpen(true)
  }
  function toggle(id: string) {
    const s = new Set(checked())
    s.has(id) ? s.delete(id) : s.add(id)
    setChecked(s)
  }
  async function savePicker() {
    const id = wsId()
    if (!id) return setPickerOpen(false)
    await setWorkspaceLinearProjects(id, [...checked()])
    await qc.invalidateQueries({ queryKey: workspaceLinearProjectsKey(id) })
    setPickerOpen(false)
  }

  async function promote(it: LinearProjectIssue) {
    const { owner, repo } = params
    if (!owner || !repo) return
    const branch = it.branchName || it.identifier.toLowerCase()
    const w = await createTask({
      origin: 'linear',
      repoOwner: owner,
      repoName: repo,
      branch,
      title: `${it.identifier} ${it.title}`,
      links: [{ provider: 'linear', identifier: it.identifier }],
    })
    await qc.invalidateQueries({ queryKey: tasksKey })
    setSelectedSource(null)
    setActiveTaskId(w.id)
    setActivePane('linear')
    navigate(`/${owner}/${repo}`)
  }

  return (
    <main class="panes panes-empty">
      <section class="pane linear-browse">
        <div class="section-header">
          Linear{ws() ? ` · ${ws()!.name}` : ''}
          <Show when={wsId()}>
            <button type="button" class="new-pr-btn" title="Choose Linear projects for this workspace" onClick={openPicker}>
              Projects{selectedIds().length ? ` (${selectedIds().length})` : ''}
            </button>
          </Show>
        </div>

        <Show when={wsId()} fallback={<p class="placeholder">Select a workspace to browse its Linear issues.</p>}>
          <Show
            when={selectedIds().length}
            fallback={
              <div class="workspace-empty-inner">
                <p class="muted">No Linear projects linked to {ws()?.name}.</p>
                <button type="button" class="overlay-btn" onClick={openPicker}>Choose projects</button>
              </div>
            }
          >
            <Show when={!issues.isPending} fallback={<p class="placeholder">Loading…</p>}>
              <Show when={(issues.data?.issues ?? []).length} fallback={<p class="placeholder">No active issues in the selected project(s).</p>}>
                <ul class="linear-browse-list">
                  <For each={issues.data?.issues ?? []}>
                    {(it) => (
                      <li>
                        <button type="button" class="linear-browse-row" title="Open as task" onClick={() => void promote(it)}>
                          <span class="linear-browse-id">{it.identifier}</span>
                          <span class="linear-browse-title">{it.title}</span>
                          <Show when={it.state}>{(s) => <span class="linear-browse-state" style={{ '--state-color': s().color }}>{s().name}</span>}</Show>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </Show>
      </section>

      <Show when={pickerOpen()}>
        <div class="overlay-backdrop" onClick={() => setPickerOpen(false)}>
          <div class="overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="overlay-title">Linear projects — {ws()?.name}</div>
            <div class="overlay-body">
              <Show when={!projects.isPending} fallback={<p class="muted">Loading projects…</p>}>
                <Show when={(projects.data?.projects ?? []).length} fallback={<p class="muted">No projects found in this Linear workspace.</p>}>
                  <ul class="linear-project-picker">
                    <For each={projects.data?.projects ?? []}>
                      {(p) => (
                        <li>
                          <label>
                            <input type="checkbox" checked={checked().has(p.id)} onChange={() => toggle(p.id)} />
                            {p.name}
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
