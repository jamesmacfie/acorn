import { createEffect, createMemo, createSignal, ErrorBoundary, For, on, onCleanup, Show, untrack, type JSX } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { authoringFocusPrefix, type AuthoringContextEntry, type AuthoringTurnRequest, type AuthoringTurnResult } from '@acorn/protocol/authoring.ts'
import type { QueryScope } from '@acorn/protocol/dataQueries.ts'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { modelBackendsOptions, prefsOptions } from '../../infra/queries'
import { writeJson } from '../../infra/node/apiClient'
import { activeCacheId, activeNodeId } from '../../infra/node/activeNode'
import { queryOwner } from '../../infra/node/queryOwnership'
import { ORIGIN_NODE_ID } from '../../infra/node/fleet'
import { effectiveModelPick, readGeneratePick, saveGeneratePick, type ModelPick } from '../settings/models/generatePick'
import ModelBackendPicker from '../settings/models/ModelBackendPicker'
import { authoringStorageKey } from './authoringStorage'
import { Alert, Button, Checkbox, Field, Select, Textarea, Toolbar } from '../../kit/components/primitives'
import { Composer } from '../../kit/components/inputs/Composer'
import { IconButton } from '../../kit/components/inputs/IconButton'
import { Menu } from '../../kit/components/overlays/Menu'
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

type Proposal = Extract<AuthoringTurnResult, { state: 'proposal' }>
type Turn = { who: 'You' | 'AI'; text: string }
const FOCUS_PREFIX = /^\[Focus: [^\]]*\] /

/** The conversation so far in words: what the person asked, and the AI's questions, summaries, and
 *  refusals. The lookups the AI made on the way aren't turns. */
function conversationTurns(context: readonly AuthoringContextEntry[]): Turn[] {
  return context.flatMap((entry): Turn[] => {
    if (entry.role === 'user') return [{ who: 'You', text: entry.content.replace(FOCUS_PREFIX, '') }]
    if (entry.role !== 'assistant') return []
    try {
      const reply = JSON.parse(entry.content) as { kind?: string; summary?: string; question?: string; reasons?: { reason: string }[] }
      const text = reply.kind === 'proposal' ? reply.summary : reply.kind === 'clarification' ? reply.question
        : reply.kind === 'unavailable' ? reply.reasons?.map(item => item.reason).join(' ') : undefined
      return text ? [{ who: 'AI', text }] : []
    } catch { return [] }
  })
}

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
  /** How the conversation draws. `fold` is a section of a form. `modal` is a modal's body and footer,
   *  with Send and Close in the footer. `dock` fills a column beside what it edits: a header with the
   *  model and settings, the turns so far, and a composer. Unset means `modal` with `onClose` and
   *  `fold` without it. */
  layout?: 'fold' | 'modal' | 'dock'
  /** Close calls this. A `dock` draws a Close button only when it is set. */
  onClose?: () => void
  /** Whether the fold starts open, without `onClose`. Default true. A second conversation inside a
   *  form that already has one starts closed. */
  defaultOpen?: boolean
  /** What the request box starts with, such as the part of a plan the person asked about. A new value
   *  replaces what's in the box. */
  instruction?: string
  /** The part the next message is about. It's sent ahead of that message as `authoringFocusPrefix`,
   *  once, and replaced whenever the host passes a new one. */
  focus?: { paths: string[]; title: string }
  /** Starts a new conversation with `instruction` as its first turn, sent as soon as a model is
   *  available, for a host that already asked the person what they want. */
  sendOnOpen?: boolean
  /** How a proposal names what a change touches, such as a workflow step by its name rather than
   *  its id. `candidate` is the proposed value, which holds anything the change adds. The path is
   *  the default. */
  describePath?(path: string, candidate: unknown): string
  /** Hears each proposal as it arrives, and `undefined` when it leaves: applied, rejected, or set
   *  aside by a new message. A host that reviews proposals on its own view listens here. */
  onProposal?(proposal: Proposal | undefined): void
  /** Draws what a proposal covers in place of its list of changed paths, for a host that shows the
   *  changes on its own view. */
  proposalDetail?(proposal: Proposal): JSX.Element
  /** Narrow injection seam for the component's own tests and embedding hosts. */
  sendTurn?(request: AuthoringTurnRequest, signal: AbortSignal): Promise<AuthoringTurnResult>
  onApply(proposal: Proposal): Promise<string | undefined> | string | undefined
}

