import { createSignal, For, Show } from 'solid-js'
import {
  Alert, Button, Chip, ChipRow, defaultModelIdFor, Modal, ModalActions, ModalBody,
  ModelBackendPicker, Picker, Stack, Text, Textarea,
} from '@acorn/plugin-api/ui/tree'
import { AcornBridgeError } from '@acorn/plugin-api/ui/sdk'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { DbSavedQuery } from '../shared/database'
import { GENERATE_MAX_PROMPT_CHARS } from '../shared/database'
import { generateSql } from './databaseClient'

// Describe a query in words, get SQL. The prompt is built on the node from the live schema, the repo's
// schema notes and any saved queries picked as examples; the key never comes near this frame.
//
// The error mapping is the same as the compiled version's, over `AcornBridgeError` instead of `ApiError`:
// the bridge reuses the HTTP error envelope verbatim, precisely so one branch on `code` works whether the
// call was denied at the bridge or refused by the node.
//
// Exported and pure so the branches are a table test (./GenerateSqlModal.test.tsx). `backend` is only
// read by the last of them.
export const errorMessage = (e: unknown, backend?: Pick<ModelBackend, 'kind' | 'label'>): string => {
  if (e instanceof AcornBridgeError) {
    if (e.code === 'provider_needs_auth') return 'The provider key was rejected — reconnect it in Settings → Integrations.'
    if (e.code === 'provider_rate_limited') return 'The provider is rate-limiting requests — try again shortly.'
    // A CLI generate fails as `provider_unavailable` too, and the node's own prose for it is about a
    // provider that did not answer. The usual cause for a CLI is that it is installed but signed out,
    // which no amount of retrying fixes: the next step is to run it once in a terminal.
    if (e.code === 'provider_unavailable' && backend?.kind === 'harness') {
      return `${backend.label} did not answer. Run it once in a terminal to check it is signed in.`
    }
    return e.message
  }
  return e instanceof Error ? e.message : String(e)
}

export default function GenerateSqlModal(props: {
  taskId: string
  backends: ModelBackend[]
  queries: readonly DbSavedQuery[]
  onDismiss: () => void
  onGenerated: (sql: string) => void
}) {
  const [prompt, setPrompt] = createSignal('')
  // The first backend, not the shared "Generate with" default the commit wand and the workflow
  // generator both open on. This dialog is a tree in a worker, and that default is a device
  // preference: it lives in the host's `localStorage`, and `/v2/core/prefs` has no bridge scope on
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

  const chosen = () => props.queries.filter((q) => exampleIds().includes(q.id))
  const toggle = (q: DbSavedQuery) =>
    setExampleIds((ids) => (ids.includes(q.id) ? ids.filter((i) => i !== q.id) : [...ids, q.id]))

  const generate = async () => {
    if (busy() || !prompt().trim() || !backendId()) return
    setBusy(true)
    setError('')
    try {
      const res = await generateSql(props.taskId, {
        backendId: backendId(),
        ...(modelId() ? { modelId: modelId() } : {}),
        prompt: prompt().trim(),
        ...(exampleIds().length ? { queryIds: exampleIds() } : {}),
      })
      props.onGenerated(res.sql)
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
        <Button disabled={busy()} onPress={props.onDismiss}>Cancel</Button>
        <Button variant="solid" disabled={busy() || !prompt().trim()} onPress={() => void generate()}>
          {busy() ? 'Generating…' : 'Generate'}
        </Button>
      </ModalActions>
    </Modal>
  )
}
