import { createSignal, For, Show } from 'solid-js'
import {
  Alert, Button, Chip, ChipRow, defaultModelIdFor, Modal, ModalActions, ModalBody,
  ModelConnectionPicker, Picker, Stack, Text, Textarea,
} from '@acorn/plugin-api/ui/tree'
import { AcornBridgeError } from '@acorn/plugin-api/ui/sdk'
import type { AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import type { DbSavedQuery } from '../shared/database'
import { GENERATE_MAX_PROMPT_CHARS } from '../shared/database'
import { generateSql } from './databaseClient'

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
  onDismiss: () => void
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
      props.onDismiss()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    // ⌘Enter used to be a `keydown` on the dialog. A DOM event does not cross to a sandbox with no
    // DOM, so the Generate button is the only way to fire it now.
    <Modal title="Generate SQL" onDismiss={props.onDismiss}>
      <ModalBody>
        <Textarea
          mono
          rows={4}
          maxLength={GENERATE_MAX_PROMPT_CHARS}
          assist={false}
          autofocus
          placeholder="Describe the query — e.g. the 10 most recent orders with the customer's email"
          value={prompt()}
          onChange={(value: string) => setPrompt(value)}
        />
        <Show when={props.queries.length}>
          <Stack gap="row">
            <Text emphasis="eyebrow">Example queries</Text>
            <ChipRow ariaLabel="Example queries">
              <For each={chosen()}>
                {(q) => (
                  <Chip title={q.notes ?? ''} onRemove={() => toggle(q)}>{q.name}</Chip>
                )}
              </For>
              {/* The data form of the picker: a tree cannot hand over a `results(query)` callback. */}
              <Picker
                keepOpen
                label="Add example…"
                placeholder="Filter saved queries…"
                emptyText="No matching queries."
                items={props.queries.map((q) => ({
                  id: q.id,
                  label: q.name,
                  ...(q.notes ? { note: q.notes } : {}),
                  active: exampleIds().includes(q.id),
                }))}
                onPick={(id: string) => {
                  const q = props.queries.find((candidate) => candidate.id === id)
                  if (q) toggle(q)
                }}
              />
            </ChipRow>
          </Stack>
        </Show>
        <ModelConnectionPicker
          connections={props.connections}
          connectionId={connectionId()}
          modelId={modelId()}
          onChange={(sel: { connectionId: string; modelId: string }) => {
            setConnectionId(sel.connectionId)
            setModelId(sel.modelId)
          }}
        />
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
      </ModalBody>
      <ModalActions>
        <Button disabled={busy()} onPress={props.onDismiss}>Cancel</Button>
        <Button variant="solid" disabled={busy() || !prompt().trim()} onPress={() => void generate()}>
          {busy() ? 'Generating…' : 'Generate'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
