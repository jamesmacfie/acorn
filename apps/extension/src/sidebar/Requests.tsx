import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js'
import type { BridgeAgentRequest, BridgeRequestResolution } from '@acorn/protocol/extensionBridge.ts'
import { CallFailure, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import type { DraftTarget } from './localState'

const KIND_LABELS: Record<string, string> = {
  permission: 'Permission request',
  question: 'Question',
  elicitation: 'Request for consent',
}

const STATUS_LABELS: Record<BridgeAgentRequest['status'], string> = {
  pending: 'Waiting for an answer',
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

// One request and its answer. Answers live in this card's memory only: never in browser storage, and
// gone when the card is. A secret question takes a password field.
function RequestCard(props: {
  client: BridgeClient
  target: DraftTarget
  request: BridgeAgentRequest
  online: boolean
  settled(): void
}) {
  const target = props.target
  const [answers, setAnswers] = createSignal<Answers>({})
  const [sending, setSending] = createSignal(false)
  const [note, setNote] = createSignal<string | null>(null)
  let mounted = true
  onCleanup(() => (mounted = false))
  // The answer the Node didn't confirm, and the key it went with. Pressing the same answer again reuses
  // the key, so the Node settles the request once. Nothing presses it again but the person.
  let unconfirmed: { key: string; resolution: string } | null = null

  const request = () => props.request
  const open = () => request().status === 'pending'
  const answerable = () => open() && !request().unsupported
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
    if (!answerable() || sending() || !props.online) return
    const body = JSON.stringify(resolution)
    const key = unconfirmed?.resolution === body ? unconfirmed.key : crypto.randomUUID()
    setSending(true)
    setNote(null)
    try {
      await props.client.call({
        op: 'request.resolve',
        nodeId: target.nodeId,
        sessionId: target.sessionId,
        requestId: request().requestId,
        resolution,
        key,
      })
      unconfirmed = null
      if (mounted) setAnswers({})
    } catch (error) {
      if (!mounted) return
      const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
      if (isUncertain(failure.code)) {
        unconfirmed = { key, resolution: body }
        setNote(
          "The Node didn't confirm this answer, so it may have arrived. The request was read again. If it is still waiting, the same answer is sent once, never twice.",
        )
      } else if (failure.code === 'not_selected') setNote('That Node is no longer selected, so nothing was sent.')
      else setNote(errorGuidance(failure))
    } finally {
      if (mounted) setSending(false)
      props.settled()
    }
  }

  const disabled = () => !answerable() || sending() || !props.online

  return (
    <article class="card request" aria-label={`Request: ${request().title}`} data-status={request().status}>
      <p class="quiet">{KIND_LABELS[request().kind] ?? request().kind}</p>
      <strong>{request().title}</strong>
      <Show when={request().detail}>{(detail) => <pre class="detail">{detail()}</pre>}</Show>
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
          <div class="row">
            <For each={request().options}>
              {(option) => (
                <button
                  type="button"
                  class={option.reject ? 'quiet' : undefined}
                  disabled={disabled()}
                  onClick={() => void resolve({ optionId: option.id })}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <p class="quiet" data-testid="request-status">
        {STATUS_LABELS[request().status]}
        {request().status === 'resolved' && request().answer ? `: ${request().answer}` : ''}
      </p>
      <Show when={request().sentNote}>{(sent) => <p class="quiet">{sent()}</p>}</Show>
      <Show when={answerable() && !props.online}>
        <p class="notice">The Node is not connected. Answer once it is.</p>
      </Show>
      <Show when={note()}>{(shown) => <p class="notice">{shown()}</p>}</Show>
    </article>
  )
}

const questionLabel = (question: BridgeAgentRequest['questions'][number]) =>
  question.header ? `${question.header}: ${question.prompt}` : question.prompt
