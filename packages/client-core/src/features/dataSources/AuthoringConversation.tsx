import { createEffect, createMemo, createSignal, ErrorBoundary, For, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { AuthoringContextEntry, AuthoringTurnRequest, AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import type { QueryScope } from '@acorn/protocol/dataQueries.ts'
import { modelBackendsOptions, prefsOptions } from '../../infra/queries'
import { writeJson } from '../../infra/node/apiClient'
import { activeCacheId } from '../../infra/node/activeNode'
import { effectiveModelPick, readGeneratePick, saveGeneratePick, type ModelPick } from '../settings/models/generatePick'
import ModelBackendPicker from '../settings/models/ModelBackendPicker'
import { Alert, Button, Checkbox, Field, Textarea } from '../../kit/components/primitives'
import { Fold } from '../../kit/components/layout/Fold'
import { ModalActions, ModalBody } from '../../kit/components/overlays/Modal'
import { Inline } from '../../kit/components/layout/Inline'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'

const TIMEOUT_MS = 11 * 60_000
type Saved = {
  context: AuthoringContextEntry[]
  pending?: AuthoringTurnResult
  backendId?: string
  modelId?: string
  samplesEnabled: boolean
}

const CHANGE_WORD: Record<string, string> = { add: 'Added', remove: 'Removed', change: 'Changed' }

const clipped = (value: unknown): string => {
  // An added path has no `before` and a removed one no `after`, and JSON.stringify(undefined) is
  // undefined, not a string.
  const encoded = JSON.stringify(value) ?? 'nothing'
  return encoded.length > 500 ? `${encoded.slice(0, 497)}…` : encoded
}

export type AuthoringConversationProps = {
  endpoint: string
  target: AuthoringTurnRequest['target']
  targetId: string
  scope: QueryScope
  baseRevision: number
  base: unknown
  label: string
  disabled?: boolean
  /** Drawn as a modal's body and footer, with Send and Close in the footer, for a host that frames
   *  it in a `Modal`. Close calls this. Without it the conversation draws in its own fold. */
  onClose?: () => void
  /** How a proposal names what a change touches, such as a workflow step by its name rather than
   *  its id. `candidate` is the proposed value, which holds anything the change adds. The path is
   *  the default. */
  describePath?(path: string, candidate: unknown): string
  /** Narrow injection seam for the component's own tests and embedding hosts. */
  sendTurn?(request: AuthoringTurnRequest, signal: AbortSignal): Promise<AuthoringTurnResult>
  onApply(proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<string | undefined> | string | undefined
}

export default function AuthoringConversation(props: AuthoringConversationProps) {
  const queryClient = useQueryClient()
  const backendQuery = createQuery(() => modelBackendsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const backends = () => backendQuery.data?.backends ?? []
  const storageKey = createMemo(() => `acorn:ai-authoring:v1:${activeCacheId()}:${props.target}:${props.targetId}`)
  const [context, setContext] = createSignal<AuthoringContextEntry[]>([])
  const [pending, setPending] = createSignal<AuthoringTurnResult>()
  const [instruction, setInstruction] = createSignal('')
  const [samplesEnabled, setSamplesEnabled] = createSignal(false)
  const [choice, setChoice] = createSignal<ModelPick | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [status, setStatus] = createSignal('')
  let controller: AbortController | undefined
  // Set while the reply boundary below shows its fallback. A boundary stays on its fallback until
  // reset, so every change of reply resets it after the new reply is in place.
  let resetReply: (() => void) | undefined
  const showReply = (next: AuthoringTurnResult | undefined): void => {
    setPending(next)
    const reset = resetReply
    resetReply = undefined
    reset?.()
  }

  const pick = createMemo(() => choice() ?? effectiveModelPick(backends(), readGeneratePick(prefs.data)))
  const backendId = () => pick()?.backendId ?? ''
  const modelId = () => pick()?.modelId ?? ''
  const clarification = () => pending()?.state === 'clarification' ? pending() as Extract<AuthoringTurnResult, { state: 'clarification' }> : undefined
  const proposal = () => pending()?.state === 'proposal' ? pending() as Extract<AuthoringTurnResult, { state: 'proposal' }> : undefined
  const stopped = () => pending()?.state === 'stopped' ? pending() as Extract<AuthoringTurnResult, { state: 'stopped' }> : undefined

  const save = (): void => {
    if (typeof localStorage === 'undefined') return
    const value: Saved = { context: context(), pending: pending(), backendId: backendId() || undefined, modelId: modelId() || undefined, samplesEnabled: samplesEnabled() }
    localStorage.setItem(storageKey(), JSON.stringify(value))
  }
  createEffect(() => {
    const key = storageKey()
    if (typeof localStorage === 'undefined') return
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Saved | null
      setContext(value?.context ?? [])
      showReply(value?.pending)
      setSamplesEnabled(value?.samplesEnabled ?? false)
      if (value?.backendId) setChoice({ backendId: value.backendId, modelId: value.modelId ?? '' })
    } catch { localStorage.removeItem(key) }
  })
  createEffect(() => { context(); pending(); samplesEnabled(); choice(); save() })
  onCleanup(() => controller?.abort())

  const submit = async (answer = instruction().trim()): Promise<void> => {
    if (!answer || !backendId() || busy()) return
    controller = new AbortController()
    setBusy(true)
    setError('')
    setStatus('Checking available sources, fields, and options…')
    try {
      const body: AuthoringTurnRequest = {
        target: props.target, targetId: props.targetId, scope: props.scope,
        baseRevision: props.baseRevision, base: props.base,
        backendId: backendId(), ...(modelId() ? { modelId: modelId() } : {}),
        instruction: answer, context: context(), samplesEnabled: samplesEnabled(),
      }
      const result = props.sendTurn
        ? await props.sendTurn(body, controller.signal)
        : await writeJson<AuthoringTurnResult>(props.endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
            signal: controller.signal, timeoutMs: TIMEOUT_MS,
          })
      setContext(result.context)
      showReply(result)
      setInstruction('')
      setStatus(result.state === 'proposal' ? 'Proposal ready for review.' : result.state === 'clarification' ? 'Waiting for your answer.' : result.reason)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'AI authoring failed.')
    } finally {
      setBusy(false)
      controller = undefined
    }
  }

  const reject = (): void => {
    const current = pending()
    setContext(value => [...value, { role: 'user', content: current?.state === 'proposal' ? 'Rejected that proposal.' : 'Dismissed that question.' }])
    showReply(undefined)
    setStatus('Draft unchanged.')
  }
  const apply = async (proposal: Extract<AuthoringTurnResult, { state: 'proposal' }>): Promise<void> => {
    setError('')
    const problem = await props.onApply(proposal)
    if (problem) { setError(problem); return }
    showReply(undefined)
    setContext(value => [...value, { role: 'user', content: 'Applied the reviewed proposal.' }])
    setStatus('Applied as one undoable draft edit.')
  }

  const stop = (): void => { controller?.abort(); setBusy(false); setStatus('Cancelled. The draft was not changed.') }
  const send = () => (
    <Button variant="solid" disabled={busy() || props.disabled || !instruction().trim() || !backendId()} busy={busy()} onPress={() => void submit()}>Send</Button>
  )
  const describe = (path: string, candidate: unknown): string => props.describePath?.(path, candidate) ?? path

  // What to ask comes first, then who answers it, then what they may read.
  const body = (
    <Stack gap="row">
      <Field label="What should AI change?" group>
        <Textarea label="What should AI change?" assist={false} rows={4} maxLength={8_000} value={instruction()}
          disabled={busy() || props.disabled} onInput={setInstruction} />
      </Field>
      <ModelBackendPicker backends={backends()} backendId={backendId()} modelId={modelId()} onChange={next => {
        setChoice(next)
        void saveGeneratePick(queryClient, next)
      }} />
      <Checkbox label="Use preview records to help AI" checked={samplesEnabled()} disabled={busy() || props.disabled}
        onChange={setSamplesEnabled} />
      <Text emphasis="muted" wrap>
        {samplesEnabled()
          ? 'Up to 3 records and 16 KiB from a model-requested preview may be sent through the selected backend.'
          : 'Only source metadata is shared. Preview record contents stay off.'}
      </Text>
      <Show when={!props.onClose}>
        <Inline gap="inline" wrap>
          {send()}
          <Show when={busy()}><Button variant="bare" onPress={stop}>Cancel</Button></Show>
        </Inline>
      </Show>
      <Show when={status()}>{value => <Text emphasis="muted" wrap>{value()}</Text>}</Show>
      <Show when={error()}>{value => <Alert tone="warn">{value()}</Alert>}</Show>
      {/* The reply is model-shaped data, and a throw while drawing it would otherwise leave the whole
          dialog frozen with no message. */}
      <ErrorBoundary fallback={(failure, reset) => { resetReply = reset; return <Alert tone="warn" title="The reply could not be shown">
          <Stack gap="row">
            <Text wrap>{failure instanceof Error ? failure.message : String(failure)}</Text>
            <Inline gap="inline"><Button size="sm" variant="bare" onPress={reject}>Dismiss</Button></Inline>
          </Stack>
        </Alert> }}>
      <Show when={clarification()}>{value => <Alert title={value().question}>
          <Inline gap="inline" wrap>
            <For each={value().choices}>{option => <Button size="sm" onPress={() => void submit(`Selected ${option.id}: ${option.label}`)}>{option.label}</Button>}</For>
            <Button size="sm" variant="bare" onPress={reject}>Dismiss</Button>
          </Inline>
        </Alert>}</Show>
      <Show when={proposal()}>{value => <Alert tone={value().problems.length ? 'warn' : undefined} title="Review AI proposal">
          <Stack gap="row">
            <Text wrap>{value().summary}</Text>
            <For each={value().diff.slice(0, 20)}>{change => <Text wrap>{`${CHANGE_WORD[change.change] ?? change.change} ${describe(change.path, value().candidate)}: ${clipped(change.before)} → ${clipped(change.after)}`}</Text>}</For>
            <Show when={value().diff.length > 20}><Text emphasis="muted">{`and ${value().diff.length - 20} more changes`}</Text></Show>
            <For each={value().problems}>{problem => <Text wrap>{problem}</Text>}</For>
            <Text emphasis="muted">{`${value().usage.requests} model request${value().usage.requests === 1 ? '' : 's'} · ${value().usage.inputTokens} input tokens · ${value().usage.outputTokens} output tokens`}</Text>
            <Inline gap="inline">
              <Button variant="solid" disabled={value().problems.length > 0 || props.disabled} onPress={() => void apply(value())}>Apply reviewed edit</Button>
              <Button variant="bare" onPress={reject}>Reject</Button>
            </Inline>
          </Stack>
        </Alert>}</Show>
      <Show when={stopped()}>{value => <Alert tone="warn">{value().reason}</Alert>}</Show>
      </ErrorBoundary>
    </Stack>
  )
  if (!props.onClose) return <Fold label={`AI authoring · ${props.label}`} level="group" defaultOpen>{body}</Fold>
  // While a turn is out, the ghost button stops it rather than closing over it.
  return (
    <>
      <ModalBody>{body}</ModalBody>
      <ModalActions>
        <Show when={busy()} fallback={<Button variant="ghost" onPress={() => props.onClose?.()}>Close</Button>}>
          <Button variant="ghost" onPress={stop}>Cancel</Button>
        </Show>
        {send()}
      </ModalActions>
    </>
  )
}