export default function AuthoringConversation(props: AuthoringConversationProps) {
  const queryClient = useQueryClient()
  const registered = queryOwner(queryClient)
  const nodeId = registered === undefined ? activeNodeId() : registered
  const cacheId = registered === undefined ? activeCacheId() : registered ?? ORIGIN_NODE_ID
  const backendQuery = createQuery(() => modelBackendsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const backends = () => backendQuery.data?.backends ?? []
  const storageKey = createMemo(() => authoringStorageKey(cacheId, props.target, props.targetId))
  const [context, setContext] = createSignal<AuthoringContextEntry[]>([])
  const [pending, setPending] = createSignal<AuthoringTurnResult>()
  const [instruction, setInstruction] = createSignal(props.instruction ?? '')
  const [focus, setFocus] = createSignal(props.focus)
  // A docked conversation outlives one request, so a new one from the host replaces the box and focus.
  createEffect(on(() => [props.instruction, props.focus] as const, ([text, part]) => {
    if (text !== undefined) setInstruction(text)
    setFocus(part)
  }, { defer: true }))
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
  const proposal = () => pending()?.state === 'proposal' ? pending() as Proposal : undefined
  const stopped = () => pending()?.state === 'stopped' ? pending() as Extract<AuthoringTurnResult, { state: 'stopped' }> : undefined
  const unavailable = () => pending()?.state === 'unavailable' ? pending() as Extract<AuthoringTurnResult, { state: 'unavailable' }> : undefined

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
  // After the restore above, so the new conversation replaces a saved one rather than continuing it,
  // and asks the model the person last picked rather than the one this target last used.
  let sentOnOpen = false
  createEffect(() => {
    if (!props.sendOnOpen || sentOnOpen || !backendId()) return
    sentOnOpen = true
    untrack(() => {
      setContext([])
      showReply(undefined)
      setChoice(null)
      void submit()
    })
  })
  createEffect(on(proposal, value => props.onProposal?.(value)))
  onCleanup(() => { controller?.abort(); controller = undefined })

  const submit = async (answer = instruction().trim()): Promise<void> => {
    if (!answer || !backendId() || busy()) return
    const request = new AbortController()
    controller = request
    // A new message sets a proposal under review aside: the reply replaces it.
    if (proposal()) showReply(undefined)
    const part = focus()
    setBusy(true)
    setError('')
    setStatus('Checking available sources, fields, and options…')
    try {
      const body: AuthoringTurnRequest = {
        target: props.target, targetId: props.targetId, scope: props.scope,
        baseRevision: props.baseRevision, base: props.base,
        backendId: backendId(), ...(modelId() ? { modelId: modelId() } : {}),
        instruction: part ? `${authoringFocusPrefix(part.paths, part.title)}${answer}` : answer,
        context: context(), samplesEnabled: samplesEnabled(),
      }
      const result = props.sendTurn
        ? await props.sendTurn(body, request.signal)
        : await writeJson<AuthoringTurnResult>(props.endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
            signal: request.signal, timeoutMs: TIMEOUT_MS, nodeId,
          })
      if (request.signal.aborted || controller !== request) return
      setContext(result.context)
      showReply(result)
      setInstruction('')
      if (focus() === part) setFocus(undefined)
      setStatus(result.state === 'proposal' ? 'Proposal ready for review.' : result.state === 'clarification' ? 'Waiting for your answer.' : result.state === 'unavailable' ? 'This request is unavailable.' : result.reason)
    } catch (failure) {
      if (!request.signal.aborted && controller === request) setError(failure instanceof Error ? failure.message : 'AI authoring failed.')
    } finally {
      if (controller === request) { setBusy(false); controller = undefined }
    }
  }

  const reject = (): void => {
    const current = pending()
    setContext(value => [...value, { role: 'user', content: current?.state === 'proposal' ? 'Rejected that proposal.' : 'Dismissed that question.' }])
    showReply(undefined)
    setStatus('Draft unchanged.')
  }
  const apply = async (proposal: Proposal): Promise<void> => {
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
  const layout = props.layout ?? (props.onClose ? 'modal' : 'fold')
  const docked = layout === 'dock'
  const usage = (value: Proposal) => `${value.usage.requests} model request${value.usage.requests === 1 ? '' : 's'} · ${value.usage.inputTokens} input tokens · ${value.usage.outputTokens} output tokens`

  const feedback = <>
    <Show when={status()}>{value => <Text emphasis="muted" wrap>{value()}</Text>}</Show>
    <Show when={error()}>{value => <Alert tone="warn">{value()}</Alert>}</Show>
  </>
  // The reply is model-shaped data, and a throw while drawing it would otherwise leave the whole
  // dialog frozen with no message.
  const reply = (
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
    <Show when={proposal()}>{value => <Alert tone={value().problems.length ? 'warn' : undefined} title={docked ? 'AI proposal' : 'Review AI proposal'}>
        <Stack gap="row">
          <Text wrap>{value().summary}</Text>
          <Show when={props.proposalDetail} fallback={<>
            <For each={value().diff.slice(0, 20)}>{change => <Text wrap>{`${CHANGE_WORD[change.change] ?? change.change} ${describe(change.path, value().candidate)}: ${clipped(change.before)} → ${clipped(change.after)}`}</Text>}</For>
            <Show when={value().diff.length > 20}><Text emphasis="muted">{`and ${value().diff.length - 20} more changes`}</Text></Show>
          </>}>{detail => detail()(value())}</Show>
          <For each={value().unaddressed ?? []}>{item => <Text wrap>{`${docked ? 'Not covered' : 'Not addressed'}: ${item}`}</Text>}</For>
          <For each={value().problems}>{problem => <Text wrap>{problem}</Text>}</For>
          <Show when={docked} fallback={<Text emphasis="muted">{usage(value())}</Text>}>
            <Fold label="Details" level="sub" defaultOpen={false}><Text emphasis="muted" wrap>{usage(value())}</Text></Fold>
          </Show>
          <Inline gap="inline">
            <Button variant="solid" disabled={value().problems.length > 0 || props.disabled} onPress={() => void apply(value())}>{docked ? 'Apply' : 'Apply reviewed edit'}</Button>
            <Button variant="bare" onPress={reject}>{docked ? 'Discard' : 'Reject'}</Button>
          </Inline>
        </Stack>
      </Alert>}</Show>
    <Show when={stopped()}>{value => <Alert tone="warn">{value().reason}</Alert>}</Show>
    <Show when={unavailable()}>{value => <Alert tone="warn" title="This request is unavailable"><For each={value().reasons}>{reason => <Text wrap>{`${reason.capability}: ${reason.reason}`}</Text>}</For></Alert>}</Show>
    </ErrorBoundary>
  )
  const samplesNote = () => samplesEnabled()
    ? 'Up to 3 records and 16 KiB from a model-requested preview may be sent through the selected backend.'
    : "The AI sees each source's fields and choices, not its records."

  if (docked) return <DockedConversation {...{ backends, backendId, modelId, samplesEnabled, samplesNote, busy, stop }}
    turns={() => {
      // The reply waiting below is drawn in full there, so its line here would say it twice.
      const turns = conversationTurns(context())
      return pending() && turns.at(-1)?.who === 'AI' ? turns.slice(0, -1) : turns
    }}
    // The box stays enabled while the models load, so a host can focus it as the dock opens.
    instruction={instruction()} onInstruction={setInstruction} disabled={!!props.disabled || (!backendQuery.isPending && !backendId())}
    onPick={next => { setChoice(next); void saveGeneratePick(queryClient, next) }}
    onSamples={() => setSamplesEnabled(value => !value)} onSubmit={answer => void submit(answer.trim())}
    {...(props.onClose ? { onClose: props.onClose } : {})}>{feedback}{reply}</DockedConversation>

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
      <Text emphasis="muted" wrap>{samplesNote()}</Text>
      <Show when={layout === 'fold'}>
        <Inline gap="inline" wrap>
          {send()}
          <Show when={busy()}><Button variant="bare" onPress={stop}>Cancel</Button></Show>
        </Inline>
      </Show>
      {feedback}
      {reply}
    </Stack>
  )
  if (layout === 'fold') return <Fold label={`AI authoring · ${props.label}`} level="group" defaultOpen={props.defaultOpen ?? true}>{body}</Fold>
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

/** One choice per backend and model, so the dock's header holds a single select. Mirrors
 *  ModelBackendPicker: an agent CLI also offers its own default, and a saved model the catalog no
 *  longer lists stays choosable. */
const modelChoices = (backends: readonly ModelBackend[], current: ModelPick | undefined) => backends.flatMap(backend => [
  ...(backend.kind === 'harness' || !backend.models.length ? [{ id: '', label: `${backend.label} default` }] : []),
  ...backend.models.map(model => ({ id: model.id, label: backends.length > 1 ? `${backend.label} · ${model.label}` : model.label })),
  ...(current?.backendId === backend.id && current.modelId && !backend.models.some(model => model.id === current.modelId)
    ? [{ id: current.modelId, label: `${current.modelId} (saved)` }] : []),
].map(model => ({ value: JSON.stringify([backend.id, model.id]), label: model.label })))

/** The `dock` layout: a header with the model and settings, the turns so far, the reply waiting for an
 *  answer, and a composer. The conversation's state stays in AuthoringConversation. */
function DockedConversation(props: {
  backends: () => ModelBackend[]
  backendId: () => string
  modelId: () => string
  samplesEnabled: () => boolean
  samplesNote: () => string
  busy: () => boolean
  turns: () => Turn[]
  instruction: string
  disabled: boolean
  stop: () => void
  onInstruction: (value: string) => void
  onPick: (pick: ModelPick) => void
  onSamples: () => void
  onSubmit: (answer: string) => void
  onClose?: () => void
  children: JSX.Element
}) {
  const pick = () => props.backendId() ? { backendId: props.backendId(), modelId: props.modelId() } : undefined
  return (
    <Stack gap="stack">
      {/* The select takes the room a spacer would, so the model's name shows in full. */}
      <Toolbar size="sm" ariaLabel="AI">
        <Select label="Model" size="sm" value={JSON.stringify([props.backendId(), props.modelId()])} options={modelChoices(props.backends(), pick())}
          onChange={value => { const [backendId, modelId] = JSON.parse(value) as [string, string]; props.onPick({ backendId, modelId }) }} />
        <Menu ariaLabel="AI settings" placement="bottom-end"
          trigger={({ open, toggle }) => <IconButton icon="sliders-horizontal" label="AI settings" size="sm" opens="menu" expanded={open()} onPress={toggle} />}>
          {menu => <>
            <Menu.Item context={menu} kind="checkbox" checked={props.samplesEnabled()} disabled={props.busy()} onSelect={props.onSamples}>
              <Stack gap="none"><Text>Use preview records to help AI</Text><Text emphasis="muted" wrap>{props.samplesNote()}</Text></Stack>
            </Menu.Item>
          </>}
        </Menu>
        <Show when={props.onClose}>{close => <Button size="sm" variant="ghost" onPress={() => close()()}>Close</Button>}</Show>
      </Toolbar>
      <For each={props.turns()}>{turn => <Stack gap="none"><Text emphasis="eyebrow">{turn.who}</Text><Text wrap>{turn.text}</Text></Stack>}</For>
      {props.children}
      <Composer value={props.instruction} onInput={props.onInstruction} onSubmit={props.onSubmit} busy={props.busy()} disabled={props.disabled}
        placeholder="Ask for a change" submitLabel="Send" secondary={<Show when={props.busy()}><Button variant="bare" onPress={props.stop}>Cancel</Button></Show>} />
    </Stack>
  )
}
