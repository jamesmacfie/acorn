import { createMemo, createSignal, For, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { linearProjectIssuesOptions, linearProjectsOptions, prefsKey, prefsOptions, workspacesKey } from '../../queries'
import { createWorkspace, setPref } from '../../mutations'
import { linearProjectsPrefKey, type LinearProject, type LinearProjectIssue } from '../../../shared/api'
import { setActivePane, setActiveWorkspaceId, setSelectedSource } from './workspaces'

// The Linear Source browse (docs/workspaces 04). Linear has projects; pulling *all* issues is noise,
// so issues are scoped to the project(s) the user links to the current repo. The selection is stored
// per repo in prefs; a picker over the workspace's projects edits it. Clicking an issue promotes it
// to a workspace (origin linear) on the issue's Linear branch name. EUX: repo follows the topbar
// RepoPicker, so "Linear" always shows the issues relevant to the repo you're working in.
export default function LinearBrowse() {
  const navigate = useNavigate()
  const params = useParams()
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))

  const prefKey = () => linearProjectsPrefKey(params.owner ?? '', params.repo ?? '')
  const selected = createMemo<LinearProject[]>(() => {
    const raw = prefs.data?.[prefKey()]
    if (!raw) return []
    try {
      return JSON.parse(raw) as LinearProject[]
    } catch {
      return []
    }
  })
  const selectedIds = () => selected().map((p) => p.id)
  const issues = createQuery(() => linearProjectIssuesOptions(selectedIds(), !!params.owner && selectedIds().length > 0))

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
    const sel = (projects.data?.projects ?? []).filter((p) => checked().has(p.id))
    await setPref(prefKey(), JSON.stringify(sel))
    await qc.invalidateQueries({ queryKey: prefsKey })
    setPickerOpen(false)
  }

  async function promote(it: LinearProjectIssue) {
    const { owner, repo } = params
    if (!owner || !repo) return
    const branch = it.branchName || it.identifier.toLowerCase()
    const w = await createWorkspace({
      origin: 'linear',
      repoOwner: owner,
      repoName: repo,
      branch,
      title: `${it.identifier} ${it.title}`,
      links: [{ provider: 'linear', identifier: it.identifier }],
    })
    await qc.invalidateQueries({ queryKey: workspacesKey })
    setSelectedSource(null)
    setActiveWorkspaceId(w.id)
    setActivePane('linear')
    navigate(`/${owner}/${repo}`)
  }

  return (
    <main class="panes panes-empty">
      <section class="pane linear-browse">
        <div class="section-header">
          Linear{params.owner ? ` · ${params.owner}/${params.repo}` : ''}
          <Show when={params.owner}>
            <button type="button" class="new-pr-btn" title="Choose Linear projects for this repo" onClick={openPicker}>
              Projects{selected().length ? ` (${selected().length})` : ''}
            </button>
          </Show>
        </div>

        <Show when={params.owner} fallback={<p class="placeholder">Select a repo to browse its Linear issues.</p>}>
          <Show
            when={selectedIds().length}
            fallback={
              <div class="workspace-empty-inner">
                <p class="muted">No Linear projects linked to {params.repo}.</p>
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
                        <button type="button" class="linear-browse-row" title="Open as workspace" onClick={() => void promote(it)}>
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
            <div class="overlay-title">Linear projects — {params.owner}/{params.repo}</div>
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
