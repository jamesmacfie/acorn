import { createResource, createSignal, For, Index, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { debounce } from '../../../plugins/editor/client/autosave'
import { terminalApi } from '../../../plugins/terminal/client/terminalClient'
import { integrationsOptions, workspacesKey } from '../queries'
import { deleteWorkspace, renameWorkspace, setWorkspaceColor, setWorkspaceIcon } from '../../../plugins/github/client/mutations'
import type { BrowserRule, DbSchemaMode, PreviewMode, SetupTrigger, Workspace } from '../../shared/api'
import type { RepoConfigPatch } from '../../shared/terminal'
import { availableModelConnections } from '../../shared/modelProviders'
import { resolveWorkspaceColor, WORKSPACE_COLORS } from '../../shared/workspaceIdentity'
import { confirmWillEvent } from '../registries/willPhase'
import { clientEvents } from '../registries/clientEvents'

// Settings → per-workspace page: workspace IDENTITY (name / icon / colour) + membership + delete.
// Build/run/db/preview config is REPO-level (repo-level-settings): a workspace groups repos, but
// setup/dev/db/preview describe one repo, so those editors live in RepoConfig, one per repo.
export default function WorkspaceSettings(props: { workspace: Workspace; onDeleted: () => void }) {
  const qc = useQueryClient()
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
            <button type="button" class="ui-btn" disabled={busy() || !color()} onClick={() => void saveColor(null)}>
              Reset
            </button>
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

      <Show when={terminalApi() && (props.workspace.repos ?? []).length}>
        <div class="settings-field">
          <span class="settings-label">Repository settings</span>
          <span class="muted settings-hint">
            Build, run, database and preview config for each repo in this workspace. A committed{' '}
            <code>.acorn/config.toml</code> overrides these machine-local values.
          </span>
          <For each={props.workspace.repos ?? []}>
            {(r) => <RepoConfig owner={r.owner} name={r.name} />}
          </For>
        </div>
      </Show>

      <Show when={!props.workspace.isDefault}>
        <div class="settings-danger">
          <button type="button" class="ui-btn settings-delete" disabled={busy()} onClick={() => void remove()}>
            Delete workspace
          </button>
        </div>
      </Show>
    </div>
  )
}

