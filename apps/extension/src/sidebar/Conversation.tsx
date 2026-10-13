import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { BridgeAgentHint, BridgeAgentSession, BridgeAttachmentRef } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { CallFailure } from '../messages'
import { attachmentPreviews } from './attachmentPreviews'
import type { BridgeClient } from './bridgeClient'
import type { CaptureKind, PageCapture } from './capture'
import { Composer } from './Composer'
import { conversationItems, conversationReader, type ConversationWindow } from './conversationWindow'
import { errorGuidance } from './guidance'
import type { DraftTarget } from './localState'
import { Requests } from './Requests'
import { State, agentName, agentState } from './state'

// One conversation: a window of its messages and tool calls, and a composer whose draft belongs to
// this conversation alone. The parent mounts one per session, so every reply and write here is bound
// to `target` and can't reach another conversation.
export function Conversation(props: {
  client: BridgeClient
  storage: BrowserApi['storage']['local']
  target: DraftTarget
  // The conversation's row as its task's list read it, until the conversation's own read arrives.
  session: BridgeAgentSession
  taskTitle: string
  back(): void
  online: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  capture(kind: CaptureKind): Promise<PageCapture>
}) {
  const target = props.target
  const listed = props.session
  const [view, setView] = createSignal<ConversationWindow | null>(null)
  const [readError, setReadError] = createSignal<CallFailure | null>(null)
  const previews = attachmentPreviews((attachmentId) =>
    props.client.call({ op: 'attachment.read', nodeId: target.nodeId, taskId: target.taskId, attachmentId }),
  )

  const reader = conversationReader({
    read: (afterSeq, limit) =>
      props.client.call({ op: 'session.read', nodeId: target.nodeId, sessionId: target.sessionId, afterSeq, limit }),
    lastEventSeq: listed.lastEventSeq,
    changed: (next) => {
      setReadError(null)
      setView(next)
    },
    failed: (error) =>
      setReadError(error instanceof CallFailure ? error : new CallFailure('node_error', String(error))),
  })
  onCleanup(() => {
    reader.dispose()
    previews.dispose()
  })

  onMount(() => void reader.refresh())
  createEffect(
    on(
      () => props.hint,
      (hint) => {
        if (hint && hint.nodeId === target.nodeId && (hint.missed || hint.sessions.includes(target.sessionId)))
          void reader.refresh()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.reconnects,
      () => void reader.refresh(),
      { defer: true },
    ),
  )

  const session = () => view()?.session ?? listed
  const gone = () => readError()?.code === 'not_found'
  const blocked = (): string | null => {
    if (gone()) return 'This conversation is no longer on the Node. Your draft is kept.'
    if (session().archivedAt) return 'This conversation is archived, so it takes no new messages. Your draft is kept.'
    if (!props.online) return 'The Node is not connected. Your draft is kept until it is.'
    return null
  }
  const items = createMemo(() => conversationItems(view()?.records ?? []))
  const state = () =>
    agentState(
      session(),
      (view()?.requests ?? []).some((request) => request.status === 'pending'),
    )

  return (
    <div class="view conversation" aria-label="Conversation">
      {/* Where a message goes: the task, then the conversation. */}
      <div data-testid="destination">
        <div class="view-head">
          <button type="button" class="icon" aria-label="Back" onClick={() => props.back()}>
            ‹
          </button>
          <span class="title">{props.taskTitle}</span>
        </div>
        <div class="subhead">
          <span class="grow">
            {agentName(session())} · {session().title}
          </span>
          <State tone={state().tone}>{state().label}</State>
        </div>
      </div>
      <div class="conversation-body">
        <Show when={readError() && !gone()}>
          <p class="problem" role="alert">
            {errorGuidance(readError()!)}
          </p>
        </Show>
        <Show when={(view()?.from ?? 0) > 0}>
          <button type="button" class="quiet" onClick={() => void reader.earlier()}>
            Earlier messages
          </button>
        </Show>
        <Show when={view()} fallback={<p class="quiet">{gone() ? '' : 'Loading the conversation…'}</p>}>
          <Show when={items().length || view()!.queued.length} fallback={<p class="quiet">No messages yet.</p>}>
            <ol class="transcript">
              <For each={items()}>
                {(item) =>
                  item.kind === 'tool' ? (
                    <li class="tool">
                      {item.title}
                      <Show when={item.status}>{(status) => <span class="quiet"> · {status()}</span>}</Show>
                    </li>
                  ) : (
                    <li class={item.kind}>
                      <strong>{item.kind === 'you' ? 'You' : item.kind === 'agent' ? 'Agent' : 'Error'}</strong>
                      <Show when={item.text}>
                        <p>{item.text}</p>
                      </Show>
                      <Show when={item.kind === 'you' && item.attachments}>
                        {(attachments) => <Attachments attachments={attachments()} url={previews.url} />}
                      </Show>
                    </li>
                  )
                }
              </For>
              <For each={view()!.queued}>
                {(turn) => (
                  <li class="you queued">
                    <strong>You · queued</strong>
                    <Show when={turn.text}>
                      <p>{turn.text}</p>
                    </Show>
                    <Attachments attachments={turn.attachments} url={previews.url} />
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </Show>
        <Requests
          client={props.client}
          target={target}
          requests={view()?.requests ?? []}
          online={props.online && !gone()}
          settled={() => void reader.refresh()}
        />
      </div>
      <Composer
        client={props.client}
        storage={props.storage}
        target={target}
        destination={`${session().title} in ${props.taskTitle}`}
        capture={props.capture}
        blocked={blocked()}
        settled={() => void reader.refresh()}
      />
    </div>
  )
}

// The attachments a turn sent: a picture for each screenshot, read through the bridge, and the name of
// anything else.
function Attachments(props: { attachments: BridgeAttachmentRef[]; url(attachmentId: string): Promise<string | null> }) {
  return (
    <Show when={props.attachments.length}>
      <div class="attachments">
        <For each={props.attachments}>
          {(attachment) => {
            const [url, setUrl] = createSignal<string | null>(null)
            if (attachment.image) void props.url(attachment.id).then(setUrl)
            return (
              <Show when={url()} fallback={<span class="quiet">{attachment.name ?? 'Attachment'}</span>}>
                {(source) => <img src={source()} alt={attachment.name ?? 'Screenshot'} />}
              </Show>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
