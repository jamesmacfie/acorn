import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import type { BridgeAgentRequest, BridgePendingRequest, BridgeSessionRead } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import Popover from '@acorn/client-core/kit/components/overlays'
import { Button, CodeBlock, Row } from '@acorn/client-core/kit/components/primitives.tsx'
import type { BridgeClient } from './bridgeClient'
import { ChoiceButtons, createAnswer, optionChoices, type Choice } from './Requests'

// How long a row answered here shows its result before the next pending list may drop it.
const SETTLED_MS = 1_500

const keyOf = (request: BridgePendingRequest) => `${request.sessionId} ${request.requestId}`

type ListProps = {
  client: BridgeClient
  nodeId: string
  requests: readonly BridgePendingRequest[]
  online: boolean
  openConversation(taskId: string, sessionId: string): void
}

// The top bar's amber Needs you button, with the count, while an agent waits. It opens the same list
// as Home's. Kept on screen while its popover is open, so the popover can say nothing waits.
export function NeedsYouButton(props: ListProps) {
  return (
    <Popover
      placement="bottom-end"
      role="dialog"
      ariaLabel="Needs you"
      trigger={(state) => (
        <Show when={props.requests.length || state.open()}>
          <button
            type="button"
            class="needs-you-button"
            aria-label="Needs you"
            aria-haspopup="dialog"
            aria-expanded={state.open()}
            onClick={() => state.toggle()}
          >
            <Icon name="circle-alert" />
            {props.requests.length}
          </button>
        </Show>
      )}
    >
      {({ close }) => (
        <div class="needs-you-popover">
          <NeedsYou
            {...props}
            emptyText="Nothing waits on you."
            openConversation={(taskId, sessionId) => {
              close()
              props.openConversation(taskId, sessionId)
            }}
          />
        </div>
      )}
    </Popover>
  )
}

// Every request the Node's agents wait on, as compact rows, answered in place when the answer is a
// button and opened in its conversation otherwise. docs/browser-extension/notifications.md.
export function NeedsYou(
  props: ListProps & {
    // What to say when nothing waits. Without it the list draws nothing then.
    emptyText?: string
    // The list sits in its task, so its rows leave the task's title out.
    inTask?: boolean
  },
) {
  // Each waiting conversation, read whenever the pending list changes: its title, and its requests'
  // details and buttons, which the pending list leaves out.
  const [reads, setReads] = createSignal<Record<string, BridgeSessionRead>>({})
  const read = async (sessionId: string) => {
    try {
      // Only the requests: no event is past the end, so the page carries none.
      const page = await props.client.call({
        op: 'session.read',
        nodeId: props.nodeId,
        sessionId,
        afterSeq: Number.MAX_SAFE_INTEGER,
        limit: 1,
      })
      setReads((current) => ({ ...current, [sessionId]: page }))
    } catch {
      // The row still names the request, and a click opens its conversation.
    }
  }
  createEffect(
    on(
      () => props.requests.map(keyOf).join(),
      () => new Set(props.requests.map((request) => request.sessionId)).forEach((sessionId) => void read(sessionId)),
    ),
  )

  // A row answered here keeps its result on screen for a moment, even when the next pending list
  // drops the request first.
  const [held, setHeld] = createSignal<BridgePendingRequest[]>([])
  const timers = new Set<ReturnType<typeof setTimeout>>()
  onCleanup(() => timers.forEach(clearTimeout))
  const hold = (request: BridgePendingRequest) => {
    setHeld((current) => [...current, request])
    const timer = setTimeout(() => {
      timers.delete(timer)
      setHeld((current) => current.filter((kept) => kept !== request))
    }, SETTLED_MS)
    timers.add(timer)
  }
  const byKey = createMemo(() => new Map([...held(), ...props.requests].map((request) => [keyOf(request), request])))
  // Rows keep their place as requests come and go, and a new one joins at the end.
  const shown = createMemo<string[]>((previous) => {
    const kept = previous.filter((key) => byKey().has(key))
    return [...kept, ...props.requests.map(keyOf).filter((key) => !kept.includes(key))]
  }, [])

  return (
    <Show when={shown().length || props.emptyText}>
      <section class="needs-you" aria-label="Needs you">
        <div class="section-head">
          <h2>
            Needs you <span class="needs-you-count">{props.requests.length}</span>
          </h2>
        </div>
        <Show when={shown().length} fallback={<p class="quiet">{props.emptyText}</p>}>
          <ul class="task-rows">
            <For each={shown()}>
              {(key) => {
                const pending = byKey().get(key)!
                return (
                  <NeedsYouRow
                    client={props.client}
                    nodeId={props.nodeId}
                    pending={pending}
                    read={reads()[pending.sessionId]}
                    inTask={props.inTask ?? false}
                    online={props.online}
                    open={() => props.openConversation(pending.taskId, pending.sessionId)}
                    answered={() => hold(pending)}
                    reread={() => void read(pending.sessionId)}
                  />
                )
              }}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  )
}

