import { createMemo, createSignal, Index, Show, type JSX } from 'solid-js'
import type { ProjectRunTarget } from '@acorn/protocol/api.ts'
import { Button, Card, Checkbox, EmptyState, Field, Input, Table, TableCell, TableHead, TableRow } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { Text } from '../../kit/components/content/Text'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { Toolbar } from '../../kit/components/layout/Toolbar'
import { createSettingSave } from './settingSave'
import { useUnsavedChanges } from './unsavedChanges'

// A project's run targets (docs/workflows/routes-and-ui.md § Routes and UI) as a table, where they used to be a JSON
// array typed into a box. The stored value has not changed: the `runTargets` column is still that JSON
// array, written whole through the run-targets route, which checks it again.
//
// One target's fields only make sense together, a name with its command, so adding or editing one is a
// small form with Save and Cancel under the table. Removing one writes at once.
//
// A target the checkout's `.acorn/config.toml` declares replaces this machine's target with the same
// name (server/runConfig.ts § loadRepoConfig). The repo's are listed first and read-only, and a
// machine target they replace says so and cannot be edited, since editing it would change nothing
// while the repo declares it. Its row stays, because it applies again if the repo stops.

/** Where a repo-set value comes from, as a row names it. */
export const REPO_CONFIG_FILE = '.acorn/config.toml'

type Draft = { id: string; command: string; stop: string; url: string; urlCommand: string; isDefault: boolean }

const emptyDraft: Draft = { id: '', command: '', stop: '', url: '', urlCommand: '', isDefault: false }
const draftOf = (target: ProjectRunTarget): Draft => ({
  id: target.id,
  command: target.command,
  stop: target.stop ?? '',
  url: target.url ?? '',
  urlCommand: target.urlCommand ?? '',
  isDefault: target.default === true,
})
const sameDraft = (a: Draft, b: Draft) =>
  a.id === b.id && a.command === b.command && a.stop === b.stop && a.url === b.url && a.urlCommand === b.urlCommand && a.isDefault === b.isDefault

/** The stored JSON as a list. Keys the table does not edit, such as `icon` or `restart`, stay on the
 *  object, so a save writes them back as they were. */
export function parseRunTargets(stored: string | null): { targets: ProjectRunTarget[]; unreadable: boolean } {
  if (!stored?.trim()) return { targets: [], unreadable: false }
  try {
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return { targets: [], unreadable: true }
    const targets = parsed.filter((entry): entry is ProjectRunTarget =>
      !!entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.command === 'string')
    return { targets, unreadable: targets.length !== parsed.length }
  } catch {
    return { targets: [], unreadable: true }
  }
}

/** Why a draft cannot be saved, or undefined. The node checks the same things and says so too; these
 *  say it before the write, beside the field. */
function draftProblem(draft: Draft, others: readonly ProjectRunTarget[]): string | undefined {
  if (!draft.id.trim()) return 'A run target needs a name.'
  if (!draft.command.trim()) return 'A run target needs a command.'
  if (others.some((target) => target.id === draft.id.trim())) return `Another run target is already called ${draft.id.trim()}.`
  if (draft.url.trim() && draft.urlCommand.trim()) return 'Give a preview URL or a command that prints one, not both.'
  return undefined
}

/** The target a draft saves as: the original's other keys, then the fields the form holds, with blank
 *  ones left off as the node's own reader expects. */
function targetFrom(draft: Draft, original: ProjectRunTarget | undefined): ProjectRunTarget {
  const { stop: _stop, url: _url, urlCommand: _urlCommand, default: _default, ...rest } = original ?? { id: '', command: '' }
  const optional = (value: string) => value.trim() || undefined
  return {
    ...rest,
    id: draft.id.trim(),
    command: draft.command.trim(),
    ...(optional(draft.stop) ? { stop: optional(draft.stop) } : {}),
    ...(optional(draft.url) ? { url: optional(draft.url) } : {}),
    ...(optional(draft.urlCommand) ? { urlCommand: optional(draft.urlCommand) } : {}),
    ...(draft.isDefault ? { default: true } : {}),
  }
}

