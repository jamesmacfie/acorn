import { createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId, effectiveModelPick, modelBackendsOptions, modelPickLabel, prefsOptions,
  readGeneratePick, saveGeneratePick, type ModelPick,
} from '@acorn/plugin-api/client'
import {
  Alert, Button, copyText, Field, Icon, Inline, Modal, ModelBackendPicker, Spinner, Text, Textarea, Toolbar,
} from '@acorn/plugin-api/ui'
import { ModelPickerPopover } from '@acorn/plugin-api/ui/host'
import { modelProviderFailure } from '@acorn/plugin-api/ui/model-provider-failure'
import { SUMMARY_CONTEXT_MAX_CHARS, type SessionSummary } from '../../shared/sessionSummary'
import type { AgentSession } from '../../contract/wire.ts'
import { managedAgentApi } from './managedClient'

export default function SessionSummaryModal(props: { session: AgentSession; onDismiss(): void }) {
  // Bind a delayed generation to the Node and session that opened the dialog.
  const nodeId = activeNodeId()
  const sessionId = props.session.id
  const queryClient = useQueryClient()
  const backendsQuery = createQuery(() => modelBackendsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const backends = () => backendsQuery.isPending ? [] : backendsQuery.data?.backends ?? []
  const [chosen, setChosen] = createSignal<ModelPick | null>(null)
  const pick = createMemo(() => effectiveModelPick(backends(), chosen()
    ?? readGeneratePick(prefs.isPending ? undefined : prefs.data)))
  const [context, setContext] = createSignal('')
  const [generating, setGenerating] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [result, setResult] = createSignal<SessionSummary>()
  const [error, setError] = createSignal('')
  const [copied, setCopied] = createSignal(false)
  let controller: AbortController | undefined
  let output: HTMLTextAreaElement | undefined
  let disposed = false
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    disposed = true
    controller?.abort()
    clearTimeout(copiedTimer)
  })

  async function generate() {
    const selected = pick()
    if (!selected || generating()) return
    const backend = backends().find((candidate) => candidate.id === selected.backendId)
    controller = new AbortController()
    setGenerating(true)
    setExpanded(true)
    setError('')
    setCopied(false)
    try {
      const summary = await managedAgentApi.summarize(sessionId, {
        backendId: selected.backendId,
        ...(selected.modelId ? { modelId: selected.modelId } : {}),
        context: context(),
      }, { nodeId, signal: controller.signal })
      if (!disposed) {
        setResult(summary)
        queueMicrotask(() => { if (!disposed) output?.focus({ preventScroll: true }) })
      }
    } catch (caught) {
      if (!disposed) setError(modelProviderFailure(caught, backend)
        ?? (caught instanceof Error ? caught.message : 'Unable to summarize the run. Try again.'))
    } finally {
      if (!disposed) setGenerating(false)
    }
  }

  async function copy() {
    const text = result()?.markdown
    if (!text) return
    try {
      if (!await copyText(text)) throw new Error('clipboard_unavailable')
      if (disposed) return
      setCopied(true)
      clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => setCopied(false), 1_500)
    } catch {
      if (!disposed) setError('Unable to copy. Select the Markdown and copy it with your keyboard.')
    }
  }

  return (
    <Modal title="Summarize run" size={expanded() ? 'wide' : 'md'} align="center" onDismiss={props.onDismiss}>
      <Modal.Body>
        <Text wrap tone="muted">Summarize “{props.session.title}” up to the moment you generate.</Text>
        <Field label="Extra context (optional)">
          <Textarea value={context()} rows={expanded() ? 2 : 4} maxLength={SUMMARY_CONTEXT_MAX_CHARS}
            placeholder="Who is this for? What should the summary focus on?"
            disabled={generating()} onInput={setContext} onCommit={() => void generate()} />
        </Field>
        <Show when={backendsQuery.isError}>
          <Alert>Unable to load AI models. <Button variant="ghost" onPress={() => void backendsQuery.refetch()}>Retry</Button></Alert>
        </Show>
        <Show when={!backendsQuery.isPending && !backendsQuery.isError && !pick()}>
          <Alert>Connect a model provider or install an agent CLI in Settings to generate a summary.</Alert>
        </Show>
        <Show when={error()}>{(message) => <Alert>{message()}</Alert>}</Show>
        <Show when={expanded()}>
          <Show when={generating()}>
            <Inline><Spinner label="Generating summary" /><Text>Generating Markdown…</Text></Inline>
          </Show>
          <Show when={result()?.truncated}>
            <Text wrap tone="muted">This run exceeds the summary input limit. The summary uses the beginning and recent activity; some middle history is omitted.</Text>
          </Show>
          <Field label="Markdown summary">
            <Textarea ref={(element: HTMLTextAreaElement) => { output = element }} value={result()?.markdown ?? ''} rows={14} mono readOnly
              placeholder={generating() ? 'Your summary will appear here when generation finishes.' : 'Generate again to create your summary.'} />
          </Field>
        </Show>
      </Modal.Body>
      <Modal.Actions>
        <Show when={pick() && !generating()}>
          <ModelPickerPopover title="Choose who summarizes the run" label="Model for the summary"
            tipSub={modelPickLabel(backends(), pick())} sparkle>
            <ModelBackendPicker backends={backends()} backendId={pick()?.backendId ?? ''} modelId={pick()?.modelId ?? ''}
              onChange={(next) => { setChosen(next); void saveGeneratePick(queryClient, next) }} />
          </ModelPickerPopover>
        </Show>
        <Toolbar.Spacer />
        <Button variant="ghost" onPress={props.onDismiss}>{expanded() ? 'Close' : 'Cancel'}</Button>
        <Show when={result() && !generating()}>
          <Button onPress={() => void generate()} disabled={!pick()}>Generate again</Button>
          <Button variant="solid" onPress={() => void copy()}><Icon name={copied() ? 'check' : 'copy'} />{copied() ? 'Copied' : 'Copy Markdown'}</Button>
        </Show>
        <Show when={!result() || generating()}>
          <Button variant="solid" disabled={!pick()} busy={generating()} onPress={() => void generate()}>Generate Markdown</Button>
        </Show>
      </Modal.Actions>
    </Modal>
  )
}
