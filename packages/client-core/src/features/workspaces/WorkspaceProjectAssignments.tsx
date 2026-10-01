import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { projectsKey, projectsOptions, tasksKey, tasksOptions, workspacesKey, workspacesOptions } from '../../infra/queries'
import { createProject, createWorkspace, patchProject } from './workspaceMutations'
import { canPickFolder, pickFolder } from '../../infra/platform'
import { projectImporterContributions } from '../../host/registries/sources/projectImporters'
import { projectSettingsTarget, workspaceSettingsTarget } from '../../host/registries/shell/settings'
import { Alert, Button, Input } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { Stack } from '../../kit/components/layout/Stack'
import { ProjectTable, type ProjectGroup } from './ProjectTable'
import './onboarding.css'

// Settings → Overview: every project on the node in one table, grouped under the workspace it belongs
// to, because the grouping is what is being arranged. Selecting rows opens a bar for moving, hiding and
// colouring several at once (./ProjectTable.tsx), and a row opens its project's own page for
// everything else. Adding projects and workspaces starts here.
//
// Git and GitHub are facets on the row, not prerequisites: a plain folder and a path-less import are
// listed the same way and repaired from their page.

export default function WorkspaceProjectAssignments(props: { navigate: (target: string) => void }) {
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  const [newWorkspace, setNewWorkspace] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [activeImporter, setActiveImporter] = createSignal<string | null>(null)
  const importer = () => {
    const id = activeImporter()
    return id ? projectImporterContributions().find((entry) => entry.id === id) : undefined
  }
  createEffect(() => {
    if (!activeImporter() || importer()) return
    setActiveImporter(null)
    setError('This importer is no longer available on this node.')
  })

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: projectsKey }),
    qc.invalidateQueries({ queryKey: workspacesKey }),
    qc.invalidateQueries({ queryKey: tasksKey }),
  ])

  const groups = createMemo((): ProjectGroup[] => {
    const all = projects.data ?? []
    const known = new Set((workspaces.data ?? []).map((workspace) => workspace.id))
    // A project whose workspace is missing from the list would otherwise vanish with no way to rescue it.
    const orphans = all.filter((project) => !known.has(project.workspaceId))
    return [
      ...(workspaces.data ?? []).map((workspace): ProjectGroup => ({
        id: workspace.id,
        label: workspace.name,
        workspaceId: workspace.id,
        projects: all.filter((project) => project.workspaceId === workspace.id),
      })),
      ...(orphans.length ? [{ id: 'unassigned', label: 'Unassigned', projects: orphans }] : []),
    ]
  })
  const taskCount = (projectId: string) => (tasks.data ?? []).filter((task) => task.projectId === projectId).length

  /** Resolves whether the work landed, so a form can stay open with what was typed when it did not. */
  const guard = async (work: () => Promise<unknown>, whenItFails: string): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : whenItFails)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addFolder() {
    const path = await pickFolder()
    if (!path) return
    await guard(() => createProject({ path }), 'Could not add folder.')
  }

  async function mapFolder(id: string) {
    const path = await pickFolder()
    if (!path) return
    await guard(() => patchProject(id, { path }), 'Could not map folder.')
  }

  async function addWorkspace(event: Event) {
    event.preventDefault()
    const name = newWorkspace()?.trim()
    if (!name) return
    if (await guard(() => createWorkspace(name), 'Could not add workspace.')) setNewWorkspace(null)
  }

  return (
    <SettingsSection
      id="projects"
      label="Projects"
      description="Projects are local folders grouped into workspaces. Add a folder directly, or connect GitHub to map or clone repository projects. Git and GitHub badges describe detected facets, and plain folders are valid too."
      actions={
        <>
          <Show when={canPickFolder()}>
            <Button onPress={() => void addFolder()}>Add folder…</Button>
          </Show>
          <For each={projectImporterContributions()}>
            {/* Through Icon, not raw text: an importer's glyph is an icon name like every other
                registry's, so a Lucide name or a `brand:` mark both resolve here. */}
            {(entry) => (
              <Button onPress={() => setActiveImporter(entry.id)}>
                <Icon name={entry.glyph} /> {entry.label}
              </Button>
            )}
          </For>
          <Button onPress={() => setNewWorkspace('')}>New workspace</Button>
        </>
      }
    >
      <Stack>
        <Show when={error()}><Alert>{error()}</Alert></Show>
        <Show when={projects.isError}><Alert>Could not read this node's projects.</Alert></Show>

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

        {/* Revealed on demand rather than a form sitting permanently above the table, where it read as
            the primary action on a page whose primary action is adding a project. */}
        <Show when={newWorkspace() !== null}>
          <form class="ws-add-form" onSubmit={addWorkspace}>
            <Input
              label="Workspace name"
              placeholder="Workspace name (e.g. Runn)"
              value={newWorkspace() ?? ''}
              ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
              onInput={(value) => setNewWorkspace(value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setNewWorkspace(null) } }}
            />
            <Button submit disabled={busy() || !newWorkspace()?.trim()}>Add</Button>
            <Button variant="bare" onPress={() => setNewWorkspace(null)}>Cancel</Button>
          </form>
        </Show>

        <ProjectTable
          groups={groups()}
          workspaces={workspaces.data ?? []}
          taskCount={taskCount}
          groupHeads
          openProject={(id) => props.navigate(projectSettingsTarget(id))}
          openWorkspace={(id) => props.navigate(workspaceSettingsTarget(id))}
          mapFolder={(id) => void mapFolder(id)}
          refresh={refresh}
        />
      </Stack>
    </SettingsSection>
  )
}
