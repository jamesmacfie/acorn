import { createQuery } from '@tanstack/solid-query'
import { createResource, createSignal, Index, Match, Show, Switch } from 'solid-js'
import { taskBridge } from '../tasks/taskBridge'
import { modelBackendsOptions } from '../../infra/queries'
import type { BrowserRule, DbSchemaMode, PreviewMode, ProjectConfigPatch, ProjectConfigResponse, SetupTrigger } from '@acorn/protocol/api.ts'
import { Button, Checkbox, Input, Select, Textarea } from '../../kit/components/primitives'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Text } from '../../kit/components/content/Text'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { REPO_CONFIG_FILE, RunTargetsTable } from './RunTargetsTable'
import { createSettingSave, createTextSetting } from './settingSave'

// The project-level config of one folder project (docs/workspaces-and-tasks.md § Worktrees and setup),
// split over the project page's tabs. Reads and writes the project row through the project bridge, on
// the settings save model (./settingSave.ts): selects save when they change, text saves on blur or Enter.
//
// A value the checkout's committed `.acorn/config.toml` sets wins over the row, so its row says so, goes
// read-only, and shows the file's value above the one this machine holds. The node says which values
// those are (`repoConfig` on the config read); nothing here reads the file.

/** One project's config read and its writes, shared by every tab so a save on one tab refetches the
 *  value every other tab shows. */
export type ProjectConfigStore = {
  /** The last read, or undefined before the first one lands or when it failed. */
  response: () => ProjectConfigResponse | undefined
  /** The last read failed. */
  failed: () => boolean
  /** Resolves once the refetched row is in, which is when a text field may drop what was typed and
   *  show the stored value. The branch prefix relies on that: the node normalises it ('feature' becomes
   *  'feature/'), and the field then shows the normalised form. */
  save: (patch: ProjectConfigPatch) => Promise<void>
  saveRunTargets: (json: string) => Promise<void>
}

export function createProjectConfig(projectId: () => string): ProjectConfigStore {
  const api = taskBridge()
  const [row, { refetch }] = createResource(projectId, (id) => api.project.get(id))
  // The last value read, kept through a refetch that fails, so a save whose read-back fails does not
  // take the tabs, and a form open on one of them, off the screen.
  let last: ProjectConfigResponse | undefined
  return {
    // By state rather than a read, which would suspend the whole page, General tab included, until the
    // first answer; `latest` does the same before anything has resolved. Before the first answer the
    // tabs say they are reading, and after a failed one they say that.
    response: () => {
      if (row.state === 'ready' || row.state === 'refreshing') last = row.latest ?? undefined
      return last
    },
    failed: () => !!row.error,
    save: async (patch) => {
      await api.project.config(projectId(), patch)
      await refetch()
    },
    saveRunTargets: async (json) => {
      await api.project.runTargets(projectId(), json)
      await refetch()
    },
  }
}

const config = (store: ProjectConfigStore) => store.response()?.config
const repo = (store: ProjectConfigStore) => store.response()?.repoConfig

/** Task branch prefix, on the General tab. */
export function BranchPrefixRow(props: { store: ProjectConfigStore }) {
  return (
    <ConfigText
      label="Task branch prefix"
      description="Added to the start of each new task's branch name."
      help="For example, your-name/ gives your-name/fix-login. acorn adds a / unless you end it with -. Leave it blank for no prefix."
      placeholder="your-name/"
      value={config(props.store)?.branchPrefix ?? ''}
      save={(value) => props.store.save({ branchPrefix: value })}
    />
  )
}

