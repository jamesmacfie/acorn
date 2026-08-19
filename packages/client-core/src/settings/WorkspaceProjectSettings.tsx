import { createQuery } from '@tanstack/solid-query'
import { createResource, createSignal, Index, onCleanup, Show } from 'solid-js'
import { debounce } from '../lib/debounce'
import { taskBridge } from '../tasks/taskBridge'
import { integrationsOptions } from '../queries'
import type { BrowserRule, DbSchemaMode, PreviewMode, SetupTrigger } from '@acorn/protocol/api.ts'
import type { ProjectConfigPatch } from '@acorn/protocol/api.ts'
import { availableModelConnections } from '@acorn/protocol/modelProviders.ts'
import { Alert, Button, Checkbox, Select } from '../ui/primitives'

// All project-level config for one folder project, collapsed behind a native <details> so a workspace
// with several projects isn't an overwhelming wall of fields. Reads/writes the project row through
// the project bridge; local signals override the fetched row while typing (null = use row).
// Gated on a mapped checkout, like run targets: the scripts run on the NODE, so the hosting client is
// irrelevant. (Was labelled desktop-only, from when every route here was a preload bridge.)
export function ProjectConfig(props: { projectId: string; name: string }) {
  const api = taskBridge()
  const [row, { refetch }] = createResource(
    () => props.projectId,
    () => api.project.get(props.projectId),
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

  const config = () => row()?.config
  const trigger = (): SetupTrigger => config()?.setupScriptTrigger ?? 'terminal'
  const dbSchemaMode = (): DbSchemaMode | '' => config()?.dbSchemaMode ?? ''
  const previewMode = (): PreviewMode | '' => config()?.previewMode ?? ''

  const save = async (patch: ProjectConfigPatch) => {
    setErr('')
    await api.project.config(props.projectId, patch)
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
      <summary class="muted">{props.name}</summary>
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
            value={branchPrefix() ?? config()?.branchPrefix ?? ''}
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
            value={setup() ?? config()?.setupScript ?? ''}
            onInput={(e) => { setSetup(e.currentTarget.value); debSetup() }}
            onBlur={() => debSetup.flush()}
          />
        </label>

        <label class="settings-field">
          <span class="settings-label">Run the script</span>
          <Select value={trigger()} onChange={(e) => void save({ setupScriptTrigger: e.currentTarget.value as SetupTrigger })}>
            <option value="terminal">When the terminal is first opened</option>
            <option value="created">When the task is created</option>
            <option value="off">Off — never run it</option>
          </Select>
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
            value={teardown() ?? config()?.teardownScript ?? ''}
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
            value={dbUrl() ?? config()?.dbUrlScript ?? ''}
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
            <Select
              value={dbSchemaMode()}
              onChange={(e) => { setDbSchemaValue(null); void save({ dbSchemaMode: e.currentTarget.value as DbSchemaMode | '' }) }}
            >
              <option value="">Live database introspection (default)</option>
              <option value="script">Script — its output is the schema</option>
              <option value="file">File in the worktree</option>
            </Select>
            <Show when={dbSchemaMode() === 'script'}>
              <textarea
                class="settings-script"
                rows="2"
                spellcheck={false}
                placeholder={'pg_dump --schema-only "$DATABASE_URL"'}
            value={dbSchemaValue() ?? config()?.dbSchemaValue ?? ''}
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
            value={dbSchemaValue() ?? config()?.dbSchemaValue ?? ''}
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
            value={dbSchemaNotes() ?? config()?.dbSchemaNotes ?? ''}
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
            value={dev() ?? config()?.devScript ?? ''}
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
            value={devRestart() ?? config()?.devRestartScript ?? ''}
            onInput={(e) => { setDevRestart(e.currentTarget.value); debDevRestart() }}
            onBlur={() => debDevRestart.flush()}
          />
        </label>

        <label class="settings-field">
          <span class="settings-label">Browser preview URL</span>
          <span class="muted settings-hint">How the browser-preview pane finds its URL for this repo's tasks.</span>
          <Select
            value={previewMode()}
            onChange={(e) => { setPreviewValue(null); void save({ previewMode: e.currentTarget.value as PreviewMode | '' }) }}
          >
            <option value="">Dev-server port (default)</option>
            <option value="url">A fixed URL</option>
            <option value="port">localhost with a port</option>
            <option value="script">Script — its output is the URL</option>
          </Select>
          <Show when={previewMode() === 'script'}>
            <textarea
              class="settings-script"
              rows="4"
              spellcheck={false}
              placeholder="./scripts/preview-url.sh"
            value={previewValue() ?? config()?.previewValue ?? ''}
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
            value={previewValue() ?? config()?.previewValue ?? ''}
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
      <BrowserRulesEditor rules={config()?.browserRules ?? []} onSave={(rules) => save({ browserRules: rules })} />
        </div>

        <div class="settings-field">
          <span class="settings-label">Run targets</span>
          <span class="muted settings-hint">
            Named commands run in a task's worktree: JSON array of {'{'}"id", "command", "stop"?, "url"?, "urlCommand"?, "default"?{'}'}. A committed <code>.acorn/config.toml</code> overrides these.
          </span>
          <RepoRunTargets projectId={props.projectId} />
        </div>

        <Show when={err()}><Alert>{err()}</Alert></Show>
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
            <Checkbox
              aria-label="Enabled"
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
            <Button title="Delete rule" onClick={() => remove(rule().id)}>
              ×
            </Button>
          </div>
        )}
      </Index>
      <div>
        <Button onClick={add}>
          Add rule
        </Button>
      </div>
    </>
  )
}

// Per-repo run-target JSON editor (docs/workflows.md §2) — the DB fallback surface. Desktop-only
// because it uses the main-process runtime.
function RepoRunTargets(props: { projectId: string }) {
  const api = taskBridge()
  const [row, { refetch }] = createResource(
    () => props.projectId,
    () => api.project.get(props.projectId),
  )
  const [text, setText] = createSignal<string | null>(null)
  const [err, setErr] = createSignal('')
  const value = () => text() ?? row()?.config.runTargets ?? ''

  const save = async () => {
    setErr('')
    try {
      await api.project.runTargets(props.projectId, value())
    } catch (cause) {
      return setErr(cause instanceof Error ? cause.message : 'Invalid run targets.')
    }
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
      <Show when={err()}><Alert>{err()}</Alert></Show>
    </Show>
  )
}
