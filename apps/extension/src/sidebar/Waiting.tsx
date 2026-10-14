import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { BridgeAgentRequest, BridgePendingRequest } from '@acorn/protocol/extensionBridge.ts'
import type { BridgeClient } from './bridgeClient'
import { Requests } from './Requests'

// Every request the Node's agents are waiting on, across its projects, answered in place with the
// same cards the conversation draws. Shown only while something waits. docs/browser-extension/notifications.md.
export function Waiting(props: {
  client: BridgeClient
  nodeId: string
  requests: readonly BridgePendingRequest[]
  online: boolean
  open(request: BridgePendingRequest): void
}) {
  // One group per conversation, in the order its first request arrived.
  const sessions = createMemo(() => [...new Set(props.requests.map((request) => request.sessionId))])
  const waitingIn = (sessionId: string) => props.requests.filter((request) => request.sessionId === sessionId)

  return (
    <Show when={props.requests.length}>
      <section aria-label="Waiting for you">
        <h2>Waiting for you</h2>
        <For each={sessions()}>
          {(sessionId) => (
            <WaitingConversation
              client={props.client}
              nodeId={props.nodeId}
              requests={waitingIn(sessionId)}
              online={props.online}
              open={props.open}
            />
          )}
        </For>
      </section>
    </Show>
  )
}

// One conversation's waiting requests. The pending list names them without their buttons or
// questions, so the conversation's own requests are read whenever the list changes.
function WaitingConversation(props: {
  client: BridgeClient
  nodeId: string
  requests: readonly BridgePendingRequest[]
  online: boolean
  open(request: BridgePendingRequest): void
}) {
  // Every request in the group shares its conversation and task.
  const head = props.requests[0]!
  const target = { nodeId: props.nodeId, taskId: head.taskId, sessionId: head.sessionId }
  const [requests, setRequests] = createSignal<BridgeAgentRequest[]>([])
  const read = async () => {
    try {
      // Only the requests: no event is past the end, so the page carries none.
      const page = await props.client.call({
        op: 'session.read',
        nodeId: target.nodeId,
        sessionId: target.sessionId,
        afterSeq: Number.MAX_SAFE_INTEGER,
        limit: 1,
      })
      setRequests(page.requests)
    } catch {
      // The row still names the request, and Open reaches it in its conversation.
    }
  }
  createEffect(
    on(
      () => props.requests.map((request) => request.requestId).join(),
      () => void read(),
    ),
  )

  return (
    <div class="waiting">
      <div class="row">
        <span class="quiet grow">{head.taskTitle}</span>
        <button type="button" class="link" onClick={() => props.open(head)}>
          Open
        </button>
      </div>
      <Show
        when={requests().length}
        fallback={<For each={props.requests}>{(request) => <p data-testid="waiting-title">{request.title}</p>}</For>}
      >
        <Requests client={props.client} target={target} requests={requests()} online={props.online} settled={read} />
      </Show>
    </div>
  )
}
