import { createSignal, For, Show } from 'solid-js'
import { Alert, Chip, defaultModelIdFor, Modal, ModelConnectionPicker, Picker, Textarea } from '@acorn/plugin-api/ui'
import { AcornBridgeError } from '@acorn/plugin-api/ui/sdk'
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import type { DbSavedQuery } from '../shared/database'
import { GENERATE_MAX_PROMPT_CHARS } from '../shared/database'
import { generateSql } from './databaseClient'
import { filterSavedQueries } from './databaseModel'

// Describe a query in words, get SQL. The prompt is built on the node from the live schema, the repo's
// schema notes and any saved queries picked as examples; the key never comes near this frame.
//
// The error mapping is the same as the compiled version's, over `AcornBridgeError` instead of `ApiError`:
// the bridge reuses the HTTP error envelope verbatim, precisely so one branch on `code` works whether the
// call was denied at the bridge or refused by the node.
const errorMessage = (e: unknown): string => {
  if (e instanceof AcornBridgeError) {
    if (e.code === 'provider_needs_auth') return 'The provider key was rejected — reconnect it in Settings → Integrations.'
    if (e.code === 'provider_rate_limited') return 'The provider is rate-limiting requests — try again shortly.'
    return e.message
  }
  return e instanceof Error ? e.message : String(e)
}

export default function GenerateSqlModal(props: {
  taskId: string
  connections: AvailableModelConnection[]
  queries: readonly DbSavedQuery[]
  onClose: () => void
  onGenerated: (sql: string) => void
}) {
  const [prompt, setPrompt] = createSignal('')
  const [connectionId, setConnectionId] = createSignal(props.connections[0]?.connection.id ?? '')
  const [modelId, setModelId] = createSignal(defaultModelIdFor(props.connections[0]))
  const [exampleIds, setExampleIds] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const chosen = () => props.queries.filter((q) => exampleIds().includes(q.id))
  const toggle = (q: DbSavedQuery) =>
    setExampleIds((ids) => (ids.includes(q.id) ? ids.filter((i) => i !== q.id) : [...ids, q.id]))
  const matches = (query: string) => filterSavedQueries(props.queries, query)

  const generate = async () => {
    if (busy() || !prompt().trim() || !connectionId()) return
    setBusy(true)
    setError('')
    try {
      const res = await generateSql(props.taskId, {
        connectionId: connectionId(),
        ...(modelId() ? { modelId: modelId() } : {}),
        prompt: prompt().trim(),
        ...(exampleIds().length ? { queryIds: exampleIds() } : {}),
      })
      props.onGenerated(res.sql)
      props.onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // Modal owns the deferred focus; a bare `autofocus` is unreliable inside a Solid modal.
  let promptInput: HTMLTextAreaElement | undefined

  return (
    <Modal
      title="Generate SQL"
      class="db-generate"
      autoFocus={() => promptInput}
      onClose={props.onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return false
        void generate()
        return true
      }}
    >
      <Modal.Body class="db-generate-body">
        <Textarea
          mono
          rows="4"
          maxlength={GENERATE_MAX_PROMPT_CHARS}
          spellcheck={false}
          placeholder="Describe the query — e.g. the 10 most recent orders with the customer's email"
          ref={(el) => { promptInput = el }}
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
        />
        <Show when={props.queries.length}>
          <div class="db-examples">
            <span class="muted db-hint">Example queries</span>
            <div class="db-chips">
              <For each={chosen()}>
                {(q) => (
                  <Chip class="db-chip" title={q.notes ?? ''} onRemove={() => toggle(q)}>{q.name}</Chip>
                )}
              </For>
              <Picker<DbSavedQuery>
                keepOpen
                label="Add example…"
                placeholder="Filter saved queries…"
                emptyText="No matching queries."
                buttonClass="db-chip-add"
                results={matches}
                rowLabel={(q) => q.name}
                isActive={(q) => exampleIds().includes(q.id)}
                onSelect={toggle}
              />
            </div>
          </div>
        </Show>
        <ModelConnectionPicker
          connections={props.connections}
          connectionId={connectionId()}
          modelId={modelId()}
          onChange={(sel) => {
            setConnectionId(sel.connectionId)
            setModelId(sel.modelId)
          }}
        />
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
      </Modal.Body>
      <div class="db-generate-actions">
        <button type="button" class="ui-btn" disabled={busy()} onClick={props.onClose}>Cancel</button>
        <button type="button" class="db-run-btn" disabled={busy() || !prompt().trim()} onClick={() => void generate()}>
          {busy() ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </Modal>
  )
}
