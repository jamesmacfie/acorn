import { createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  effectiveModelPick,
  latestSignal,
  modelBackendsOptions,
  modelPickLabel,
  nodeReady,
  prefsOptions,
  readGeneratePick,
  saveGeneratePick,
  type ModelPick,
} from '@acorn/plugin-api/client'
import { Button, Inline, ModelBackendPicker } from '@acorn/plugin-api/ui'
import { ModelPickerPopover } from '@acorn/plugin-api/ui/host'
import { modelProviderFailure } from '@acorn/plugin-api/ui/model-provider-failure'
import type { AgentRequest } from '../../contract/wire.ts'
import { managedAgentApi } from './managedClient'

// Explanations by request row, so one that cost tokens survives the transcript remounting its card.
const retained = new Map<string, string>()
const RETAINED = 16
export const retainedExplanation = (requestId: string): string => retained.get(requestId) ?? ''

// "What would allowing this do?", at the end of a permission card's buttons: the sparkle picks who
// answers, as it does for the commit message and the run summary, and Explain asks. The card draws the
// answer, so it stays after the request is settled and these controls are gone.
//
// Drawn only when there is a model to spend, like the commit message button: Settings is where a
// connection is made, and a permission card is no place to send someone there.
export default function RequestExplain(props: {
  request: AgentRequest
  explained: boolean
  onExplained: (text: string) => void
  onFailed: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const backendsQuery = createQuery(() => modelBackendsOptions(nodeReady()))
  const prefs = createQuery(() => prefsOptions(nodeReady()))
  const backends = () => backendsQuery.data?.backends ?? []
  const [chosen, setChosen] = createSignal<ModelPick | null>(null)
  const pick = createMemo(() => effectiveModelPick(backends(), chosen() ?? readGeneratePick(prefs.data)))
  const [busy, setBusy] = createSignal(false)
  const generating = latestSignal()
  onCleanup(() => generating.abort())

  async function explain() {
    const selected = pick()
    if (!selected || busy()) return
    const signal = generating.next()
    const { id, sessionId, providerRequestId } = props.request
    setBusy(true)
    props.onFailed('')
    try {
      const { text } = await managedAgentApi.explainRequest(
        sessionId,
        providerRequestId,
        { backendId: selected.backendId, ...(selected.modelId ? { modelId: selected.modelId } : {}) },
        { nodeId: activeNodeId(), signal },
      )
      if (signal.aborted) return
      retained.delete(id)
      retained.set(id, text)
      if (retained.size > RETAINED) retained.delete(retained.keys().next().value!)
      props.onExplained(text)
    } catch (caught) {
      if (signal.aborted) return
      const backend = backends().find((candidate) => candidate.id === selected.backendId)
      props.onFailed(
        modelProviderFailure(caught, backend) ??
          (caught instanceof Error ? caught.message : 'Unable to explain this request. Try again.'),
      )
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }

  return (
    <Show when={pick()}>
      <Inline gap="inline">
        <ModelPickerPopover
          title="Choose who explains the request"
          label="Model for the explanation"
          tipSub={modelPickLabel(backends(), pick())}
          sparkle
        >
          <ModelBackendPicker
            backends={backends()}
            backendId={pick()?.backendId ?? ''}
            modelId={pick()?.modelId ?? ''}
            onChange={(next) => {
              setChosen(next)
              void saveGeneratePick(queryClient, next)
            }}
          />
        </ModelPickerPopover>
        <Button busy={busy()} disabled={!nodeReady()} onPress={() => void explain()}>
          {props.explained ? 'Explain again' : 'Explain'}
        </Button>
      </Inline>
    </Show>
  )
}
