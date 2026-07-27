// Repo-level variables for the API panel. Mounted twice: as the Variables view inside the panel,
// and as the "API requests" settings page. One component, two entry points.
//
// Three kinds:
//   value   — stored and shown as typed
//   secret  — encrypted at rest (AES-GCM, the same key that seals the session cookie); the
//             plaintext never comes back to the renderer, so the field shows a placeholder
//   command — a shell command run in the task worktree (or the repo checkout) at send time, and
//             never stored. The same mechanism the Database pane uses for its connection URL.
import { createResource, createSignal, For, Show } from 'solid-js'
import { Button, Input, Select } from '../../../core/client/ui/primitives'
import Icon from '../../../core/client/ui/Icon'
import { variableKinds, type HttpVariable, type VariableKind } from '../shared/model'
import { createVariable, deleteVariable, listVariables, updateVariable } from './httpClient'

const KIND_HINT: Record<VariableKind, string> = {
  value: 'Used exactly as typed.',
  secret: 'Encrypted at rest. Leave blank when editing to keep the stored value.',
  command: 'Run in the task worktree each time you send. The last line of output is the value.',
}

const PLACEHOLDER: Record<VariableKind, string> = {
  value: 'http://localhost:3000',
  secret: '••••••••',
  command: 'op read op://vault/api/token',
}

type Row = { id: string | null; name: string; kind: VariableKind; value: string; enabled: boolean; hasStoredSecret: boolean }

const toRow = (v: HttpVariable): Row => ({ id: v.id, name: v.name, kind: v.kind, value: v.value, enabled: v.enabled, hasStoredSecret: v.kind === 'secret' })
const blankRow = (): Row => ({ id: null, name: '', kind: 'value', value: '', enabled: true, hasStoredSecret: false })

export default function HttpVariables(props: { owner: string; repo: string }) {
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<string | null>(null)
  const scope = () => ({ owner: props.owner, repo: props.repo })
  const [stored, actions] = createResource(scope, (s) => listVariables(s.owner, s.repo))

  // Rows being edited live outside the resource so a keystroke doesn't refetch. The resource is the
  // saved truth; `drafts` is what's on screen.
  const [drafts, setDrafts] = createSignal<Row[]>([])
  const rows = () => [...(stored() ?? []).map(toRow).filter((r) => !drafts().some((d) => d.id === r.id)), ...drafts()]

  const editRow = (row: Row, patch: Partial<Row>) => {
    setDrafts((current) => {
      const existing = current.find((d) => (row.id ? d.id === row.id : d === row))
      if (existing) return current.map((d) => (d === existing ? { ...d, ...patch } : d))
      return [...current, { ...row, ...patch }]
    })
  }

  async function save(row: Row) {
    if (!row.name.trim()) return setError('A variable needs a name.')
    setBusy(row.id ?? row.name)
    setError(null)
    try {
      const body = { name: row.name.trim(), kind: row.kind, value: row.value, enabled: row.enabled }
      if (row.id) await updateVariable(props.owner, props.repo, row.id, body)
      else await createVariable(props.owner, props.repo, body)
      setDrafts((d) => d.filter((x) => x !== row && x.id !== row.id))
      void actions.refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the variable')
    } finally {
      setBusy(null)
    }
  }

  async function remove(row: Row) {
    if (!row.id) return setDrafts((d) => d.filter((x) => x !== row))
    if (!confirm(`Delete "${row.name}"?`)) return
    try {
      await deleteVariable(props.owner, props.repo, row.id)
      void actions.refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the variable')
    }
  }

  return (
    <div class="http-variables">
      <header class="http-variables-head">
        <h3>Variables · {props.owner}/{props.repo}</h3>
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
        <For each={rows()}>
          {(row) => (
            <div class="http-grid-row" role="row">
              <input type="checkbox" checked={row.enabled} aria-label="Enabled" onChange={(e) => editRow(row, { enabled: e.currentTarget.checked })} />
              <Input size="sm" value={row.name} placeholder="BASE_URL" onInput={(e) => editRow(row, { name: e.currentTarget.value })} />
              <Select size="sm" value={row.kind} aria-label="Kind" onChange={(e) => editRow(row, { kind: e.currentTarget.value as VariableKind, value: '' })}>
                <For each={variableKinds}>{(k) => <option value={k}>{k}</option>}</For>
              </Select>
              <Input
                size="sm"
                type={row.kind === 'secret' ? 'password' : 'text'}
                value={row.value}
                placeholder={row.kind === 'secret' && row.hasStoredSecret ? 'stored — leave blank to keep' : PLACEHOLDER[row.kind]}
                onInput={(e) => editRow(row, { value: e.currentTarget.value })}
              />
              <span class="http-grid-actions">
                <Button size="sm" busy={busy() === (row.id ?? row.name)} onClick={() => void save(row)}>
                  Save
                </Button>
                <Button variant="bare" size="sm" iconOnly aria-label="Delete" onClick={() => void remove(row)}>
                  <Icon name="trash-2" />
                </Button>
              </span>
              <p class="http-grid-hint">{KIND_HINT[row.kind]}</p>
            </div>
          )}
        </For>
      </div>

      <Button size="sm" variant="ghost" onClick={() => setDrafts((d) => [...d, blankRow()])}>
        + Variable
      </Button>
    </div>
  )
}