const previewOf = (target: ProjectRunTarget): string =>
  target.url ?? (target.urlCommand ? `Output of ${target.urlCommand}` : '')

export function RunTargetsTable(props: {
  /** The `runTargets` column: a JSON array, or null. */
  stored: string | null
  /** What the committed `.acorn/config.toml` declares. */
  repoTargets: readonly ProjectRunTarget[]
  save: (json: string) => Promise<unknown>
}) {
  const parsed = createMemo(() => parseRunTargets(props.stored))
  const targets = () => parsed().targets
  const repoIds = createMemo(() => new Set(props.repoTargets.map((target) => target.id)))
  const saving = createSettingSave()

  // The form: which row it edits, `null` for a new one, and what is typed.
  const [editing, setEditing] = createSignal<{ index: number | null; draft: Draft; problem?: string }>()
  const original = () => {
    const index = editing()?.index
    return index === null || index === undefined ? undefined : targets()[index]
  }
  const dirty = () => {
    const open = editing()
    if (!open) return false
    const from = original()
    return !sameDraft(open.draft, from ? draftOf(from) : emptyDraft)
  }
  useUnsavedChanges(dirty)
  const setDraft = (patch: Partial<Draft>) => setEditing((open) => open && { ...open, draft: { ...open.draft, ...patch }, problem: undefined })

  const write = (next: ProjectRunTarget[]) =>
    saving.run(() => props.save(next.length ? JSON.stringify(next) : ''))

  const commit = async () => {
    const open = editing()
    if (!open) return
    const others = targets().filter((_, index) => index !== open.index)
    const problem = draftProblem(open.draft, others)
    if (problem) {
      setEditing({ ...open, problem })
      return
    }
    const target = targetFrom(open.draft, original())
    // One default: the run button a task starts from. Choosing another one moves it.
    const kept = (existing: ProjectRunTarget): ProjectRunTarget => {
      if (!target.default) return existing
      const { default: _default, ...other } = existing
      return other
    }
    const next = open.index === null
      ? [...targets().map(kept), target]
      : targets().map((existing, index) => (index === open.index ? target : kept(existing)))
    if (await write(next)) setEditing(undefined)
  }

  const remove = (index: number) => void write(targets().filter((_, at) => at !== index))

  // This machine's list and its form. Under its own label only when the repo's list sits above it;
  // otherwise the section's heading names it.
  const machine = () => (
    <>
      <Show when={parsed().unreadable}>
        <Text tone="warn" wrap tip={props.stored ?? undefined}>
          Some saved run targets couldn't be read. If you save here, only the ones listed are kept.
        </Text>
      </Show>
      <Show when={targets().length} fallback={<EmptyState align="start" size="sm">No run targets.</EmptyState>}>
        <TargetsTable
          targets={targets()}
          overridden={(target) => repoIds().has(target.id)}
          actions={(index) => (
            <Toolbar variant="actions" size="sm">
              <Button size="sm" variant="ghost" disabled={!!editing()} onPress={() => setEditing({ index, draft: draftOf(targets()[index]!) })}>Edit</Button>
              <Button size="sm" variant="ghost" tone="danger" disabled={!!editing()} onPress={() => remove(index)}>Remove</Button>
            </Toolbar>
          )}
        />
      </Show>

      <Show
        when={editing()}
        fallback={<Button onPress={() => setEditing({ index: null, draft: emptyDraft })}>Add run target</Button>}
      >
        {(open) => (
          // The settings page's one shape for a boxed form: a card of fields, then the primary action
          // and Cancel under the last one.
          <Card>
            <form
              class="run-target-form"
              aria-label={open().index === null ? 'New run target' : `Edit ${open().draft.id}`}
              onSubmit={(event) => { event.preventDefault(); void commit() }}
            >
              <Field label="Name"><Input label="Name" assist={false} placeholder="dev" value={open().draft.id} onInput={(id) => setDraft({ id })} /></Field>
              <Field label="Command"><Input label="Command" assist={false} placeholder="./scripts/dev.sh" value={open().draft.command} onInput={(command) => setDraft({ command })} /></Field>
              <Field label="Stop command" hint="Leave blank to stop it with Ctrl-C."><Input label="Stop command" assist={false} placeholder="pkill -f vite" value={open().draft.stop} onInput={(stop) => setDraft({ stop })} /></Field>
              <Field label="Preview URL"><Input label="Preview URL" assist={false} placeholder="http://localhost:3000" value={open().draft.url} onInput={(url) => setDraft({ url })} /></Field>
              <Field label="Preview URL command" hint="Use instead of a fixed URL. acorn opens what it prints."><Input label="Preview URL command" assist={false} placeholder="./scripts/dev-url.sh" value={open().draft.urlCommand} onInput={(urlCommand) => setDraft({ urlCommand })} /></Field>
              <Checkbox switch label="Default run target" checked={open().draft.isDefault} onChange={(isDefault) => setDraft({ isDefault })} />
              <Show when={open().problem}>{(problem) => <Text tone="danger" wrap>{problem()}</Text>}</Show>
              <Inline gap="row">
                <Button submit variant="solid" tone="accent">Save</Button>
                <Button variant="ghost" onPress={() => setEditing(undefined)}>Cancel</Button>
              </Inline>
            </form>
          </Card>
        )}
      </Show>
    </>
  )

  return (
    <>
      <Show when={props.repoTargets.length}>
        <SettingRow
          label="Set by the repo"
          description="To change these, edit .acorn/config.toml in the repo."
          layout="stacked"
          from={REPO_CONFIG_FILE}
        >
          <TargetsTable targets={props.repoTargets} />
        </SettingRow>
      </Show>

      <Show
        when={props.repoTargets.length}
        fallback={
          <>
            {machine()}
            <Show when={saving.error()}>{(message) => <Text tone="danger" wrap>{message()}</Text>}</Show>
          </>
        }
      >
        <SettingRow label="This machine's run targets" layout="stacked" savedAt={saving.savedAt()} error={saving.error()}>
          {machine()}
        </SettingRow>
      </Show>
    </>
  )
}