export function SetupTab(props: { store: ProjectConfigStore }) {
  const trigger = (): SetupTrigger => config(props.store)?.setupScriptTrigger ?? 'terminal'
  const triggerSave = createSettingSave()
  // The repo's `dev` run target replaces the one the dev script makes, restart command and all
  // (server/runConfig.ts § loadRepoConfig).
  const repoDev = () => repo(props.store)?.runTargets.find((target) => target.id === 'dev')
  return (
    <>
      <SettingsSection id="worktree" label="Worktree">
        <ConfigText
          label="Setup script"
          description="Runs once in each new task's worktree, in its first terminal tab."
          lines={4}
          placeholder="./scripts/setup-worktree.sh"
          value={config(props.store)?.setupScript ?? ''}
          save={(value) => props.store.save({ setupScript: value })}
        />
        <SettingRow label="When to run it" error={triggerSave.error()}>
          <Select
            label="When to run it"
            value={trigger()}
            onChange={(value) => void triggerSave.run(() => props.store.save({ setupScriptTrigger: value as SetupTrigger }))}
            options={[{ value: 'terminal', label: 'When the terminal first opens' }, { value: 'created', label: 'When the task is created' }, { value: 'off', label: 'Never' }]}
          />
        </SettingRow>
        <ConfigText
          label="Teardown script"
          description="Runs in the worktree before acorn removes it when you close the task."
          help="If the script fails, the task stays open so you can check what went wrong."
          lines={4}
          placeholder="docker compose -f dev.yml down"
          value={config(props.store)?.teardownScript ?? ''}
          save={(value) => props.store.save({ teardownScript: value })}
        />
      </SettingsSection>

      <SettingsSection id="dev" label="Dev script">
        <ConfigText
          label="Command"
          description="Adds a run button to each task that starts and stops this command."
          help="It runs in its own terminal. Leave it blank for no run button. A run target named dev, or a dev entry in a config file, takes over from this."
          lines={2}
          placeholder="pnpm dev"
          value={config(props.store)?.devScript ?? ''}
          repoValue={repoDev()?.command}
          save={(value) => props.store.save({ devScript: value })}
        />
        <ConfigText
          label="Restart command"
          description="Leave blank to stop and start the command instead."
          help="A command that restarts the dev server in place, such as touch tmp/restart.txt. Agents use it too."
          lines={2}
          placeholder="touch tmp/restart.txt"
          value={config(props.store)?.devRestartScript ?? ''}
          repoValue={repoDev() ? repoDev()?.restart ?? 'Not set. Restart stops and starts it.' : undefined}
          save={(value) => props.store.save({ devRestartScript: value })}
        />
      </SettingsSection>

      <SettingsSection id="run-targets" label="Run targets" help="Each run target is a button on the task that runs its command in the task's worktree.">
        <RunTargetsTable
          stored={config(props.store)?.runTargets ?? null}
          repoTargets={repo(props.store)?.runTargets ?? []}
          save={props.store.saveRunTargets}
        />
      </SettingsSection>
    </>
  )
}

export function PreviewTab(props: { store: ProjectConfigStore }) {
  const previewMode = (): PreviewMode | '' => config(props.store)?.previewMode ?? ''
  const previewModeSave = createSettingSave()
  const repoMode = () => repo(props.store)?.previewMode
  const repoValue = () => repo(props.store)?.previewValue
  // The file can set the mode, the value, or both, so what the repo resolves to is drawn on the mode
  // row: the mode below may be this machine's, and a value row for it may not be showing at all.
  const repoPreview = () => {
    if (!repoMode() && !repoValue()) return undefined
    const mode = modeLabels[repoMode() ?? previewMode()]
    return repoValue() ? `${mode}: ${repoValue()}` : mode
  }
  const modeLabels: Record<PreviewMode | '', string> = { '': 'Dev-server port (default)', url: 'A fixed URL', port: 'localhost with a port', script: 'A script that prints the URL' }
  const previewValue = (label: string) => ({
    value: config(props.store)?.previewValue ?? '',
    repoValue: repo(props.store)?.previewValue,
    save: (value: string) => props.store.save({ previewValue: value }),
    label,
  })
  return (
    <>
      <SettingsSection id="preview-url" label="Browser preview">
        <SettingRow
          label="Browser preview URL"
          help="Where the Browser pane opens for this project's tasks."
          layout={repoPreview() ? 'stacked' : 'inline'}
          from={repoPreview() ? REPO_CONFIG_FILE : undefined}
          error={previewModeSave.error()}
        >
          <Show when={repoPreview()}>{(value) => <RepoValue value={value()} />}</Show>
          <Select
            label="Browser preview URL"
            value={previewMode()}
            onChange={(value) => void previewModeSave.run(() => props.store.save({ previewMode: value as PreviewMode | '' }))}
            options={(['', 'url', 'port', 'script'] as const).map((value) => ({ value, label: modeLabels[value] }))}
          />
        </SettingRow>
        {/* One field per mode rather than one field that changes shape, so switching the mode drops
            anything typed for the other one. The modes share the stored value. */}
        <Switch>
          <Match when={previewMode() === 'script'}>
            <ConfigText {...previewValue('Preview script')} description="Runs in the task's worktree. acorn opens what it prints." lines={2} placeholder="./scripts/preview-url.sh" />
          </Match>
          <Match when={previewMode() === 'url'}>
            <ConfigText {...previewValue('Preview URL')} placeholder="https://example.test" />
          </Match>
          <Match when={previewMode() === 'port'}>
            <ConfigText {...previewValue('Preview port')} type="number" placeholder="3000" />
          </Match>
        </Switch>
      </SettingsSection>

      <SettingsSection
        id="page-rules"
        label="Page rules"
        description="Fills in a field when a preview page loads, such as a dev login. Values are saved as plain text, so use dev passwords only."
        help="The pattern matches part of the URL. * matches anything, and $ at the end matches the end, so */$ matches only the home page."
      >
        <BrowserRulesEditor rules={config(props.store)?.browserRules ?? []} onSave={(rules) => props.store.save({ browserRules: rules })} />
      </SettingsSection>
    </>
  )
}