// All repo-level config for one (owner, repo), collapsed behind a native <details> so a workspace
// with several repos isn't an overwhelming wall of fields. Reads/writes the repo_paths row via the
// terminal repoPath bridge; local signals override the fetched row while typing (null = use row).
// Desktop-only — the runtime lives in the main process. Gated on a mapped checkout, like run targets.
function RepoConfig(props: { owner: string; name: string }) {
  const api = terminalApi()
  const [row, { refetch }] = createResource(
    () => `${props.owner}/${props.name}`,
    () => api?.repoPath.get(props.owner, props.name) ?? null,
  )
  const [setup, setSetup] = createSignal<string | null>(null)
  const [teardown, setTeardown] = createSignal<string | null>(null)
  const [dbUrl, setDbUrl] = createSignal<string | null>(null)
  const [dev, setDev] = createSignal<string | null>(null)
  const [devRestart, setDevRestart] = createSignal<string | null>(null)
  const [dbSchemaValue, setDbSchemaValue] = createSignal<string | null>(null)
  const [dbSchemaNotes, setDbSchemaNotes] = createSignal<string | null>(null)
  const [previewValue, setPreviewValue] = createSignal<string | null>(null)
  const [branchPrefix, setBranchPrefix] = createSignal<string | null>(null)
  const [err, setErr] = createSignal('')

  // Gate the AI-SQL schema-source editor on a configured model provider connection (the feature is
  // useless without one), matching where SQL generation itself is available.
  const integrations = createQuery(() => integrationsOptions(true))
  const hasModelConnection = () => {
    const data = integrations.data
    return data ? availableModelConnections(data).length > 0 : false
  }

  const trigger = (): SetupTrigger => row()?.setupScriptTrigger ?? 'terminal'
  const dbSchemaMode = (): DbSchemaMode | '' => row()?.dbSchemaMode ?? ''
  const previewMode = (): PreviewMode | '' => row()?.previewMode ?? ''

  const save = async (patch: RepoConfigPatch) => {
    if (!api) return
    setErr('')
    const res = await api.repoPath.config(props.owner, props.name, patch)
    if (!res.ok) return setErr(res.reason)
    await refetch()
  }
  const debSetup = debounce(() => void save({ setupScript: setup() ?? '' }), 1500)
  const debTeardown = debounce(() => void save({ teardownScript: teardown() ?? '' }), 1500)
  const debDbUrl = debounce(() => void save({ dbUrlScript: dbUrl() ?? '' }), 1500)
  const debDev = debounce(() => void save({ devScript: dev() ?? '' }), 1500)
  const debDevRestart = debounce(() => void save({ devRestartScript: devRestart() ?? '' }), 1500)
  const debDbSchema = debounce(() => void save({ dbSchemaValue: dbSchemaValue() ?? '' }), 1500)
  const debDbNotes = debounce(() => void save({ dbSchemaNotes: dbSchemaNotes() ?? '' }), 1500)
  const debPreview = debounce(() => void save({ previewValue: previewValue() ?? '' }), 1500)
  // The prefix is normalised server-side ('feature' → 'feature/'), so drop the local override once
  // saved — the refetched row is the canonical value and the input should show it, not the raw typing.
  const debBranchPrefix = debounce(() => void save({ branchPrefix: branchPrefix() ?? '' }).then(() => setBranchPrefix(null)), 1500)
  onCleanup(() => { debSetup.flush(); debTeardown.flush(); debDbUrl.flush(); debDev.flush(); debDevRestart.flush(); debDbSchema.flush(); debDbNotes.flush(); debPreview.flush(); debBranchPrefix.flush() })

  return (
    <details class="settings-repo-config">
      <summary class="muted">{props.owner}/{props.name}</summary>
      <Show when={row()} fallback={<span class="muted settings-hint">No local checkout mapped yet.</span>}>
        <label class="settings-field">
          <span class="settings-label">Task branch prefix</span>
          <span class="muted settings-hint">
            Prepended to the branch a new task derives from its title — <code>jamesmacfie/</code> gives{' '}
            <code>jamesmacfie/fix-the-thing</code>. A trailing <code>-</code> is kept as the separator, otherwise{' '}
            <code>/</code> is added. Blank means no prefix.
          </span>
          <input
            class="ui-input"
            type="text"
            spellcheck={false}
            placeholder="jamesmacfie/"
            value={branchPrefix() ?? row()?.branchPrefix ?? ''}
            onInput={(e) => { setBranchPrefix(e.currentTarget.value); debBranchPrefix() }}
            onBlur={() => debBranchPrefix.flush()}
          />
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
            value={setup() ?? row()?.setupScript ?? ''}
            onInput={(e) => { setSetup(e.currentTarget.value); debSetup() }}
            onBlur={() => debSetup.flush()}
          />
        </label>

        <label class="settings-field">
          <span class="settings-label">Run the script</span>
          <select class="ui-input" value={trigger()} onChange={(e) => void save({ setupScriptTrigger: e.currentTarget.value as SetupTrigger })}>
            <option value="terminal">When the terminal is first opened</option>
            <option value="created">When the task is created</option>
            <option value="off">Off — never run it</option>
          </select>
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
            value={teardown() ?? row()?.teardownScript ?? ''}
            onInput={(e) => { setTeardown(e.currentTarget.value); debTeardown() }}
            onBlur={() => debTeardown.flush()}
          />
        </label>

        <label class="settings-field">
          <span class="settings-label">Database connection script</span>
          <span class="muted settings-hint">
            Optional. A shell command run in a task's worktree that prints a Postgres connection URL for the
            Database pane. Blank means auto-detect from <code>DATABASE_URL</code> in the
            worktree <code>.env</code> or the environment. Use this for setups auto-detect can't read, e.g.
            <code>bin/rails runner 'puts ActiveRecord::Base.connection_db_config.url'</code>.
          </span>
          <textarea
            class="settings-script"
            rows="2"
            spellcheck={false}
            placeholder="(blank = auto-detect)"
            value={dbUrl() ?? row()?.dbUrlScript ?? ''}
            onInput={(e) => { setDbUrl(e.currentTarget.value); debDbUrl() }}
            onBlur={() => debDbUrl.flush()}
          />
        </label>

        <Show when={hasModelConnection()}>
          <label class="settings-field">
            <span class="settings-label">SQL generation schema source</span>
            <span class="muted settings-hint">
              Where the database schema in the AI query-generation prompt comes from.
            </span>
            <select
              class="ui-input"
              value={dbSchemaMode()}
              onChange={(e) => { setDbSchemaValue(null); void save({ dbSchemaMode: e.currentTarget.value as DbSchemaMode | '' }) }}
            >
              <option value="">Live database introspection (default)</option>
              <option value="script">Script — its output is the schema</option>
              <option value="file">File in the worktree</option>
            </select>
            <Show when={dbSchemaMode() === 'script'}>
              <textarea
                class="settings-script"
                rows="2"
                spellcheck={false}
                placeholder={'pg_dump --schema-only "$DATABASE_URL"'}
                value={dbSchemaValue() ?? row()?.dbSchemaValue ?? ''}
                onInput={(e) => { setDbSchemaValue(e.currentTarget.value); debDbSchema() }}
                onBlur={() => debDbSchema.flush()}
              />
              <span class="muted settings-hint">Run in the task's worktree; its stdout is used as the schema.</span>
            </Show>
            <Show when={dbSchemaMode() === 'file'}>
              <input
                class="ui-input"
                type="text"
                placeholder="db/schema.sql"
                value={dbSchemaValue() ?? row()?.dbSchemaValue ?? ''}
                onInput={(e) => { setDbSchemaValue(e.currentTarget.value); debDbSchema() }}
                onBlur={() => debDbSchema.flush()}
              />
              <span class="muted settings-hint">A path relative to the task's worktree root.</span>
            </Show>
          </label>

          <label class="settings-field">
            <span class="settings-label">Schema notes</span>
            <span class="muted settings-hint">
              Optional. Free-form context for AI query generation that the schema itself can't express —
              what a <code>jsonb</code> column actually holds, what a status column's values mean, which of
              two similar tables is live. Sent with the schema on every generate.
            </span>
            <textarea
              class="settings-script"
              rows="6"
              spellcheck={false}
              placeholder={'orders.meta jsonb: { coupon: string, source: "web" | "app" }\norders.status: 0 pending, 1 paid, 2 refunded'}
              value={dbSchemaNotes() ?? row()?.dbSchemaNotes ?? ''}
              onInput={(e) => { setDbSchemaNotes(e.currentTarget.value); debDbNotes() }}
              onBlur={() => debDbNotes.flush()}
            />
          </label>
        </Show>

        <label class="settings-field">
          <span class="settings-label">Dev script</span>
          <span class="muted settings-hint">
            A ▶ run button on a task's right rail — it starts/stops the script in its own terminal. Blank means no
            run button. A repo's <code>.acorn/config.toml</code> or named run targets override it.
          </span>
          <textarea
            class="settings-script"
            rows="3"
            spellcheck={false}
            placeholder="pnpm dev"
            value={dev() ?? row()?.devScript ?? ''}
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
            value={devRestart() ?? row()?.devRestartScript ?? ''}
            onInput={(e) => { setDevRestart(e.currentTarget.value); debDevRestart() }}
            onBlur={() => debDevRestart.flush()}
          />
        </label>

        <label class="settings-field">
          <span class="settings-label">Browser preview URL</span>
          <span class="muted settings-hint">How the browser-preview pane finds its URL for this repo's tasks.</span>
          <select
            class="ui-input"
            value={previewMode()}
            onChange={(e) => { setPreviewValue(null); void save({ previewMode: e.currentTarget.value as PreviewMode | '' }) }}
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
              value={previewValue() ?? row()?.previewValue ?? ''}
              onInput={(e) => { setPreviewValue(e.currentTarget.value); debPreview() }}
              onBlur={() => debPreview.flush()}
            />
            <span class="muted settings-hint">Run in the task's worktree; its stdout (trimmed) is loaded as the URL.</span>
          </Show>
          <Show when={previewMode() === 'url' || previewMode() === 'port'}>
            <input
              class="ui-input"
              type={previewMode() === 'port' ? 'number' : 'text'}
              placeholder={previewMode() === 'port' ? '3000' : 'https://example.test'}
              value={previewValue() ?? row()?.previewValue ?? ''}
              onInput={(e) => { setPreviewValue(e.currentTarget.value); debPreview() }}
              onBlur={() => debPreview.flush()}
            />
          </Show>
        </label>

        <div class="settings-field">
          <span class="settings-label">Page rules</span>
          <span class="muted settings-hint">
            On page load in the preview browser, fill an input (CSS selector) with a value when the URL matches
            the pattern (substring; <code>*</code> is a wildcard, a trailing <code>$</code> anchors to the end —
            e.g. <code>*/$</code> matches only the root) — e.g. auto-fill a dev login. Values are stored
            plainly in the local database: dev credentials only, never production secrets.
          </span>
          <BrowserRulesEditor rules={row()?.browserRules ?? []} onSave={(rules) => save({ browserRules: rules })} />
        </div>

        <div class="settings-field">
          <span class="settings-label">Run targets</span>
          <span class="muted settings-hint">
            Named commands run in a task's worktree: JSON array of {'{'}"id", "command", "stop"?, "url"?, "urlCommand"?, "default"?{'}'}. A committed <code>.acorn/config.toml</code> overrides these.
          </span>
          <RepoRunTargets owner={props.owner} name={props.name} />
        </div>

        <Show when={err()}><span class="action-error">{err()}</span></Show>
      </Show>
    </details>
  )
}

