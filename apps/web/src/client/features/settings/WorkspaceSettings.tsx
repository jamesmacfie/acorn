import { createSignal, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { workspacesKey } from '../../queries'
import { deleteWorkspace, renameWorkspace, setWorkspacePreview, setWorkspaceSetupScript, setWorkspaceSetupTrigger } from '../../mutations'
import type { PreviewMode, SetupTrigger, Workspace } from '../../../shared/api'

// Settings → per-workspace page: rename, the worktree setup script, and (non-default) delete.
// The setup script is a shell command run once when a task's git worktree is first created
// (docs/workspaces P5) — it shows as the first terminal tab. Blank clears it.
export default function WorkspaceSettings(props: { workspace: Workspace; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = createSignal(props.workspace.name)
  const [script, setScript] = createSignal(props.workspace.setupScript ?? '')
  const [trigger, setTrigger] = createSignal<SetupTrigger>(props.workspace.setupScriptTrigger ?? 'terminal')
  const [previewMode, setPreviewMode] = createSignal<PreviewMode | ''>(props.workspace.previewMode ?? '')
  const [previewValue, setPreviewValue] = createSignal(props.workspace.previewValue ?? '')
  const [previewSaved, setPreviewSaved] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const refresh = () => qc.invalidateQueries({ queryKey: workspacesKey })

  const savePreview = async () => {
    setBusy(true)
    setPreviewSaved(false)
    try {
      await setWorkspacePreview(props.workspace.id, previewMode(), previewValue())
      await refresh()
      setPreviewSaved(true)
    } finally {
      setBusy(false)
    }
  }

  const changeTrigger = async (t: SetupTrigger) => {
    setTrigger(t)
    setBusy(true)
    try {
      await setWorkspaceSetupTrigger(props.workspace.id, t)
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
  const saveScript = async () => {
    setBusy(true)
    setSaved(false)
    try {
      await setWorkspaceSetupScript(props.workspace.id, script())
      await refresh()
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!window.confirm(`Delete workspace “${props.workspace.name}”? Its repos move back to Default.`)) return
    setBusy(true)
    try {
      await deleteWorkspace(props.workspace.id)
      await refresh()
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
            class="integration-key-input"
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

      <label class="settings-field">
        <span class="settings-label">Worktree setup script</span>
        <span class="muted settings-hint">
          A shell command run once in a new task's git worktree, shown as the first terminal tab. Choose when it runs below.
        </span>
        <textarea
          class="settings-script"
          rows="6"
          spellcheck={false}
          placeholder="./scripts/setup-worktree.sh"
          value={script()}
          onInput={(e) => {
            setScript(e.currentTarget.value)
            setSaved(false)
          }}
        />
        <div class="settings-actions">
          <button type="button" class="overlay-btn" disabled={busy()} onClick={() => void saveScript()}>
            {busy() ? 'Saving…' : 'Save script'}
          </button>
          <Show when={saved()}>
            <span class="muted">Saved.</span>
          </Show>
        </div>
      </label>

      <label class="settings-field">
        <span class="settings-label">Run the script</span>
        <select class="integration-key-input" disabled={busy()} value={trigger()} onChange={(e) => void changeTrigger(e.currentTarget.value as SetupTrigger)}>
          <option value="terminal">When the terminal is first opened</option>
          <option value="created">When the task is created</option>
          <option value="off">Off — never run it</option>
        </select>
      </label>

      <label class="settings-field">
        <span class="settings-label">Browser preview URL</span>
        <span class="muted settings-hint">
          How the browser-preview pane finds its URL for tasks in this workspace.
        </span>
        <select
          class="integration-key-input"
          disabled={busy()}
          value={previewMode()}
          onChange={(e) => {
            setPreviewMode(e.currentTarget.value as PreviewMode | '')
            setPreviewSaved(false)
          }}
        >
          <option value="">Dev-server port (default)</option>
          <option value="url">A fixed URL</option>
          <option value="port">localhost with a port</option>
          <option value="script">Script — its output is the URL</option>
        </select>
        <Show when={previewMode() === 'script'}>
          <textarea
            class="settings-script"
            rows="4"
            spellcheck={false}
            placeholder="./scripts/preview-url.sh"
            value={previewValue()}
            onInput={(e) => {
              setPreviewValue(e.currentTarget.value)
              setPreviewSaved(false)
            }}
          />
          <span class="muted settings-hint">Run in the task's worktree; its stdout (trimmed) is loaded as the URL.</span>
        </Show>
        <Show when={previewMode() === 'url' || previewMode() === 'port'}>
          <input
            class="integration-key-input"
            type={previewMode() === 'port' ? 'number' : 'text'}
            placeholder={previewMode() === 'port' ? '3000' : 'https://example.test'}
            value={previewValue()}
            onInput={(e) => {
              setPreviewValue(e.currentTarget.value)
              setPreviewSaved(false)
            }}
          />
        </Show>
        <div class="settings-actions">
          <button type="button" class="overlay-btn" disabled={busy()} onClick={() => void savePreview()}>
            {busy() ? 'Saving…' : 'Save preview'}
          </button>
          <Show when={previewSaved()}>
            <span class="muted">Saved.</span>
          </Show>
        </div>
      </label>

      <Show when={!props.workspace.isDefault}>
        <div class="settings-danger">
          <button type="button" class="overlay-btn settings-delete" disabled={busy()} onClick={() => void remove()}>
            Delete workspace
          </button>
        </div>
      </Show>
    </div>
  )
}