export function DatabaseTab(props: { store: ProjectConfigStore }) {
  // The AI-SQL schema-source editor needs something to generate with, matching where SQL generation
  // itself is available.
  //
  // Core's backends route rather than a count over the integrations query: half the answer is whether
  // an agent CLI is installed on this machine, which only the node can see, and a person whose only
  // backend is `claude` should get this editor too.
  const backends = createQuery(() => modelBackendsOptions(true))
  const hasModelBackend = () => (backends.data?.backends.length ?? 0) > 0
  const dbSchemaMode = (): DbSchemaMode | '' => config(props.store)?.dbSchemaMode ?? ''
  const schemaModeSave = createSettingSave()
  return (
    <>
      <SettingsSection id="db-connection" label="Connection">
        <ConfigText
          label="Connection URL command"
          description="Leave blank to use DATABASE_URL from the worktree's .env or the environment."
          help="For other setups, give a command that prints a Postgres connection URL. It runs in the task's worktree."
          lines={2}
          placeholder="./scripts/db-url.sh"
          value={config(props.store)?.dbUrlScript ?? ''}
          repoValue={repo(props.store)?.dbUrlScript}
          save={(value) => props.store.save({ dbUrlScript: value })}
        />
      </SettingsSection>

      <Show when={hasModelBackend()}>
        <SettingsSection id="schema" label="Query generation">
          <SettingRow
            label="Schema source"
            help="What acorn sends the model as your database schema when it writes a query."
            error={schemaModeSave.error()}
          >
            <Select
              label="Schema source"
              value={dbSchemaMode()}
              onChange={(value) => void schemaModeSave.run(() => props.store.save({ dbSchemaMode: value as DbSchemaMode | '' }))}
              options={[{ value: '', label: 'Read the live database (default)' }, { value: 'script', label: 'A script that prints it' }, { value: 'file', label: 'A file in the worktree' }]}
            />
          </SettingRow>
          {/* A field per mode, for the same reason as the preview URL. */}
          <Switch>
            <Match when={dbSchemaMode() === 'script'}>
              <ConfigText
                label="Schema script"
                description="Runs in the task's worktree. Its output is used as the schema."
                lines={2}
                placeholder={'pg_dump --schema-only "$DATABASE_URL"'}
                value={config(props.store)?.dbSchemaValue ?? ''}
                save={(value) => props.store.save({ dbSchemaValue: value })}
              />
            </Match>
            <Match when={dbSchemaMode() === 'file'}>
              <ConfigText
                label="Schema file"
                description="A path relative to the task's worktree root."
                placeholder="db/schema.sql"
                value={config(props.store)?.dbSchemaValue ?? ''}
                save={(value) => props.store.save({ dbSchemaValue: value })}
              />
            </Match>
          </Switch>
          <ConfigText
            label="Schema notes"
            description="Anything the schema doesn't say, such as what a status column's numbers mean."
            help="acorn sends these notes with the schema each time it writes a query."
            lines={4}
            placeholder={'orders.meta jsonb: { coupon: string, source: "web" | "app" }\norders.status: 0 pending, 1 paid, 2 refunded'}
            value={config(props.store)?.dbSchemaNotes ?? ''}
            save={(value) => props.store.save({ dbSchemaNotes: value })}
          />
        </SettingsSection>
      </Show>
    </>
  )
}

/** What the repo sets, drawn above the machine's own value in a row the repo overrides. */
function RepoValue(props: { value: string }) {
  return <Text emphasis="mono" wrap>{props.value}</Text>
}

