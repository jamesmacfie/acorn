import { createSignal, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { projectsKey, projectsOptions, workspacesKey, workspacesOptions } from '../queries'
import { createProject, createWorkspace, patchProject } from './mutations'
import { taskBridge } from '../tasks/taskBridge'
import { projectImporterRegistry } from '../registries/projectImporters'
import './onboarding.css'

// Projects manager: a workspace groups local folders. Git and GitHub are facets on the same row,
// not prerequisites for adding a project, so a plain folder and a path-null remote import share the
// same controls and can be repaired in place.
export default function WorkspaceProjectAssignments() {
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const api = taskBridge()
  const [newName, setNewName] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [activeImporter, setActiveImporter] = createSignal<string | null>(null)
  const importer = () => {
    const id = activeImporter()
    return id ? projectImporterRegistry.get(id) : undefined
  }

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: projectsKey }),
    qc.invalidateQueries({ queryKey: workspacesKey }),
  ])
  const allHidden = () => {
    const list = projects.data ?? []
    return list.length > 0 && list.every((project) => project.hidden)
  }

  async function addFolder() {
    if (!api) return
    const path = await api.folderPath.pick()
    if (!path) return
    setError('')
    try {
      await createProject({ path })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add folder.')
    }
  }

  async function mapFolder(id: string) {
    if (!api) return
    const path = await api.folderPath.pick()
    if (!path) return
    setError('')
    try {
      await patchProject(id, { path })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not map folder.')
    }
  }

  async function addWorkspace(e: Event) {
    e.preventDefault()
    const name = newName().trim()
    if (!name) return
    setBusy(true)
    try {
      await createWorkspace(name)
      setNewName('')
      await qc.invalidateQueries({ queryKey: workspacesKey })
    } finally {
      setBusy(false)
    }
  }

  async function setHidden(id: string, hidden: boolean) {
    await patchProject(id, { hidden })
    await refresh()
  }

  async function setWorkspace(id: string, workspaceId: string) {
    await patchProject(id, { workspaceId })
    await refresh()
  }

  async function toggleAll() {
    const hidden = !allHidden()
    await Promise.all((projects.data ?? []).map((project) => patchProject(project.id, { hidden })))
    await refresh()
  }

  return (
    <>
      <p class="muted">Projects are local folders grouped into workspaces. Add a folder directly, or connect GitHub to map, clone, or defer repository projects. Git and GitHub badges describe detected facets; plain folders are valid too.</p>
      <Show when={error()}><div class="action-error" role="alert">{error()}</div></Show>

      <div class="onboarding-listhead">
        <button type="button" class="onboarding-eye" classList={{ hidden: allHidden() }} title={allHidden() ? 'Show all projects' : 'Hide all projects'} aria-pressed={allHidden()} onClick={() => void toggleAll()}>
          {allHidden() ? '⊘' : '◉'}
        </button>
        <span class="muted">Projects</span>
        <div class="onboarding-actions">
          <Show when={api}>
            <button type="button" class="ui-btn" onClick={() => void addFolder()}>Add folder…</button>
          </Show>
          <For each={projectImporterRegistry.entries()}>
            {(entry) => (
              <button type="button" class="ui-btn" onClick={() => setActiveImporter(entry.id)}>
                {entry.glyph} {entry.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={importer()}>
        {(entry) => (
          <section class="project-importer" aria-label={entry().label}>
            <Dynamic
              component={entry().component}
              onClose={() => setActiveImporter(null)}
              onImported={() => void refresh()}
            />
          </section>
        )}
      </Show>

      <form class="integration-key-row onboarding-newrow" onSubmit={addWorkspace}>
        <input class="ui-input" type="text" placeholder="New workspace name (e.g. Runn)" value={newName()} onInput={(e) => setNewName(e.currentTarget.value)} />
        <button type="submit" class="ui-btn" disabled={busy() || !newName().trim()}>Add workspace</button>
      </form>

      <div class="onboarding-list">
        <For each={projects.data ?? []}>
          {(project) => (
            <div class="onboarding-row" classList={{ 'onboarding-ignored': project.hidden }}>
              <button type="button" class="onboarding-eye" classList={{ hidden: project.hidden }} title={project.hidden ? 'Hidden — click to show' : 'Hide this project'} aria-pressed={project.hidden} onClick={() => void setHidden(project.id, !project.hidden)}>
                {project.hidden ? '⊘' : '◉'}
              </button>
              <span class="onboarding-repo" title={project.path ?? 'No folder mapped'}>{project.name}</span>
              <span class="muted">{project.vcs === 'git' ? 'Git' : 'Folder'}</span>
              <Show when={project.github}><span class="muted">GitHub</span></Show>
              <select class="ui-input" disabled={project.hidden} onChange={(e) => void setWorkspace(project.id, e.currentTarget.value)}>
                <For each={workspaces.data ?? []}>{(workspace) => <option value={workspace.id} selected={workspace.id === project.workspaceId}>{workspace.name}</option>}</For>
              </select>
              <Show when={api}>
                <button type="button" class="ui-btn onboarding-browse" disabled={project.hidden} title={project.path ?? 'Choose folder'} onClick={() => void mapFolder(project.id)}>
                  {project.path ? 'Change folder' : 'Add folder'}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </>
  )
}