// The buttons a row answers with in place: a request's own options, or the choices of its one
// single-choice question. Null for anything else, a form, app access, or one the sidebar can't answer,
// which the row opens in its conversation instead.
function rowChoices(request: BridgeAgentRequest): Choice[] | null {
  if (request.status !== 'pending' || request.unsupported || request.approval) return null
  const [question, ...more] = request.questions
  if (!question) return request.options.length ? optionChoices(request) : null
  if (more.length || question.multiple || question.secret || !question.options.length) return null
  return [
    ...question.options.map((option) => ({
      label: option.label,
      reject: false,
      resolution: { answers: { [question.id]: option.label } },
    })),
    ...optionChoices(request),
  ]
}

// What a settled row says: a permission in the past tense, such as "Allowed once" or "Denied", and any
// other answer as itself. `answer` is the button's label, the Node's or the one pressed here.
function settledText(request: BridgeAgentRequest, answer: string | null): string {
  if (request.status === 'expired') return 'Expired'
  if (!answer) return 'Answered'
  if (request.kind === 'permission') {
    if (request.options.find((option) => option.label === answer)?.reject) return 'Denied'
    if (/\ballow\b/i.test(answer)) return answer.replace(/\ballow\b/i, (word) => `${word}ed`)
  }
  return `Answered: ${answer}`
}

const kindIcon = (kind: string) => (kind === 'permission' ? 'shield' : 'message-circle-question-mark')

// One request: collapsed, expanded with its buttons, or settled with its result. A row it can't answer
// in place opens its conversation instead of expanding.
function NeedsYouRow(props: {
  client: BridgeClient
  nodeId: string
  pending: BridgePendingRequest
  // Its conversation, once read.
  read: BridgeSessionRead | undefined
  inTask: boolean
  online: boolean
  open(): void
  answered(): void
  reread(): void
}) {
  const request = () => props.read?.requests.find((row) => row.requestId === props.pending.requestId)
  const choices = createMemo(() => {
    const full = request()
    return full ? rowChoices(full) : null
  })
  const [expanded, setExpanded] = createSignal(false)
  // The result of an answer sent from this row.
  const [result, setResult] = createSignal<string | null>(null)
  const settled = () => {
    const full = request()
    return result() ?? (full && full.status !== 'pending' ? settledText(full, full.answer) : null)
  }
  const meta = () => [props.read?.session.title, !props.inTask && props.pending.taskTitle].filter(Boolean).join(' · ')

  return (
    <li>
      <Show
        when={settled()}
        fallback={
          <>
            <Row
              variant="stacked"
              onPress={() => (choices() ? setExpanded((open) => !open) : props.open())}
              leading={<Icon name="circle-alert" tone="warn" />}
              trailing={
                <>
                  <Icon name={kindIcon(props.pending.kind)} tone="muted" />
                  <Icon name={!choices() ? 'chevron-right' : expanded() ? 'chevron-up' : 'chevron-down'} tone="muted" />
                </>
              }
            >
              <strong class="row-title">{props.pending.title}</strong>
              <span class="row-meta">{meta()}</span>
            </Row>
            <Show when={expanded() && request()}>
              {(full) => (
                <RowAnswer
                  client={props.client}
                  target={{ nodeId: props.nodeId, taskId: props.pending.taskId, sessionId: props.pending.sessionId }}
                  request={full()}
                  choices={choices() ?? []}
                  online={props.online}
                  open={props.open}
                  reread={props.reread}
                  answered={(settledRequest, choice) => {
                    setResult(settledText(settledRequest, settledRequest.answer ?? choice.label))
                    props.answered()
                  }}
                />
              )}
            </Show>
          </>
        }
      >
        {(text) => (
          <Row variant="stacked" leading={<Icon name="circle-check" tone="ok" />}>
            <span class="row-title quiet">{text()}</span>
            <span class="row-meta">{props.pending.title}</span>
          </Row>
        )}
      </Show>
    </li>
  )
}

// An expanded row: the request's detail, its buttons, and Open chat at the far end.
function RowAnswer(props: {
  client: BridgeClient
  target: { nodeId: string; taskId: string; sessionId: string }
  request: BridgeAgentRequest
  choices: readonly Choice[]
  online: boolean
  open(): void
  reread(): void
  answered(request: BridgeAgentRequest, choice: Choice): void
}) {
  const reply = createAnswer({
    client: props.client,
    target: props.target,
    request: () => props.request,
    online: () => props.online,
    settled: () => props.reread(),
  })
  const choose = async (choice: Choice) => {
    const settledRequest = await reply.send(choice.resolution)
    if (settledRequest) props.answered(settledRequest, choice)
  }
  const question = () => props.request.questions[0]?.prompt
  return (
    <div class="row-answer">
      <Show when={props.request.detail}>
        {(detail) => (
          <CodeBlock wrap maxHeight="block">
            {detail()}
          </CodeBlock>
        )}
      </Show>
      <Show when={question()}>{(prompt) => <p>{prompt()}</p>}</Show>
      <ChoiceButtons choices={props.choices} disabled={reply.disabled()} choose={(choice) => void choose(choice)}>
        <span class="grow" />
        <Button variant="bare" size="sm" onPress={() => props.open()}>
          Open chat
        </Button>
      </ChoiceButtons>
      <Show when={!props.online}>
        <p class="notice">The Node is not connected. Answer once it is.</p>
      </Show>
      <Show when={reply.note()}>{(note) => <p class="notice">{note()}</p>}</Show>
    </div>
  )
}
