// Repo-level variables for the API panel. Mounted twice: as the Variables view inside the panel,
// and as the "API requests" settings page.
//
// Three kinds:
//   value   - stored and shown as typed
//   secret  - encrypted at rest with the node's secret key. The plaintext never comes back to the
//             renderer, so the field shows a placeholder
//   command - a stored shell command run in the task worktree, or the project checkout, when a
//             request references it. Its output is never stored.
import { createEffect, createResource, createSignal, Index, Show } from 'solid-js'
import {
  Button, Checkbox, createArmedConfirm, Heading, Icon, Inline, Input, Select, Stack, Text, Toolbar,
} from '@acorn/plugin-api/ui/tree'
import { variableKinds, type HttpVariable, type VariableKind } from '../shared/model'
import { createVariable, deleteVariable, listVariables, updateVariable } from './httpClient'

const KIND_HINT: Record<VariableKind, string> = {
  value: 'Used exactly as typed.',
  secret: 'Encrypted at rest. Leave blank when editing to keep the stored value.',
  command: 'Run in the task worktree when a request uses it. The last line of output is the value.',
}

const PLACEHOLDER: Record<VariableKind, string> = {
  value: 'http://localhost:3000',
  secret: '••••••••',
  command: 'op read op://vault/api/token',
}

type Row = { id: string | null; name: string; kind: VariableKind; value: string; enabled: boolean; hasStoredSecret: boolean }

const toRow = (v: HttpVariable): Row => ({ id: v.id, name: v.name, kind: v.kind, value: v.value, enabled: v.enabled, hasStoredSecret: v.kind === 'secret' })
const blankRow = (): Row => ({ id: null, name: '', kind: 'value', value: '', enabled: true, hasStoredSecret: false })

export default function HttpVariables(props: { projectId: string; projectName: string }) {
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [stored] = createResource(() => props.projectId, listVariables)

  // One local list, seeded from the server load and then edited in place: each save patches its row
  // from the response, so nothing refetches under a cursor. Rows are addressed by position. A
  // stored-plus-drafts merge rebuilds every row object per keystroke and moves an edited row to the
  // end of the list, which tears the input out from under the caret.
  const [rows, setRows] = createSignal<Row[]>([])
  createEffect(() => {
    const saved = stored()
    if (saved) setRows(saved.map(toRow))
  })

  const armedDelete = createArmedConfirm()

  const editRow = (index: number, patch: Partial<Row>) => setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const dropRow = (index: number) => setRows((current) => current.filter((_, i) => i !== index))

  async function save(index: number) {
    const row = rows()[index]
    if (!row.name.trim()) return setError('A variable needs a name.')
    setBusy(row.id ?? row.name)
    setError(null)
    try {
      const body = { name: row.name.trim(), kind: row.kind, value: row.value, enabled: row.enabled }
      const next = row.id ? await updateVariable(props.projectId, row.id, body) : await createVariable(props.projectId, body)
      setRows((current) => current.map((r, i) => (i === index ? toRow(next) : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the variable')
    } finally {
      setBusy(null)
    }
  }

  async function remove(index: number) {
    const row = rows()[index]
    if (!row.id) return dropRow(index)
    // Two clicks rather than a dialog (docs/http-client.md § Client).
    if (!armedDelete.request(row.id)) return
    try {
      await deleteVariable(props.projectId, row.id)
      dropRow(index)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the variable')
    }
  }

  return (
    <Stack gap="section">
      <Stack gap="row">
        <Heading level={3}>Variables · {props.projectName}</Heading>
        <Text tone="muted" wrap>
          {'Write {{NAME}} anywhere in a request — the URL, a header, the body, an auth field. '}
          {'A request can override any of these in its own Vars tab. '}
          {'Built in already: {{repo}}, {{branch}}, {{worktree}}, {{taskId}}.'}
        </Text>
      </Stack>

      <Show when={error()}>
        <Text tone="danger" wrap>{error()}</Text>
      </Show>

      {/* One row per variable, as an Inline of controls. It was a five-column CSS grid this plugin
          declared itself; the kit has no grid whose cells are controls, and a row of fields reads the
          same at every width without one. */}
      {/* <Index>, not <For>: rows are keyed by position, so editing one doesn't recreate its input. */}
      <Index each={rows()}>
        {(row, index) => (
          <Stack gap="none">
            <Inline wrap>
              <Checkbox checked={row().enabled} ariaLabel="Enabled" onChange={(checked: boolean) => editRow(index, { enabled: checked })} />
              <Input size="sm" value={row().name} placeholder="BASE_URL" onChange={(value: string) => editRow(index, { name: value })} />
              <Select
                size="sm"
                value={row().kind}
                label="Kind"
                onChange={(value: string) => editRow(index, { kind: value as VariableKind, value: '' })}
                options={[...variableKinds.map((k) => ({ value: k, label: k }))]}
              />
              <Input
                size="sm"
                type={row().kind === 'secret' ? 'password' : 'text'}
                value={row().value}
                placeholder={row().kind === 'secret' && row().hasStoredSecret ? 'stored — leave blank to keep' : PLACEHOLDER[row().kind]}
                onChange={(value: string) => editRow(index, { value })}
              />
              <Button size="sm" busy={busy() === (row().id ?? row().name)} onPress={() => void save(index)}>
                Save
              </Button>
              <Button
                variant="bare"
                size="sm"
                tone={armedDelete.armed() === row().id ? 'danger' : undefined}
                title={armedDelete.armed() === row().id ? `Click again to delete "${row().name}"` : 'Delete'}
                label={armedDelete.armed() === row().id ? 'Confirm delete' : 'Delete'}
                onPress={() => void remove(index)}
              >
                <Show when={armedDelete.armed() === row().id} fallback={<Icon name="trash-2" />}>Delete?</Show>
              </Button>
            </Inline>
            <Text tone="muted">{KIND_HINT[row().kind]}</Text>
          </Stack>
        )}
      </Index>

      <Toolbar variant="actions" size="sm">
        <Button size="sm" variant="ghost" onPress={() => setRows((r) => [...r, blankRow()])}>
          + Variable
        </Button>
      </Toolbar>
    </Stack>
  )
}