// Preview-browser page rules (docs/panes.md): row-per-rule editor over a repo's browserRules array.
// Whole-array save; rows missing a pattern or selector are kept locally but not saved, so half-typed
// rules never 400 against the strict route validation.
function BrowserRulesEditor(props: { rules: BrowserRule[]; onSave: (rules: BrowserRule[]) => Promise<unknown> }) {
  const [rules, setRules] = createSignal<BrowserRule[]>(props.rules)

  const save = async () => {
    await props.onSave(rules().filter((r) => r.urlPattern.trim() && r.action.selector.trim()))
  }
  const debSave = debounce(() => void save(), 1500)
  onCleanup(() => debSave.flush())

  const update = (id: string, patch: (r: BrowserRule) => BrowserRule) =>
    setRules((list) => list.map((r) => (r.id === id ? patch(r) : r)))
  const add = () =>
    setRules((list) => [...list, { id: crypto.randomUUID(), enabled: true, urlPattern: '', trigger: 'load', action: { type: 'fill', selector: '', value: '' } }])
  const remove = (id: string) => {
    setRules((list) => list.filter((r) => r.id !== id))
    debSave()
    debSave.flush()
  }

  return (
    <>
      {/* Index (not For): keys by position so editing a rule doesn't remount its row and defocus the input. */}
      <Index each={rules()}>
        {(rule) => (
          <div class="integration-key-row">
            <input
              type="checkbox"
              title="Enabled"
              checked={rule().enabled}
              onChange={(e) => { update(rule().id, (r) => ({ ...r, enabled: e.currentTarget.checked })); debSave(); debSave.flush() }}
            />
            <input
              class="ui-input"
              type="text"
              placeholder="localhost:3000/login"
              title="URL pattern"
              value={rule().urlPattern}
              onInput={(e) => { update(rule().id, (r) => ({ ...r, urlPattern: e.currentTarget.value })); debSave() }}
              onBlur={() => debSave.flush()}
            />
            <input
              class="ui-input"
              type="text"
              placeholder="input[type=password]"
              title="CSS selector of the input to fill"
              value={rule().action.selector}
              onInput={(e) => { update(rule().id, (r) => ({ ...r, action: { ...r.action, selector: e.currentTarget.value } })); debSave() }}
              onBlur={() => debSave.flush()}
            />
            <input
              class="ui-input"
              type="text"
              placeholder="value to type"
              title="Text typed into the input"
              value={rule().action.value}
              onInput={(e) => { update(rule().id, (r) => ({ ...r, action: { ...r.action, value: e.currentTarget.value } })); debSave() }}
              onBlur={() => debSave.flush()}
            />
            <button type="button" class="ui-btn" title="Delete rule" onClick={() => remove(rule().id)}>
              ×
            </button>
          </div>
        )}
      </Index>
      <div>
        <button type="button" class="ui-btn" onClick={add}>
          Add rule
        </button>
      </div>
    </>
  )
}

// Per-repo run-target JSON editor (docs/workflows.md §2) — the DB fallback surface. Desktop-only
// because it uses the main-process runtime.
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
  )
}