// One text setting on a project: a single-line field, or a script box in the code font when it has
// `lines`. Its own component so each field holds its own draft, and a field that goes away takes its
// draft with it. With `repoValue`, the repo sets it: the row goes read-only and stacked, the file's
// value first and this machine's under it.
function ConfigText(props: {
  label: string
  description?: string
  help?: string
  value: string
  save: (value: string) => Promise<unknown>
  /** What `.acorn/config.toml` sets instead, when it sets this. */
  repoValue?: string
  /** A script box this many lines tall. Without it, a single-line field. */
  lines?: number
  placeholder?: string
  type?: 'text' | 'number'
}) {
  const field = createTextSetting({ value: () => props.value, save: (value) => props.save(value) })
  const fromRepo = () => props.repoValue !== undefined
  return (
    <SettingRow
      label={props.label}
      description={props.description}
      help={props.help}
      layout={props.lines || fromRepo() ? 'stacked' : 'inline'}
      from={fromRepo() ? REPO_CONFIG_FILE : undefined}
      savedAt={field.savedAt()}
      error={field.error()}
    >
      <Show when={props.repoValue}>{(value) => <RepoValue value={value()} />}</Show>
      <Show
        when={props.lines}
        fallback={
          <Input
            label={props.label}
            type={props.type}
            assist={false}
            placeholder={props.placeholder}
            value={field.value()}
            onInput={field.input}
            onChange={(value) => void field.commit(value)}
          />
        }
      >
        {(lines) => (
          <Textarea
            label={props.label}
            mono
            rows={lines()}
            assist={false}
            placeholder={props.placeholder}
            value={field.value()}
            onInput={field.input}
            onChange={(value) => void field.commit(value)}
          />
        )}
      </Show>
    </SettingRow>
  )
}

// Preview-browser page rules: a row-per-rule editor over a repo's browserRules array, saved as a
// whole array. A field saves on blur or Enter, a switch or a delete at once. A row missing a pattern
// or selector is kept locally but not saved, so a half-typed rule never fails the route's validation.
// The list here is what was typed, so a failed save keeps every rule on screen with the error beside
// them.
function BrowserRulesEditor(props: { rules: BrowserRule[]; onSave: (rules: BrowserRule[]) => Promise<unknown> }) {
  const [rules, setRules] = createSignal<BrowserRule[]>(props.rules)
  const saving = createSettingSave()

  const save = () => void saving.run(() => props.onSave(rules().filter((r) => r.urlPattern.trim() && r.action.selector.trim())))

  const update = (id: string, patch: (r: BrowserRule) => BrowserRule) =>
    setRules((list) => list.map((r) => (r.id === id ? patch(r) : r)))
  const add = () =>
    setRules((list) => [...list, { id: crypto.randomUUID(), enabled: true, urlPattern: '', trigger: 'load', action: { type: 'fill', selector: '', value: '' } }])
  const remove = (id: string) => {
    setRules((list) => list.filter((r) => r.id !== id))
    save()
  }

  // The section is the editor's heading and says what it is for, so the rules sit straight in it.
  return (
    <>
      {/* Index, not For: keying by position stops an edit remounting the row and defocusing it. */}
      <Index each={rules()}>
        {(rule) => (
          <div class="integration-key-row">
            <Checkbox
              ariaLabel="Enabled"
              title="Enabled"
              checked={rule().enabled}
              onChange={(checked) => { update(rule().id, (r) => ({ ...r, enabled: checked })); save() }}
            />
            <Input
              label="URL pattern"
              title="URL pattern"
              assist={false}
              placeholder="localhost:3000/login"
              value={rule().urlPattern}
              onInput={(value) => update(rule().id, (r) => ({ ...r, urlPattern: value }))}
              onChange={save}
            />
            <Input
              label="CSS selector of the input to fill"
              title="CSS selector of the input to fill"
              assist={false}
              placeholder="input[type=password]"
              value={rule().action.selector}
              onInput={(value) => update(rule().id, (r) => ({ ...r, action: { ...r.action, selector: value } }))}
              onChange={save}
            />
            <Input
              label="Text typed into the input"
              title="Text typed into the input"
              assist={false}
              placeholder="value to type"
              value={rule().action.value}
              onInput={(value) => update(rule().id, (r) => ({ ...r, action: { ...r.action, value } }))}
              onChange={save}
            />
            <IconButton icon="x" label="Delete rule" onPress={() => remove(rule().id)} />
          </div>
        )}
      </Index>
      <Show when={saving.error()}>{(message) => <Text tone="danger" wrap>{message()}</Text>}</Show>
      <Button onPress={add}>Add rule</Button>
    </>
  )
}
