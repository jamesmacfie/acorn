import { createSignal, For, Show } from 'solid-js'
import { ApiError } from '../../../core/client/apiClient'
import ModelConnectionPicker, { defaultModelIdFor } from '../../../core/client/modelProviders/ModelConnectionPicker'
import { createDismissable } from '../../../core/client/ui/dismissable'
import Picker from '../../../core/client/ui/Picker'
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import type { DbSavedQuery } from '../shared/database'
import { GENERATE_MAX_PROMPT_CHARS } from '../shared/database'
import { databaseApi } from './databaseClient'

// AI SQL generation (docs/pg.md): describe the query, pick a configured model connection + model,
// and the generated PostgreSQL replaces the editor contents via onGenerated. The server route owns
// the prompt; this modal only collects the inputs and surfaces errors.
//
// Saved queries can be added as worked examples — the server sends each one's name, notes and SQL
// alongside the schema and the repo's schema notes. ponytail: the selection resets each open; nothing
// to persist until someone asks for a default set.

const errorMessage = (e: unknown): string => {
  if (e instanceof ApiError) {
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
  const api = databaseApi()
  const [prompt, setPrompt] = createSignal('')
  const [connectionId, setConnectionId] = createSignal(props.connections[0]?.connection.id ?? '')
  const [modelId, setModelId] = createSignal(defaultModelIdFor(props.connections[0]))
  const [exampleIds, setExampleIds] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let dialog!: HTMLDivElement
  const dismiss = createDismissable({ onDismiss: () => props.onClose(), container: () => dialog })

  const chosen = () => props.queries.filter((q) => exampleIds().includes(q.id))
  const toggle = (q: DbSavedQuery) =>
    setExampleIds((ids) => (ids.includes(q.id) ? ids.filter((i) => i !== q.id) : [...ids, q.id]))
  const matches = (query: string) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return [...props.queries]
    return props.queries.filter((q) => `${q.name} ${q.notes ?? ''}`.toLowerCase().includes(needle))
  }

  const generate = async () => {
    if (busy() || !prompt().trim() || !connectionId()) return
    setBusy(true)
    setError('')
    try {
      const res = await api.generate(props.taskId, {
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

  return (
    <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
      <div
        ref={dialog}
        class="overlay db-generate"
        role="dialog"
        aria-modal="true"
        onClick={dismiss.onContainerClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate()
          else dismiss.onKeyDown(event)
        }}
      >
        <div class="overlay-title">Generate SQL</div>
        <div class="overlay-body db-generate-body">
          <textarea
            class="settings-script"
            rows="4"
            maxlength={GENERATE_MAX_PROMPT_CHARS}
            spellcheck={false}
            placeholder="Describe the query — e.g. the 10 most recent orders with the customer's email"
            ref={(el) => queueMicrotask(() => el.focus())}
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
          />
          <Show when={props.queries.length}>
            <div class="db-examples">
              <span class="muted db-hint">Example queries</span>
              <div class="db-chips">
                <For each={chosen()}>
                  {(q) => (
                    <span class="db-chip" title={q.notes ?? ''}>
                      {q.name}
                      <button type="button" class="db-chip-x" title="Remove" onClick={() => toggle(q)}>
                        ✕
                      </button>
                    </span>
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
            <div class="db-error">{error()}</div>
          </Show>
        </div>
        <div class="db-generate-actions">
          <button type="button" class="ui-btn" disabled={busy()} onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="db-run-btn" disabled={busy() || !prompt().trim()} onClick={() => void generate()}>
            {busy() ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
