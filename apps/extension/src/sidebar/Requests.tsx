import { For, Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import type { BridgeAgentRequest, BridgeRequestResolution } from '@acorn/protocol/extensionBridge.ts'
import { Button, Card, CodeBlock } from '@acorn/client-core/kit/components/primitives.tsx'
import { CallFailure, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import type { DraftTarget } from '../localState'

const KIND_LABELS: Record<string, string> = {
  permission: 'Permission',
  question: 'Question',
  elicitation: 'Request for consent',
}

// The line under a request once it has an answer. A pending one has none: the amber stripe says it.
const STATUS_LABELS: Record<BridgeAgentRequest['status'], string | null> = {
  pending: null,
  resolving: 'Answer sent. Waiting for the agent to take it.',
  resolved: 'Answered',
  expired: 'Expired: the agent stopped waiting for this answer.',
}

type Answers = Record<string, string | string[]>

// The requests the agent is waiting on in one conversation. Each read of the conversation brings the
// Node's current state of every open request, so a request answered here, in another client, or
// expired by the Node shows as settled and loses its buttons. A request shown open stays on screen
// once settled, so the person sees what became of it. One settled before it was shown is history.
export function Requests(props: {
  client: BridgeClient
  target: DraftTarget
  requests: readonly BridgeAgentRequest[]
  online: boolean
  // An answer finished, either way. The conversation reads itself again.
  settled(): void
}) {
  const seen = new Set<string>()
  const shown = createMemo(() =>
    props.requests
      .filter((request) => {
        if (request.status === 'pending' || request.status === 'resolving') seen.add(request.requestId)
        return seen.has(request.requestId)
      })
      .map((request) => request.requestId),
  )
  const byId = createMemo(() => new Map(props.requests.map((request) => [request.requestId, request])))
  // Keyed by ID, so a fresh read updates a card in place and keeps what the person has typed.
  return (
    <For each={shown()}>
      {(requestId) => (
        <RequestCard
          client={props.client}
          target={props.target}
          request={byId().get(requestId)!}
          online={props.online}
          settled={props.settled}
        />
      )}
    </For>
  )
}

// Sends one request's answer, for a request card or a Needs you row. The Node settles a request once,
// so an answer to one already settled, here or in another client, comes back as the settled request,
// which `send` returns as it does its own.
export function createAnswer(props: {
  client: BridgeClient
  target: DraftTarget
  request(): BridgeAgentRequest
  online(): boolean
  // An answer finished, either way. The caller reads the request again.
  settled(): void
}) {
  const target = props.target
  const [sending, setSending] = createSignal(false)
  const [note, setNote] = createSignal<string | null>(null)
  let mounted = true
  onCleanup(() => (mounted = false))
  // The answer the Node didn't confirm, and the key it went with. Pressing the same answer again reuses
  // the key, so the Node settles the request once. Nothing presses it again but the person.
  let unconfirmed: { key: string; resolution: string } | null = null

  const answerable = () => props.request().status === 'pending' && !props.request().unsupported
  const disabled = () => !answerable() || sending() || !props.online()

  const send = async (resolution: BridgeRequestResolution): Promise<BridgeAgentRequest | null> => {
    if (disabled()) return null
    const body = JSON.stringify(resolution)
    const key = unconfirmed?.resolution === body ? unconfirmed.key : crypto.randomUUID()
    setSending(true)
    setNote(null)
    try {
      const result = await props.client.call({
        op: 'request.resolve',
        nodeId: target.nodeId,
        sessionId: target.sessionId,
        requestId: props.request().requestId,
        resolution,
        key,
      })
      unconfirmed = null
      return result.request
    } catch (error) {
      if (!mounted) return null
      const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
      if (isUncertain(failure.code)) {
        unconfirmed = { key, resolution: body }
        setNote(
          "The Node didn't confirm this answer, so it may have arrived. The request was read again. If it is still waiting, the same answer is sent once, never twice.",
        )
      } else if (failure.code === 'not_selected') setNote('That Node is no longer selected, so nothing was sent.')
      else setNote(errorGuidance(failure))
      return null
    } finally {
      if (mounted) setSending(false)
      props.settled()
    }
  }
  return { send, sending, note, answerable, disabled }
}

// One button a request offers, and the answer it sends.
export type Choice = { label: string; reject: boolean; resolution: BridgeRequestResolution }

export const optionChoices = (request: BridgeAgentRequest): Choice[] =>
  request.options.map((option) => ({ label: option.label, reject: option.reject, resolution: { optionId: option.id } }))

// A request's buttons, as the desktop draws them: the first solid, a refusal a quiet danger, the rest
// plain. Anything passed as children sits at the far end.
export function ChoiceButtons(props: {
  choices: readonly Choice[]
  disabled: boolean
  choose(choice: Choice): void
  children?: JSX.Element
}) {
  return (
    <div class="row choices">
      <For each={props.choices}>
        {(choice, index) => (
          <Button
            size="sm"
            variant={index() === 0 ? 'solid' : choice.reject ? 'ghost' : 'outline'}
            tone={index() === 0 ? 'accent' : choice.reject ? 'danger' : 'neutral'}
            disabled={props.disabled}
            onPress={() => props.choose(choice)}
          >
            {choice.label}
          </Button>
        )}
      </For>
      {props.children}
    </div>
  )
}

// One request and its answer, in the desktop's card. Answers live in this card's memory only: never in
// browser storage, and gone when the card is. A secret question takes a password field.
function RequestCard(props: {
  client: BridgeClient
  target: DraftTarget
  request: BridgeAgentRequest
  online: boolean
  settled(): void
}) {
  const [answers, setAnswers] = createSignal<Answers>({})
  const reply = createAnswer({
    client: props.client,
    target: props.target,
    request: () => props.request,
    online: () => props.online,
    settled: () => props.settled(),
  })
  const { sending, note, answerable, disabled } = reply

  const request = () => props.request
  const open = () => request().status === 'pending'
  const typed = (id: string) => {
    const value = answers()[id]
    return typeof value === 'string' ? value : ''
  }
  const ticked = (id: string) => {
    const value = answers()[id]
    return Array.isArray(value) ? value : []
  }
  const answer = (id: string, value: string | string[]) => setAnswers((current) => ({ ...current, [id]: value }))
  const resolve = async (resolution: BridgeRequestResolution) => {
    if (await reply.send(resolution)) setAnswers({})
  }

  return (
    <article class="request" aria-label={`Request: ${request().title}`} data-status={request().status}>
      <Card stripe={open() ? 'warn' : undefined} pad="sm">
        <span class="eyebrow">{KIND_LABELS[request().kind] ?? request().kind}</span>
        <strong>{request().title}</strong>
        <Show when={request().detail}>
          {(detail) => (
            <CodeBlock wrap maxHeight="block">
              {detail()}
            </CodeBlock>
          )}
        </Show>
        <Show when={request().approval}>
          {(approval) => (
            <div class="approval">
              <p>App: {approval().target}</p>
              <p class="quiet">{approval().scopeNote}</p>
              <Show when={approval().warning}>{(warning) => <p class="problem">{warning()}</p>}</Show>
            </div>
          )}
        </Show>
        <Show when={open() && request().unsupported}>
          {(reason) => (
            <>
              <Show when={request().questions.length}>
                <ul class="asked">
                  <For each={request().questions}>{(question) => <li>{questionLabel(question)}</li>}</For>
                </ul>
              </Show>
              <Show when={request().options.length}>
                <p class="quiet">
                  Choices:{' '}
                  {request()
                    .options.map((option) => option.label)
                    .join(', ')}
                </p>
              </Show>
              <p class="notice">{reason()}</p>
            </>
          )}
        </Show>
        <Show when={answerable()}>
          <Show when={request().questions.length}>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void resolve({ answers: answers() })
              }}
            >
              <For each={request().questions}>
                {(question) => (
                  <Show
                    when={question.options.length}
                    fallback={
                      <label>
                        {questionLabel(question)}
                        <input
                          name={`answer:${question.id}`}
                          type={question.secret ? 'password' : 'text'}
                          autocomplete="off"
                          value={typed(question.id)}
                          onInput={(event) => answer(question.id, event.currentTarget.value)}
                        />
                      </label>
                    }
                  >
                    <Show
                      when={question.multiple}
                      fallback={
                        <label>
                          {questionLabel(question)}
                          <select
                            name={`answer:${question.id}`}
                            value={typed(question.id)}
                            onChange={(event) => answer(question.id, event.currentTarget.value)}
                          >
                            <option value="">Choose…</option>
                            <For each={question.options}>
                              {(option) => (
                                <option value={option.label} title={option.description ?? undefined}>
                                  {option.label}
                                </option>
                              )}
                            </For>
                          </select>
                        </label>
                      }
                    >
                      <fieldset>
                        <legend>{questionLabel(question)}</legend>
                        <For each={question.options}>
                          {(option) => (
                            <label class="check" title={option.description ?? undefined}>
                              <input
                                type="checkbox"
                                name={`answer:${question.id}:${option.label}`}
                                checked={ticked(question.id).includes(option.label)}
                                onChange={(event) => {
                                  const others = ticked(question.id).filter((label) => label !== option.label)
                                  answer(question.id, event.currentTarget.checked ? [...others, option.label] : others)
                                }}
                              />
                              {option.label}
                            </label>
                          )}
                        </For>
                      </fieldset>
                    </Show>
                  </Show>
                )}
              </For>
              <button type="submit" disabled={disabled()}>
                {sending() ? 'Sending…' : 'Submit answers'}
              </button>
            </form>
          </Show>
          <Show when={request().options.length}>
            <ChoiceButtons
              choices={optionChoices(request())}
              disabled={disabled()}
              choose={(choice) => void resolve(choice.resolution)}
            />
          </Show>
        </Show>
        <Show when={STATUS_LABELS[request().status]}>
          {(label) => (
            <p class="quiet" data-testid="request-status">
              {label()}
              {request().status === 'resolved' && request().answer ? `: ${request().answer}` : ''}
            </p>
          )}
        </Show>
        <Show when={request().sentNote}>{(sent) => <p class="quiet">{sent()}</p>}</Show>
        <Show when={answerable() && !props.online}>
          <p class="notice">The Node is not connected. Answer once it is.</p>
        </Show>
        <Show when={note()}>{(shown) => <p class="notice">{shown()}</p>}</Show>
      </Card>
    </article>
  )
}

const questionLabel = (question: BridgeAgentRequest['questions'][number]) =>
  question.header ? `${question.header}: ${question.prompt}` : question.prompt
