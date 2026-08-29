import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { projectsOptions, workspacesKey } from '../queries'
import { deleteWorkspace, renameWorkspace } from '../workspaces/mutations'
import type { Workspace } from '@acorn/protocol/api.ts'
import { confirmWillEvent } from '../registries/willPhase'
import { clientEvents } from '../registries/clientEvents'
import { ProjectConfig } from './WorkspaceProjectSettings'
import { Button } from '../ui/primitives'

// Settings → per-workspace page: workspace name + membership + delete.
// Build/run/db/preview config is repo-level (docs/workspaces-and-tasks.md § Worktrees and setup): a
// workspace groups repos, but setup/dev/db/preview describe one project, so those editors live in
// ProjectConfig, one per project.
//
// Which provider projects a workspace follows is edited from the connection instead, in Settings →
// Integrations (settings/ConnectionProjectMap.tsx): one connection usually serves several workspaces,
// so its whole map reads better in one place than a checkbox list repeated on every workspace page.
export default function WorkspaceSettings(props: { workspace: Workspace; onDeleted: () => void }) {
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const [name, setName] = createSignal(props.workspace.name)
  const [busy, setBusy] = createSignal(false)
  const refresh = () => qc.invalidateQueries({ queryKey: workspacesKey })

  const saveName = async () => {
    const n = name().trim()
    if (!n || n === props.workspace.name) return
    setBusy(true)
    try {
      await renameWorkspace(props.workspace.id, n)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const { confirmed } = await confirmWillEvent({
      kind: 'workspace:remove',
      payload: { workspaceId: props.workspace.id, name: props.workspace.name },
      title: 'Delete workspace',
      actionLabel: 'Delete workspace',
      alwaysConfirm: true,
      concerns: [{ id: `workspace:${props.workspace.id}`, feature: 'Workspaces', message: 'Its repositories move back to Default', severity: 'danger' }],
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await deleteWorkspace(props.workspace.id)
      await refresh()
      clientEvents.emit('runtime:workspace-removed', { workspaceId: props.workspace.id })
      props.onDeleted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="settings-section">
      <label class="settings-field">
        <span class="settings-label">Name</span>
        <div class="integration-key-row">
          <input
            class="ui-input"
            type="text"
            value={name()}
            disabled={props.workspace.isDefault}
            onInput={(e) => setName(e.currentTarget.value)}
            onBlur={() => void saveName()}
            onKeyDown={(e) => e.key === 'Enter' && void saveName()}
          />
        </div>
        <Show when={props.workspace.isDefault}>
          <span class="muted settings-hint">The Default workspace can't be renamed.</span>
        </Show>
      </label>

      <Show when={(projects.data ?? []).some((project) => project.workspaceId === props.workspace.id)}>
        <div class="settings-field">
          <span class="settings-label">Project settings</span>
          <span class="muted settings-hint">
            Build, run, database and preview config for each project in this workspace. A committed{' '}
            <code>.acorn/config.toml</code> overrides these machine-local values.
          </span>
          <For each={(projects.data ?? []).filter((project) => project.workspaceId === props.workspace.id)}>
            {(project) => <ProjectConfig projectId={project.id} name={project.name} />}
          </For>
        </div>
      </Show>

      <Show when={!props.workspace.isDefault}>
        <div class="settings-danger">
          <Button disabled={busy()} onPress={() => void remove()}>
            Delete workspace
          </Button>
        </div>
      </Show>
    </div>
  )
}
