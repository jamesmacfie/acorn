import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { projectsOptions, workspacesKey } from '../queries'
import { deleteWorkspace, renameWorkspace, setWorkspaceColor, setWorkspaceIcon } from '../workspaces/mutations'
import type { Workspace } from '@acorn/protocol/api.ts'
import { resolveWorkspaceColor, WORKSPACE_COLORS } from '@acorn/protocol/workspaceIdentity.ts'
import { confirmWillEvent } from '../registries/willPhase'
import { clientEvents } from '../registries/clientEvents'
import { ProjectConfig } from './WorkspaceProjectSettings'
import WorkspaceExternalProjects from './WorkspaceExternalProjects'
import { Button } from '../ui/primitives'

// Settings → per-workspace page: workspace IDENTITY (name / icon / colour) + membership + delete.
// Build/run/db/preview config is REPO-level (repo-level-settings): a workspace groups repos, but
// setup/dev/db/preview describe one project, so those editors live in ProjectConfig, one per project.
//
// It also owns the workspace's LINKED PROVIDER PROJECTS (WorkspaceExternalProjects), which is core's
// surface for every integration rather than any one plugin's — see the header there.
export default function WorkspaceSettings(props: { workspace: Workspace; onDeleted: () => void }) {
  const qc = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const [name, setName] = createSignal(props.workspace.name)
  const [busy, setBusy] = createSignal(false)
  const [emoji, setEmoji] = createSignal(props.workspace.icon?.kind === 'emoji' ? props.workspace.icon.value : '')
  const [color, setColor] = createSignal(props.workspace.color ?? '')
  const [hex, setHex] = createSignal(props.workspace.color && !(props.workspace.color in WORKSPACE_COLORS) ? props.workspace.color : '')
  const refresh = () => qc.invalidateQueries({ queryKey: workspacesKey })

  // Identity (docs/workspaces-and-tasks.md): emoji icon (blank clears back to the derived initial) + a colour
  // swatch row (preset tokens) with a free hex input. Saves immediately — these are single scalars.
  const saveIcon = async (value: string) => {
    setBusy(true)
    try {
      await setWorkspaceIcon(props.workspace.id, value.trim() ? { kind: 'emoji', value: value.trim() } : null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  const saveColor = async (value: string | null) => {
    setColor(value ?? '')
    if (value == null || value in WORKSPACE_COLORS) setHex('')
    setBusy(true)
    try {
      await setWorkspaceColor(props.workspace.id, value)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

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
      <div class="settings-field">
        <span class="settings-label">Icon &amp; colour</span>
        <div class="ws-identity-row">
          <span class="ws-identity-preview" style={{ 'border-color': resolveWorkspaceColor(color() || null, props.workspace.name) }}>
            {emoji() || props.workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <input
            class="ui-input ws-emoji-input"
            type="text"
            maxlength="4"
            placeholder="🌰"
            title="Emoji icon — blank uses the workspace initial"
            value={emoji()}
            onInput={(e) => setEmoji(e.currentTarget.value)}
            onBlur={() => void saveIcon(emoji())}
          />
          <div class="ws-swatches">
            <For each={Object.entries(WORKSPACE_COLORS)}>
              {([key, value]) => (
                <button
                  type="button"
                  class="ws-swatch"
                  classList={{ active: color() === key }}
                  style={{ background: value }}
                  title={key}
                  disabled={busy()}
                  onClick={() => void saveColor(key)}
                />
              )}
            </For>
            <input
              class="ui-input ws-hex-input"
              type="text"
              placeholder="#8250df"
              value={hex()}
              onInput={(e) => setHex(e.currentTarget.value)}
              onBlur={() => {
                const v = hex().trim()
                if (!v) return
                if (/^#?[0-9a-fA-F]{6}$/.test(v)) void saveColor(v.startsWith('#') ? v : `#${v}`)
              }}
            />
            <Button disabled={busy() || !color()} onClick={() => void saveColor(null)}>
              Reset
            </Button>
          </div>
        </div>
      </div>

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

      <WorkspaceExternalProjects workspace={props.workspace} />

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
          <Button class="settings-delete" disabled={busy()} onClick={() => void remove()}>
            Delete workspace
          </Button>
        </div>
      </Show>
    </div>
  )
}
