import { createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { debounce } from '../../../plugins/editor/client/autosave'
import { terminalApi } from '../../../plugins/terminal/client/terminalClient'
import { workspacesKey } from '../queries'
import { deleteWorkspace, renameWorkspace, setWorkspaceColor, setWorkspaceDbUrlScript, setWorkspaceDevRestartScript, setWorkspaceDevScript, setWorkspaceIcon, setWorkspacePreview, setWorkspaceSetupScript, setWorkspaceSetupTrigger, setWorkspaceTeardownScript } from '../../../plugins/github/client/mutations'
import type { PreviewMode, SetupTrigger, Workspace } from '../../shared/api'
import { resolveWorkspaceColor, WORKSPACE_COLORS } from '../../shared/workspaceIdentity'
import { confirmWillEvent } from '../registries/willPhase'
import { clientEvents } from '../registries/clientEvents'

// Settings → per-workspace page: rename, the worktree setup script, and (non-default) delete.
// The setup script is a shell command run once when a task's git worktree is first created
// (docs/workspaces P5) — it shows as the first terminal tab. Blank clears it.
export default function WorkspaceSettings(props: { workspace: Workspace; onDeleted: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = createSignal(props.workspace.name)
  const [script, setScript] = createSignal(props.workspace.setupScript ?? '')
  const [dev, setDev] = createSignal(props.workspace.devScript ?? '')
  const [devRestart, setDevRestart] = createSignal(props.workspace.devRestartScript ?? '')
  const [teardown, setTeardown] = createSignal(props.workspace.teardownScript ?? '')
  const [dbUrl, setDbUrl] = createSignal(props.workspace.dbUrlScript ?? '')
  const [trigger, setTrigger] = createSignal<SetupTrigger>(props.workspace.setupScriptTrigger ?? 'terminal')
  const [previewMode, setPreviewMode] = createSignal<PreviewMode | ''>(props.workspace.previewMode ?? '')
  const [previewValue, setPreviewValue] = createSignal(props.workspace.previewValue ?? '')
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

  // Autosave: text fields debounce while typing and flush on blur; selects/swatches save on change.
  const savePreview = async () => {
    await setWorkspacePreview(props.workspace.id, previewMode(), previewValue())
    await refresh()
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
    await setWorkspaceSetupScript(props.workspace.id, script())
    await refresh()
  }
  const saveDev = async () => {
    await setWorkspaceDevScript(props.workspace.id, dev())
    await refresh()
  }
  const saveDevRestart = async () => {
    await setWorkspaceDevRestartScript(props.workspace.id, devRestart())
    await refresh()
  }
  const saveTeardown = async () => {
    await setWorkspaceTeardownScript(props.workspace.id, teardown())
    await refresh()
  }
  const saveDbUrl = async () => {
    await setWorkspaceDbUrlScript(props.workspace.id, dbUrl())
    await refresh()
  }

  // One debouncer per text field; blur flushes the same pending write immediately.
  const debScript = debounce(() => void saveScript(), 1500)
  const debTeardown = debounce(() => void saveTeardown(), 1500)
  const debDev = debounce(() => void saveDev(), 1500)
  const debDevRestart = debounce(() => void saveDevRestart(), 1500)
  const debPreview = debounce(() => void savePreview(), 1500)
  const debDbUrl = debounce(() => void saveDbUrl(), 1500)
  onCleanup(() => { debScript.flush(); debTeardown.flush(); debDev.flush(); debDevRestart.flush(); debPreview.flush(); debDbUrl.flush() })

  const remove = async () => {
    const confirmed = await confirmWillEvent({
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
          onInput={(e) => { setScript(e.currentTarget.value); debScript() }}
          onBlur={() => debScript.flush()}
        />
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
          onInput={(e) => { setTeardown(e.currentTarget.value); debTeardown() }}
          onBlur={() => debTeardown.flush()}
        />
      </label>

      <label class="settings-field">
        <span class="settings-label">Database connection script</span>
        <span class="muted settings-hint">
          Optional. A shell command run in a task's worktree that prints a Postgres connection URL for the
          Database pane (docs/pg.md). Blank means auto-detect from <code>DATABASE_URL</code> in the
          worktree <code>.env</code> or the environment. Use this for setups auto-detect can't read, e.g.
          <code>bin/rails runner 'puts ActiveRecord::Base.connection_db_config.url'</code>.
        </span>
        <textarea
          class="settings-script"
          rows="2"
          spellcheck={false}
          placeholder="(blank = auto-detect)"
          value={dbUrl()}
          onInput={(e) => { setDbUrl(e.currentTarget.value); debDbUrl() }}
          onBlur={() => debDbUrl.flush()}
        />
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
        <span class="settings-label">Dev script</span>
        <span class="muted settings-hint">
          A custom command for this workspace, shown as a ▶ run button on a task's right rail — it starts/stops
          the script in its own terminal. Blank means no run button. A repo's <code>.acorn/config.toml</code> or
          named run targets override it.
        </span>
        <textarea
          class="settings-script"
          rows="3"
          spellcheck={false}
          placeholder="pnpm dev"
          value={dev()}
          onInput={(e) => { setDev(e.currentTarget.value); debDev() }}
          onBlur={() => debDev.flush()}
        />
      </label>

      <label class="settings-field">
        <span class="settings-label">Dev restart command</span>
        <span class="muted settings-hint">
          Optional. How to restart the dev script in place — e.g. <code>touch tmp/restart.txt</code>. Agents call this
          via the <code>run_restart</code> tool. Blank means restart just stops and starts the dev script again.
        </span>
        <textarea
          class="settings-script"
          rows="2"
          spellcheck={false}
          placeholder="(blank = stop + start)"
          value={devRestart()}
          onInput={(e) => { setDevRestart(e.currentTarget.value); debDevRestart() }}
          onBlur={() => debDevRestart.flush()}
        />
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
            void savePreview()
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
            onInput={(e) => { setPreviewValue(e.currentTarget.value); debPreview() }}
            onBlur={() => debPreview.flush()}
          />
          <span class="muted settings-hint">Run in the task's worktree; its stdout (trimmed) is loaded as the URL.</span>
        </Show>
        <Show when={previewMode() === 'url' || previewMode() === 'port'}>
          <input
            class="integration-key-input"
            type={previewMode() === 'port' ? 'number' : 'text'}
            placeholder={previewMode() === 'port' ? '3000' : 'https://example.test'}
            value={previewValue()}
            onInput={(e) => { setPreviewValue(e.currentTarget.value); debPreview() }}
            onBlur={() => debPreview.flush()}
          />
        </Show>
      </label>

      <Show when={terminalApi() && (props.workspace.repos ?? []).length}>
        <div class="settings-field">
          <span class="settings-label">Run targets (per repo)</span>
          <span class="muted settings-hint">
            Named commands run in a task's worktree (docs/next 13): JSON array of {'{'}"id", "command", "stop"?, "url"?, "urlCommand"?, "default"?{'}'}. A committed <code>.acorn/config.toml</code> overrides these.
          </span>
          <For each={props.workspace.repos ?? []}>
            {(r) => <RepoRunTargets owner={r.owner} name={r.name} />}
          </For>
        </div>
      </Show>

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

// Per-repo run-target JSON editor (docs/next 13 §A) — the DB fallback surface, edited at the
// workspace level like the worktree scripts. Desktop-only (rides the terminal IPC bridge).
function RepoRunTargets(props: { owner: string; name: string }) {
  const api = terminalApi()
  const [row, { refetch }] = createResource(
    () => `${props.owner}/${props.name}`,
    () => api?.repoPath.get(props.owner, props.name) ?? null,
  )
  const [text, setText] = createSignal<string | null>(null)
  const [err, setErr] = createSignal('')
  const value = () => text() ?? row()?.runTargets ?? ''

  const save = async () => {
    if (!api) return
    setErr('')
    const res = await api.repoPath.runTargets(props.owner, props.name, value())
    if (!res.ok) return setErr(res.reason) // invalid JSON stays in the box for the user to fix
    setText(null)
    await refetch()
  }
  const debSave = debounce(() => void save(), 1500)
  onCleanup(() => debSave.flush())

  return (
    <div class="settings-field">
      <span class="muted">{props.owner}/{props.name}</span>
      <Show when={row()} fallback={<span class="muted settings-hint">No local checkout mapped yet.</span>}>
        <textarea
          class="settings-script"
          rows="3"
          spellcheck={false}
          placeholder='[{"id":"dev","command":"./scripts/dev.sh","urlCommand":"./scripts/dev-url.sh","default":true}]'
          value={value()}
          onInput={(e) => { setText(e.currentTarget.value); debSave() }}
          onBlur={() => debSave.flush()}
        />
        <Show when={err()}><span class="action-error">{err()}</span></Show>
      </Show>
    </div>
  )
}
