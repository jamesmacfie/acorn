import { createSignal, For, Show } from 'solid-js'
import {
  Alert, Button, Chip, ChipRow, defaultModelIdFor, Field, Modal, ModalActions, ModalBody,
  ModelBackendPicker, modelProviderFailure, Picker, Textarea,
} from '@acorn/plugin-api/ui/tree'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { DbSavedQuery } from '../shared/database'
import { GENERATE_MAX_PROMPT_CHARS } from '../shared/database'
import type { DatabaseClient } from './databaseClient'

// Describe a query in words, get SQL. The prompt is built on the node from the live schema, the repo's
// schema notes and any saved queries picked as examples; the key never comes near this frame.
//
// The bridge preserves the HTTP error code, so the shared model-provider guidance works here too.
// Errors specific to SQL generation keep the node's own message.
export const errorMessage = (e: unknown, backend?: Pick<ModelBackend, 'kind' | 'label'>): string => {
  return modelProviderFailure(e, backend) ?? (e instanceof Error ? e.message : String(e))
}

export default function GenerateSqlModal(props: {
  client: Pick<DatabaseClient, 'generateSql'>
  taskId: string
  backends: ModelBackend[]
  queries: readonly DbSavedQuery[]
  onDismiss: () => void
  onGenerated: (sql: string) => void | Promise<void>
}) {
  const [prompt, setPrompt] = createSignal('')
  // The first backend, not the shared "Generate with" default the commit wand and the workflow
  // generator both open on. This dialog is a tree in a worker, and that default is a device
  // preference: it lives in the host's `localStorage`, and `/v1/core/prefs` has no bridge scope on
  // purpose, so a frame cannot read it. `bridge.state` is the same prefs store but namespaced
  // `plugin:database:*`, which is what keeps one plugin out of another's — and out of core's.
  //
  // The ceiling is that a pick made here is remembered nowhere and a pick made elsewhere is not
  // honoured here, which docs/state-ownership.md § Scope rules records as a known limit. The upgrade
  // is a narrow pair of bridge verbs for that one key, or this dialog moving to the compiled client
  // tier, where reading a pref is one import.
  const [backendId, setBackendId] = createSignal(props.backends[0]?.id ?? '')
  const [modelId, setModelId] = createSignal(defaultModelIdFor(props.backends[0]))
  const [exampleIds, setExampleIds] = createSignal<string[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  // A generation that has been sent cannot be cancelled. Keep its result in view until it lands.
  const dismiss = () => {
    if (!busy()) props.onDismiss()
  }

  const chosen = () => props.queries.filter((q) => exampleIds().includes(q.id))
  const toggle = (q: DbSavedQuery) =>
    setExampleIds((ids) => (ids.includes(q.id) ? ids.filter((i) => i !== q.id) : [...ids, q.id]))

  const generate = async () => {
    if (busy() || !prompt().trim() || !backendId()) return
    setBusy(true)
    setError('')
    try {
      const res = await props.client.generateSql(props.taskId, {
        backendId: backendId(),
        ...(modelId() ? { modelId: modelId() } : {}),
        prompt: prompt().trim(),
        ...(exampleIds().length ? { queryIds: exampleIds() } : {}),
      })
      await props.onGenerated(res.sql)
      props.onDismiss()
    } catch (e) {
      setError(errorMessage(e, props.backends.find((backend) => backend.id === backendId())))
    } finally {
      setBusy(false)
    }
  }

  return (
    // ⌘Enter used to be a `keydown` on the dialog. A DOM event does not cross to a sandbox with no
    // DOM, so the Generate button is the only way to fire it now.
    <Modal title="Generate SQL" onDismiss={dismiss}>
      <ModalBody>
        <Field label="What should the query return?">
          <Textarea
            mono
            rows={4}
            maxLength={GENERATE_MAX_PROMPT_CHARS}
            assist={false}
            autofocus
            placeholder="The 10 most recent orders, with each customer's email"
            value={prompt()}
            onChange={(value: string) => setPrompt(value)}
          />
        </Field>
        <Show when={props.queries.length}>
          {/* `group`, so the picker's filter box does not take the caption. */}
          <Field label="Example queries" group help="The model sees these saved queries as examples of how you write SQL.">
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
          </Field>
        </Show>
        <ModelBackendPicker
          backends={props.backends}
          backendId={backendId()}
          modelId={modelId()}
          onChange={(pick: { backendId: string; modelId: string }) => {
            setBackendId(pick.backendId)
            setModelId(pick.modelId)
          }}
        />
        <Show when={error()}>
          <Alert>{error()}</Alert>
        </Show>
      </ModalBody>
      <ModalActions>
        <Button variant="ghost" disabled={busy()} onPress={dismiss}>Cancel</Button>
        <Button variant="solid" disabled={busy() || !prompt().trim()} onPress={() => void generate()}>
          {busy() ? 'Generating…' : 'Generate'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
