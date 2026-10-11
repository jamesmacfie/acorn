import { createMemo, createSignal, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  projectsKey,
  projectsOptions,
  tasksKey,
  tasksOptions,
  workspacesKey,
  workspacesOptions,
} from '../../infra/queries'
import { createWorkspace, patchProject } from './workspaceMutations'
import { pickFolder } from '../../infra/platform'
import { projectSettingsTarget, workspaceSettingsTarget } from '../../host/registries/shell/settings'
import { Alert, Button, Input } from '../../kit/components/primitives'
import AddProjectControls from './AddProjectControls'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { Stack } from '../../kit/components/layout/Stack'
import { ProjectTable, type ProjectGroup } from './ProjectTable'
import { createWorkspacesMode } from './workspacesMode'
import { activeCacheId } from '../../infra/node/activeNode'
import { GroupProjectsSection } from './GroupProjectsSection'
import './projects.css'

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
  const mode = createWorkspacesMode()
  const [newWorkspace, setNewWorkspace] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: projectsKey }),
      qc.invalidateQueries({ queryKey: workspacesKey }),
      qc.invalidateQueries({ queryKey: tasksKey }),
    ])

  const groups = createMemo((): ProjectGroup[] => {
    const all = projects.data ?? []
    if (mode() === 'off') return [{ id: 'projects', label: 'Projects', projects: all }]
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

  async function mapFolder(id: string) {
    const path = await pickFolder()
    if (!path) return
    await guard(() => patchProject(id, { path }), "Couldn't link the folder.")
  }

  async function addWorkspace(event: Event) {
    event.preventDefault()
    const name = newWorkspace()?.trim()
    if (!name) return
    if (await guard(() => createWorkspace(name), "Couldn't add the workspace.")) setNewWorkspace(null)
  }

  return (
    <>
      <SettingsSection
        id="projects"
        label="Projects"
        help={
          mode() === 'on'
            ? 'A project is a folder on this computer, and workspaces group them. Add a folder, or import repositories from GitHub.'
            : 'Add a folder, or import repositories from GitHub.'
        }
        actions={
          <>
            <Show when={mode() === 'on'}>
              <Button onPress={() => setNewWorkspace('')}>New workspace</Button>
            </Show>
          </>
        }
      >
        <Stack>
          <AddProjectControls />
          <Show when={error()}>
            <Alert>{error()}</Alert>
          </Show>
          <Show when={projects.isError}>
            <Alert>Couldn't load projects.</Alert>
          </Show>

          {/* Revealed on demand rather than a form sitting permanently above the table, where it read as
              the primary action on a page whose primary action is adding a project. */}
          <Show when={mode() === 'on' && newWorkspace() !== null}>
            <form class="ws-add-form" onSubmit={addWorkspace}>
              <Input
                label="Workspace name"
                placeholder="Workspace name"
                value={newWorkspace() ?? ''}
                ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
                onInput={(value) => setNewWorkspace(value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setNewWorkspace(null)
                  }
                }}
              />
              <Button submit disabled={busy() || !newWorkspace()?.trim()}>
                Add
              </Button>
              <Button variant="ghost" onPress={() => setNewWorkspace(null)}>
                Cancel
              </Button>
            </form>
          </Show>

          <Show when={mode()}>
            <ProjectTable
              groups={groups()}
              workspaces={workspaces.data ?? []}
              taskCount={taskCount}
              groupHeads={mode() === 'on'}
              allowMove={mode() === 'on'}
              openProject={(id) => props.navigate(projectSettingsTarget(id))}
              openWorkspace={(id) => props.navigate(workspaceSettingsTarget(id))}
              mapFolder={(id) => void mapFolder(id)}
              refresh={refresh}
            />
          </Show>
        </Stack>
      </SettingsSection>
      <Show when={mode() === 'off'}>
        <Show when={activeCacheId()} keyed>
          {(_nodeId) => <GroupProjectsSection />}
        </Show>
      </Show>
    </>
  )
}