function TargetsTable(props: {
  targets: readonly ProjectRunTarget[]
  /** A machine target the repo replaces. */
  overridden?: (target: ProjectRunTarget) => boolean
  actions?: (index: number) => JSX.Element
}) {
  return (
    <Table size="sm">
      <TableRow head>
        <TableHead>Name</TableHead>
        <TableHead>Command</TableHead>
        <TableHead priority="low">Preview URL</TableHead>
        <TableHead align="center">Default</TableHead>
        <Show when={props.actions}><TableHead align="end"><span class="sr-only">Actions</span></TableHead></Show>
      </TableRow>
      {/* Index, not For: a save hands back a new array of new objects, and For would rebuild every row
          under the pointer. */}
      <Index each={props.targets}>
        {(target, index) => (
          <TableRow>
            <TableCell header>{target().id}</TableCell>
            <TableCell><Text emphasis="mono" wrap>{target().command}</Text></TableCell>
            <TableCell><Text wrap>{previewOf(target())}</Text></TableCell>
            <TableCell align="center">{target().default ? 'Yes' : ''}</TableCell>
            <Show when={props.actions}>
              {(actions) => (
                <TableCell align="end">
                  <Show when={!props.overridden?.(target())} fallback={<Text emphasis="muted">Replaced by the repo</Text>}>
                    {actions()(index)}
                  </Show>
                </TableCell>
              )}
            </Show>
          </TableRow>
        )}
      </Index>
    </Table>
  )
}

