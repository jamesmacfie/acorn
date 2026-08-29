import { createMemo, createSignal, For, Index, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { Project, Workspace } from '@acorn/protocol/api.ts'
import { PROJECT_COLORS, resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import { projectsKey, projectsOptions, tasksKey, tasksOptions, workspacesKey, workspacesOptions } from '../queries'
import { createProject, createWorkspace, deleteProject, deleteWorkspace, patchProject, renameWorkspace } from './mutations'
import { canPickFolder, pickFolder } from '../platform'
import { projectImporterRegistry } from '../registries/projectImporters'
import { Alert, Button, Input, Select } from '../ui/primitives'
import Icon from '../ui/Icon'
import { Modal } from '../ui/Modal'
import './onboarding.css'

// Projects manager. Projects are listed under the workspace they belong to rather than each carrying a
// workspace dropdown in isolation: the grouping is what's being edited, and a column of identical
// "Default" selects made the one fact that matters hardest to read. Moving a project is still a select,
// but it says where it's moving from by where it sits, and its last option creates a new workspace.
//
// Git and GitHub are facets on the row, not prerequisites: a plain folder and a path-less import share
// the same controls and can be repaired in place.

/** Sentinel option value: "move this project to a workspace that does not exist yet". */
const NEW_WORKSPACE = '__new__'

/** An input that commits on blur and on Enter, and puts the old name back when the commit is
 *  refused. It holds its own element because the reset is a DOM write, which is what the kit's
 *  `ref` is for. */
function RenameField(fieldProps: { label: string; value: string; disabled?: boolean; onCommit: (field: HTMLInputElement) => void }) {
  let field: HTMLInputElement | undefined
  return (
    <Input
      ref={(el) => { field = el }}
      label={fieldProps.label}
      value={fieldProps.value}
      disabled={fieldProps.disabled}
      onBlur={() => { if (field) fieldProps.onCommit(field) }}
      onKeyDown={(event) => { if (event.key === 'Enter') field?.blur() }}
    />
  )
}

export default function WorkspaceProjectAssignments() {
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const tasks = createQuery(() => tasksOptions(true))
  const [newWorkspace, setNewWorkspace] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [activeImporter, setActiveImporter] = createSignal<string | null>(null)
  const [confirmDelete, setConfirmDelete] = createSignal<Project | null>(null)
  const [movingToNew, setMovingToNew] = createSignal<Project | null>(null)
  const importer = () => {
    const id = activeImporter()
    return id ? projectImporterRegistry.get(id) : undefined
  }

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: projectsKey }),
    qc.invalidateQueries({ queryKey: workspacesKey }),
    qc.invalidateQueries({ queryKey: tasksKey }),
  ])

  const groups = createMemo(() => {
    const all = projects.data ?? []
    return (workspaces.data ?? []).map((workspace) => ({
      workspace,
      projects: all.filter((project) => project.workspaceId === workspace.id),
    }))
  })
  // A project whose workspace is missing from the list would otherwise vanish with no way to rescue it.
  const orphans = createMemo(() => {
    const known = new Set((workspaces.data ?? []).map((workspace) => workspace.id))
    return (projects.data ?? []).filter((project) => !known.has(project.workspaceId))
  })
  const taskCount = (projectId: string) => (tasks.data ?? []).filter((task) => task.projectId === projectId).length
  const projectsIn = (workspaceId: string) => (projects.data ?? []).filter((project) => project.workspaceId === workspaceId).length

  const guard = async (work: () => Promise<unknown>, whenItFails: string) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : whenItFails)
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
    await guard(() => createWorkspace(name), 'Could not add workspace.')
    setNewWorkspace(null)
  }

  // Commit on blur or Enter, not per keystroke. A blank name snaps back, matching the server.
  async function renameInPlace(field: HTMLInputElement, current: string, save: (name: string) => Promise<unknown>) {
    const name = field.value.trim()
    if (!name || name === current) {
      field.value = current
      return
    }
    await guard(() => save(name), 'Could not rename.')
  }

  const move = (project: Project, workspaceId: string) => {
    if (workspaceId === NEW_WORKSPACE) {
      setMovingToNew(project)
      return
    }
    void guard(() => patchProject(project.id, { workspaceId }), 'Could not move project.')
  }

  const moveToNewWorkspace = async (project: Project, name: string) => {
    await guard(async () => {
      const workspace = await createWorkspace(name)
      await patchProject(project.id, { workspaceId: workspace.id })
    }, 'Could not create that workspace.')
    setMovingToNew(null)
  }

  // Modal rather than arm-to-confirm because the blast radius is real: every project in the workspace
  // moves. Not `confirm()`, which the webview renders unstyled.
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = createSignal<Workspace | null>(null)

  return (
    <>
      <p class="muted">
        Projects are local folders grouped into workspaces. Add a folder directly, or connect GitHub to
        map or clone repository projects. Git and GitHub badges describe detected facets; plain folders
        are valid too.
      </p>
      <Show when={error()}><Alert>{error()}</Alert></Show>

      <div class="onboarding-listhead">
        <span class="muted">Projects</span>
        <div class="onboarding-actions">
          <Show when={canPickFolder()}>
            <Button onPress={() => void addFolder()}>Add folder…</Button>
          </Show>
          <For each={projectImporterRegistry.entries()}>
            {/* Through Icon, not raw text: an importer's glyph is an icon name like every other
                registry's, so a Lucide name or a `brand:` mark both resolve here. */}
            {(entry) => (
              <Button onPress={() => setActiveImporter(entry.id)}>
                <Icon name={entry.glyph} /> {entry.label}
              </Button>
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

      <div class="ws-groups">
        <For each={groups()}>
          {(group) => (
            <section class="ws-group" aria-label={group.workspace.name}>
              {/* Subgrid: the header sits in the same column tracks as the rows below it, so the
                  workspace name lines up with the project names rather than with the eye toggle. */}
              <header class="ws-group-head">
                <span aria-hidden="true" />
                <RenameField
                  label={`Name of workspace ${group.workspace.name}`}
                  value={group.workspace.name}
                  onCommit={(field) => void renameInPlace(field, group.workspace.name, (name) => renameWorkspace(group.workspace.id, name))}
                />
                {/* Spans the path and facet tracks: "12 projects" must never wrap, and the path
                    track alone is sized for an ellipsised path, not for a phrase. */}
                <span class="ws-group-count muted">{group.projects.length || 'no'} project{group.projects.length === 1 ? '' : 's'}</span>
                <span />
                {/* The default workspace is where deleted workspaces' projects land, so it cannot go. */}
                <Show when={!group.workspace.isDefault} fallback={<span />}>
                  <Button variant="bare" tone="danger" size="sm" disabled={busy()} onPress={() => setConfirmDeleteWorkspace(group.workspace)}>Delete</Button>
                </Show>
              </header>
              {/* No empty-state row: the header already reads "no projects", and a second sentence
                  saying so was the only thing in the card. */}
              <Show when={group.projects.length}>
                <ProjectRows
                  rows={group.projects}
                  workspaces={workspaces.data ?? []}
                  busy={busy()}
                  onRename={renameInPlace}
                  onMove={move}
                  onHide={(id, hidden) => void guard(() => patchProject(id, { hidden }), 'Could not update project.')}
                  onColor={(id, color) => void guard(() => patchProject(id, { color }), 'Could not update project colour.')}
                  onMapFolder={(id) => void mapFolder(id)}
                  onDelete={setConfirmDelete}
                />
              </Show>
            </section>
          )}
        </For>

        <Show when={orphans().length}>
          <section class="ws-group" aria-label="Unassigned">
            <header class="ws-group-head">
              <span aria-hidden="true" />
              <span class="ws-group-name-static">Unassigned</span>
              <span /><span /><span /><span />
            </header>
            <ProjectRows
              rows={orphans()}
              workspaces={workspaces.data ?? []}
              busy={busy()}
              onRename={renameInPlace}
              onMove={move}
              onHide={(id, hidden) => void guard(() => patchProject(id, { hidden }), 'Could not update project.')}
              onColor={(id, color) => void guard(() => patchProject(id, { color }), 'Could not update project colour.')}
              onMapFolder={(id) => void mapFolder(id)}
              onDelete={setConfirmDelete}
            />
          </section>
        </Show>
      </div>

      {/* Revealed on demand rather than a form sitting permanently above the list, where it read as
          the primary action on a page whose primary action is adding a project. */}
      <Show
        when={newWorkspace() !== null}
        fallback={<Button onPress={() => setNewWorkspace('')}>New workspace</Button>}
      >
        <form class="ws-add-form" onSubmit={addWorkspace}>
          <Input
            placeholder="Workspace name (e.g. Runn)"
            value={newWorkspace() ?? ''}
            ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
            onInput={(value) => setNewWorkspace(value)}
            onKeyDown={(event) => event.key === 'Escape' && setNewWorkspace(null)}
          />
          <Button submit disabled={busy() || !newWorkspace()?.trim()}>Add</Button>
          <Button variant="bare" onPress={() => setNewWorkspace(null)}>Cancel</Button>
        </form>
      </Show>

      <Show when={confirmDeleteWorkspace()}>
        {(workspace) => (
          <Modal onClose={() => setConfirmDeleteWorkspace(null)} title="Delete workspace" size="sm" role="alertdialog">
            <Modal.Body>
              <p>Delete <strong>{workspace().name}</strong>?</p>
              <Show when={projectsIn(workspace().id)}>
                {(count) => (
                  <p class="muted">
                    Its {count()} project{count() === 1 ? '' : 's'} move to Default. No folder is touched.
                  </p>
                )}
              </Show>
            </Modal.Body>
            <Modal.Actions>
              <Button variant="bare" onPress={() => setConfirmDeleteWorkspace(null)}>Cancel</Button>
              <Button
                variant="solid"
                tone="danger"
                busy={busy()}
                onPress={async () => {
                  await guard(() => deleteWorkspace(workspace().id), 'Could not delete workspace.')
                  setConfirmDeleteWorkspace(null)
                }}
              >
                Delete workspace
              </Button>
            </Modal.Actions>
          </Modal>
        )}
      </Show>

      <Show when={confirmDelete()}>
        {(project) => (
          <DeleteProjectModal
            project={project()}
            taskCount={taskCount(project().id)}
            busy={busy()}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={async () => {
              await guard(() => deleteProject(project().id), 'Could not delete project.')
              setConfirmDelete(null)
            }}
          />
        )}
      </Show>

      <Show when={movingToNew()}>
        {(project) => (
          <NewWorkspaceModal
            project={project()}
            busy={busy()}
            onCancel={() => setMovingToNew(null)}
            onConfirm={(name) => void moveToNewWorkspace(project(), name)}
          />
        )}
      </Show>
    </>
  )
}

function ProjectRows(props: {
  rows: Project[]
  workspaces: Workspace[]
  busy: boolean
  onRename: (field: HTMLInputElement, current: string, save: (name: string) => Promise<unknown>) => Promise<void>
  onMove: (project: Project, workspaceId: string) => void
  onHide: (id: string, hidden: boolean) => void
  onColor: (id: string, color: string | null) => void
  onMapFolder: (id: string) => void
  onDelete: (project: Project) => void
}) {
  return (
    // Index, not For: the name cell is an editable input, and For keys rows by object identity, so
    // every refetch would destroy the row and the caret mid-typing.
    <Index each={props.rows}>
      {(project) => (
        <div class="ws-row" classList={{ 'ws-row-hidden': project().hidden }}>
          <span class="ws-row-controls">
            <Button
              variant="bare"
              title={project().hidden ? 'Hidden — click to show' : 'Hide this project'}
              pressed={project().hidden}
              onPress={() => props.onHide(project().id, !project().hidden)}
            >
              {project().hidden ? '⊘' : '◉'}
            </Button>
            <input
              class="ws-project-color"
              classList={{ 'ws-project-color-empty': !project().color }}
              type="color"
              aria-label={`Task tab colour for ${project().name}`}
              title={project().color ? 'Change task tab colour' : 'Choose a task tab colour'}
              value={resolveProjectColor(project().color) ?? PROJECT_COLORS.gray}
              disabled={project().hidden || props.busy}
              onChange={(event) => props.onColor(project().id, event.currentTarget.value)}
            />
            <Show when={project().color}>
              <Button
                variant="bare"
                iconOnly
                label={`Clear task tab colour for ${project().name}`}
                title="Clear task tab colour"
                disabled={project().hidden || props.busy}
                onPress={() => props.onColor(project().id, null)}
              >
                <Icon name="x" />
              </Button>
            </Show>
          </span>
          <RenameField
            label={`Name of ${project().name}`}
            value={project().name}
            disabled={project().hidden}
            onCommit={(field) => void props.onRename(field, project().name, (name) => patchProject(project().id, { name }))}
          />
          {/* data-tip, not title: the shell's own tooltip appears immediately and is legible, where a
              native one waits a second and then renders in the OS chrome. It is the only way to read a
              path the column had to ellipsise. */}
          <span
            class="ws-row-path"
            classList={{ 'ws-row-nopath': !project().path }}
            data-tip={project().path ?? 'No folder on disk'}
            data-tip-sub={project().path ? undefined : 'Use Add folder to point this project at one.'}
          >
            {project().path ?? 'No folder on disk — use Add folder'}
          </span>
          {/* Marks, not words: three facets in the space "Git · GitHub" used to take. Each carries a
              title, so the meaning survives for anyone reading by tooltip or screen reader. */}
          <span class="ws-row-facets">
            <Show when={!project().path}><Icon name="folder-x" title="No folder on disk" /></Show>
            <Show when={project().path && project().vcs !== 'git'}><Icon name="folder" title="Plain folder" /></Show>
            <Show when={project().vcs === 'git'}><Icon name="git-commit-horizontal" title="Git repository" /></Show>
            <Show when={project().github}><Icon name="brand:github" title="GitHub repository" /></Show>
          </span>
          <Select
            label={`Workspace for ${project().name}`}
            disabled={project().hidden || props.busy}
            value={project().workspaceId}
            options={[
              ...props.workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
              { value: NEW_WORKSPACE, label: 'New workspace…' },
            ]}
            onChange={(value) => props.onMove(project(), value)}
          />
          <span class="ws-row-actions">
            <Show when={canPickFolder()}>
              <Button size="sm" disabled={project().hidden} onPress={() => props.onMapFolder(project().id)}>
                {project().path ? 'Change folder' : 'Add folder'}
              </Button>
            </Show>
            <Button
              size="sm"
              variant="bare"
              tone="danger"
              iconOnly
              label={`Delete ${project().name}`}
              title="Delete this project"
              disabled={props.busy}
              onPress={() => props.onDelete(project())}
            >
              <Icon name="trash-2" />
            </Button>
          </span>
        </div>
      )}
    </Index>
  )
}

function DeleteProjectModal(props: {
  project: Project
  taskCount: number
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal onClose={props.onCancel} title="Delete project" size="sm" role="alertdialog">
      <Modal.Body>
        <p>
          Delete <strong>{props.project.name}</strong> from acorn?
        </p>
        <Show when={props.taskCount}>
          <p class="ws-delete-warning">
            This also deletes its {props.taskCount} task{props.taskCount === 1 ? '' : 's'} and their history.
          </p>
        </Show>
        {/* Said plainly because it is the reassuring half AND the incomplete half: the rows go, the
            bytes stay, and a task worktree left on disk is the user's to remove. */}
        <p class="muted">
          Nothing on disk is removed — the folder{props.taskCount ? ' and any task worktrees remain' : ' remains'} where {props.taskCount ? 'they are' : 'it is'}.
        </p>
      </Modal.Body>
      <Modal.Actions>
        <Button variant="bare" onPress={props.onCancel}>Cancel</Button>
        <Button variant="solid" tone="danger" busy={props.busy} onPress={props.onConfirm}>
          {props.taskCount ? `Delete project and ${props.taskCount} task${props.taskCount === 1 ? '' : 's'}` : 'Delete project'}
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

function NewWorkspaceModal(props: {
  project: Project
  busy: boolean
  onCancel: () => void
  onConfirm: (name: string) => void
}) {
  const [name, setName] = createSignal('')
  const submit = (event: Event) => {
    event.preventDefault()
    const value = name().trim()
    if (value) props.onConfirm(value)
  }
  return (
    <Modal onClose={props.onCancel} title="Move to a new workspace" size="sm">
      <form onSubmit={submit}>
        <Modal.Body>
          <p class="muted">Create a workspace and move <strong>{props.project.name}</strong> into it.</p>
          <Input
            placeholder="Workspace name (e.g. Runn)"
            value={name()}
            ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
            onInput={(value) => setName(value)}
          />
        </Modal.Body>
        <Modal.Actions>
          <Button variant="bare" onPress={props.onCancel}>Cancel</Button>
          <Button submit variant="solid" tone="accent" busy={props.busy} disabled={!name().trim()}>Create and move</Button>
        </Modal.Actions>
      </form>
    </Modal>
  )
}
