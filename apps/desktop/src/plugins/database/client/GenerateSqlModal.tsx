import { createSignal, Show } from 'solid-js'
import { ApiError } from '../../../core/client/apiClient'
import ModelConnectionPicker, { defaultModelIdFor } from '../../../core/client/modelProviders/ModelConnectionPicker'
import { trapOverlayFocus } from '../../../core/client/ui/focus'
import type { AvailableModelConnection } from '../../../core/shared/modelProviders'
import { databaseApi } from './databaseClient'

// AI SQL generation (docs/pg.md): describe the query, pick a configured model connection + model,
// and the generated PostgreSQL replaces the editor contents via onGenerated. The server route owns
// the prompt; this modal only collects the inputs and surfaces errors.

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
  onClose: () => void
  onGenerated: (sql: string) => void
}) {
  const api = databaseApi()
  const [prompt, setPrompt] = createSignal('')
  const [connectionId, setConnectionId] = createSignal(props.connections[0]?.connection.id ?? '')
  const [modelId, setModelId] = createSignal(defaultModelIdFor(props.connections[0]))
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let dialog!: HTMLDivElement

  const generate = async () => {
    if (busy() || !prompt().trim() || !connectionId()) return
    setBusy(true)
    setError('')
    try {
      const res = await api.generate(props.taskId, {
        connectionId: connectionId(),
        ...(modelId() ? { modelId: modelId() } : {}),
        prompt: prompt().trim(),
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
    <div class="overlay-backdrop" onClick={props.onClose}>
      <div
        ref={dialog}
        class="overlay db-generate"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onClose()
          else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate()
          else trapOverlayFocus(event, dialog)
        }}
      >
        <div class="overlay-title">Generate SQL</div>
        <div class="overlay-body db-generate-body">
          <textarea
            class="settings-script"
            rows="4"
            maxlength="4000"
            spellcheck={false}
            placeholder="Describe the query — e.g. the 10 most recent orders with the customer's email"
            ref={(el) => queueMicrotask(() => el.focus())}
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
          />
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
          <button type="button" class="overlay-btn" disabled={busy()} onClick={props.onClose}>
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
