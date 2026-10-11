import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  effectiveModelPick,
  latestSignal,
  modelBackendsOptions,
  nodeReady,
  prefsOptions,
  readGeneratePick,
  saveGeneratePick,
  writeJson,
} from '@acorn/plugin-api/client'
import { Alert, Button, ModelBackendPicker, Stack, Text } from '@acorn/plugin-api/ui'
import { modelProviderFailure } from '@acorn/plugin-api/ui/model-provider-failure'
import type { ExplainKind, ExplainResult } from '../shared/api'
import { explainRoute } from '../shared/api'

type Props = { projectId: string; kind: ExplainKind; id: string; base: string | null }
const retained = new Map<string, ExplainResult>()
const RETAINED = 16

export function ExplainView(props: Props) {
  const queryClient = useQueryClient()
  const backends = createQuery(() => modelBackendsOptions(nodeReady()))
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  const [choice, setChoice] = createSignal<{ backendId: string; modelId: string } | null>(null)
  const pick = createMemo(() =>
    effectiveModelPick(backends.data?.backends ?? [], choice() ?? readGeneratePick(prefs.data)),
  )
  const scope = createMemo(() =>
    JSON.stringify([activeNodeId(), nodeReady(), props.projectId, props.kind, props.id, props.base]),
  )
  const key = createMemo(() => JSON.stringify([scope(), pick()?.backendId, pick()?.modelId]))
  const [result, setResult] = createSignal<ExplainResult | null>(null)
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const generating = latestSignal()
  const cancel = () => {
    generating.abort()
    setBusy(false)
  }
  createEffect(() => {
    const selected = key()
    cancel()
    setError('')
    setResult(retained.get(selected) ?? null)
  })
  onCleanup(cancel)
  const generate = async () => {
    const selected = pick(),
      nodeId = activeNodeId()
    if (!selected || !nodeId || !nodeReady()) return
    const signal = generating.next()
    const captured = {
      nodeId,
      projectId: props.projectId,
      kind: props.kind,
      id: props.id,
      base: props.base,
      key: key(),
    }
    setBusy(true)
    setError('')
    try {
      const response = await writeJson<ExplainResult>(explainRoute(captured.projectId, captured.kind, captured.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backendId: selected.backendId, modelId: selected.modelId, base: captured.base }),
        signal,
      })
      if (signal.aborted || captured.key !== key() || captured.nodeId !== activeNodeId()) return
      if (!response.text) {
        setError('The model returned an empty explanation. Retry or choose another model.')
        return
      }
      retained.delete(captured.key)
      retained.set(captured.key, response)
      if (retained.size > RETAINED) retained.delete(retained.keys().next().value!)
      setResult(response)
    } catch (cause) {
      if (signal.aborted || captured.key !== key()) return
      const backend = backends.data?.backends.find((candidate) => candidate.id === selected.backendId)
      setError(modelProviderFailure(cause, backend) ?? (cause instanceof Error ? cause.message : String(cause)))
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  return (
    <Stack gap="section">
      <Show
        when={pick()}
        fallback={
          <Alert tone="warn">
            No model backend is available on this Node. Connect a model or install a supported CLI, then retry.
          </Alert>
        }
      >
        {(selected) => (
          <>
            <ModelBackendPicker
              backends={backends.data?.backends ?? []}
              backendId={selected().backendId}
              modelId={selected().modelId}
              onChange={(next) => {
                setChoice(next)
                void saveGeneratePick(queryClient, next)
              }}
            />
            <Button busy={busy()} disabled={!nodeReady() || busy()} onPress={() => void generate()}>
              {result() || error() ? 'Retry explanation' : props.kind === 'stash' ? 'Explain stash' : 'Explain commit'}
            </Button>
          </>
        )}
      </Show>
      <Show when={busy()}>
        <Text>Generating explanation…</Text>
        <Button variant="ghost" onPress={cancel}>
          Cancel generation
        </Button>
      </Show>
      <Show when={error()}>
        <Alert tone="warn">{error()}</Alert>
      </Show>
      <Show when={result()}>
        {(value) => (
          <>
            <Text wrap>{value().text}</Text>
            <Show when={value().omissions.length}>
              <Alert tone="warn">Context omitted: {value().omissions.join(' ')}</Alert>
            </Show>
          </>
        )}
      </Show>
    </Stack>
  )
}
