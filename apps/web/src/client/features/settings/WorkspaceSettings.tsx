import { createSignal, For, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { workspacesKey } from '../../queries'
import { deleteWorkspace, renameWorkspace, setWorkspaceColor, setWorkspaceIcon, setWorkspacePreview, setWorkspaceSetupScript, setWorkspaceSetupTrigger, setWorkspaceTeardownScript } from '../../mutations'
import type { PreviewMode, SetupTrigger, Workspace } from '../../../shared/api'
import { resolveWorkspaceColor, WORKSPACE_COLORS } from '../../../shared/workspaceIdentity'

// Settings → per-workspace page: rename, the worktree setup script, and (non-default) delete.
// The setup script is a shell command run once when a task's git worktree is first created
// (docs/workspaces P5) — it shows as the first terminal tab. Blank clears it.
export default function WorkspaceSettings(props: { workspace: Workspace; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = createSignal(props.workspace.name)
  const [script, setScript] = createSignal(props.workspace.setupScript ?? '')
  const [teardown, setTeardown] = createSignal(props.workspace.teardownScript ?? '')
  const [teardownSaved, setTeardownSaved] = createSignal(false)
  const [trigger, setTrigger] = createSignal<SetupTrigger>(props.workspace.setupScriptTrigger ?? 'terminal')
  const [previewMode, setPreviewMode] = createSignal<PreviewMode | ''>(props.workspace.previewMode ?? '')
  const [previewValue, setPreviewValue] = createSignal(props.workspace.previewValue ?? '')
  const [previewSaved, setPreviewSaved] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [emoji, setEmoji] = createSignal(props.workspace.icon?.kind === 'emoji' ? props.workspace.icon.value : '')
  const [color, setColor] = createSignal(props.workspace.color ?? '')
  const [hex, setHex] = createSignal(props.workspace.color && !(props.workspace.color in WORKSPACE_COLORS) ? props.workspace.color : '')
  const refresh = () => qc.invalidateQueries({ queryKey: workspacesKey })

  // Identity (docs/next 01): emoji icon (blank clears back to the derived initial) + a colour
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
  const saveTeardown = async () => {
    setBusy(true)
    setTeardownSaved(false)
    try {
      await setWorkspaceTeardownScript(props.workspace.id, teardown())
      await refresh()
      setTeardownSaved(true)
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
      <div class="settings-field">
        <span class="settings-label">Icon &amp; colour</span>
        <div class="ws-identity-row">
          <span class="ws-identity-preview" style={{ 'border-color': resolveWorkspaceColor(color() || null, props.workspace.name) }}>
            {emoji() || props.workspace.name.slice(0, 1).toUpperCase()}
          </span>
          <input
            class="integration-key-input ws-emoji-input"
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
              class="integration-key-input ws-hex-input"
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
            <button type="button" class="overlay-btn" disabled={busy() || !color()} onClick={() => void saveColor(null)}>
              Reset
            </button>
          </div>
        </div>
      </div>

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
        <span class="settings-label">Worktree teardown script</span>
        <span class="muted settings-hint">
          Runs in the worktree just before it's removed on task close (e.g. <code>docker compose down</code>). Non-zero exit pauses the close.
        </span>
        <textarea
          class="settings-script"
          rows="4"
          spellcheck={false}
          placeholder="docker compose -f dev.yml down"
          value={teardown()}
          onInput={(e) => {
            setTeardown(e.currentTarget.value)
            setTeardownSaved(false)
          }}
        />
        <div class="settings-actions">
          <button type="button" class="overlay-btn" disabled={busy()} onClick={() => void saveTeardown()}>
            {busy() ? 'Saving…' : 'Save teardown'}
          </button>
          <Show when={teardownSaved()}>
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
