// Repo-level variables for the API panel. Mounted twice: as the Variables view inside the panel,
// and as the "API requests" settings page. One component, two entry points.
//
// Three kinds:
//   value   - stored and shown as typed
//   secret  - encrypted at rest with the Node's secret key; the
//             plaintext never comes back to the renderer, so the field shows a placeholder
//   command - a stored shell command run in the task worktree (or the project checkout) when a
//             request references it. Its output is never stored. The same mechanism the Database
//             pane uses for its connection URL.
import { createEffect, createResource, createSignal, For, Index, Show } from 'solid-js'
import { Button, Checkbox, createArmedConfirm, Icon, Input, Select } from '@acorn/plugin-api/ui'
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

  // One local list, seeded from the server load and thereafter edited in place: each save patches
  // its row from the response, so nothing refetches under a cursor. The earlier stored-plus-drafts
  // merge rebuilt every row object on each keystroke and moved an edited row to the end of the list,
  // which tore the input out from under the caret; rows are addressed by position now.
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
    <div class="http-variables">
      <header class="http-variables-head">
        <h3>Variables · {props.projectName}</h3>
        <p class="http-hint">
          Write <code>{'{{NAME}}'}</code> anywhere in a request — the URL, a header, the body, an auth field. A request can override any of these in its own Vars tab.
          Built in already: <code>{'{{repo}}'}</code>, <code>{'{{branch}}'}</code>, <code>{'{{worktree}}'}</code>, <code>{'{{taskId}}'}</code>.
        </p>
      </header>

      <Show when={error()}>
        <p class="http-response-error" role="alert">{error()}</p>
      </Show>

      <div class="http-grid http-vars-grid" role="table">
        <div class="http-grid-head" role="row">
          <span />
          <span>Name</span>
          <span>Kind</span>
          <span>Value</span>
          <span />
        </div>
        {/* <Index>, not <For>: rows are keyed by position, so editing one doesn't recreate its input. */}
        <Index each={rows()}>
          {(row, index) => (
            <div class="http-grid-row" role="row">
              <Checkbox checked={row().enabled} aria-label="Enabled" onChange={(e) => editRow(index, { enabled: e.currentTarget.checked })} />
              <Input size="sm" value={row().name} placeholder="BASE_URL" onInput={(e) => editRow(index, { name: e.currentTarget.value })} />
              <Select size="sm" value={row().kind} aria-label="Kind" onChange={(e) => editRow(index, { kind: e.currentTarget.value as VariableKind, value: '' })}>
                <For each={variableKinds}>{(k) => <option value={k}>{k}</option>}</For>
              </Select>
              <Input
                size="sm"
                type={row().kind === 'secret' ? 'password' : 'text'}
                value={row().value}
                placeholder={row().kind === 'secret' && row().hasStoredSecret ? 'stored — leave blank to keep' : PLACEHOLDER[row().kind]}
                onInput={(e) => editRow(index, { value: e.currentTarget.value })}
              />
              <span class="http-grid-actions">
                <Button size="sm" busy={busy() === (row().id ?? row().name)} onClick={() => void save(index)}>
                  Save
                </Button>
                <Button
                  variant="bare"
                  size="sm"
                  iconOnly={armedDelete.armed() !== row().id}
                  tone={armedDelete.armed() === row().id ? 'danger' : undefined}
                  title={armedDelete.armed() === row().id ? `Click again to delete "${row().name}"` : 'Delete'}
                  aria-label={armedDelete.armed() === row().id ? 'Confirm delete' : 'Delete'}
                  onClick={() => void remove(index)}
                >
                  <Show when={armedDelete.armed() === row().id} fallback={<Icon name="trash-2" />}>Delete?</Show>
                </Button>
              </span>
              <p class="http-grid-hint">{KIND_HINT[row().kind]}</p>
            </div>
          )}
        </Index>
      </div>

      <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, blankRow()])}>
        + Variable
      </Button>
    </div>
  )
}
