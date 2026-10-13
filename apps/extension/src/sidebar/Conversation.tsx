import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { BridgeAgentHint, BridgeAttachmentRef } from '@acorn/protocol/extensionBridge.ts'
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

const STATE_LABELS: Record<string, string> = {
  creating: 'Starting',
  connecting: 'Starting',
  replaying: 'Starting',
  ready: 'Ready',
  working: 'Working',
  waiting: 'Waiting for an answer',
  cancelling: 'Stopping',
  reconnecting: 'Reconnecting',
  stopped: 'Stopped',
  failed: 'Failed',
  archived: 'Archived',
}

// One conversation: a window of its messages and tool calls, and a composer whose draft belongs to
// this conversation alone. The parent mounts one per session, so every reply and write here is bound
// to `target` and can't reach another conversation.
export function Conversation(props: {
  client: BridgeClient
  storage: BrowserApi['storage']['local']
  target: DraftTarget
  lastEventSeq: number
  // Where a message goes, named in full above the composer.
  destination: string
  online: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  capture(kind: CaptureKind): Promise<PageCapture>
}) {
  const target = props.target
  const [view, setView] = createSignal<ConversationWindow | null>(null)
  const [readError, setReadError] = createSignal<CallFailure | null>(null)
  const previews = attachmentPreviews((attachmentId) =>
    props.client.call({ op: 'attachment.read', nodeId: target.nodeId, taskId: target.taskId, attachmentId }),
  )

  const reader = conversationReader({
    read: (afterSeq, limit) =>
      props.client.call({ op: 'session.read', nodeId: target.nodeId, sessionId: target.sessionId, afterSeq, limit }),
    lastEventSeq: props.lastEventSeq,
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

  const session = () => view()?.session ?? null
  const gone = () => readError()?.code === 'not_found'
  const blocked = (): string | null => {
    if (gone()) return 'This conversation is no longer on the Node. Your draft is kept.'
    if (session()?.archivedAt) return 'This conversation is archived, so it takes no new messages. Your draft is kept.'
    if (!props.online) return 'The Node is not connected. Your draft is kept until it is.'
    return null
  }
  const items = createMemo(() => conversationItems(view()?.records ?? []))

  return (
    <section class="card conversation" aria-label="Conversation">
      <p class="quiet destination" data-testid="destination">
        {props.destination}
        <Show when={session()}>
          {(current) => <span> · {STATE_LABELS[current().runtimeState] ?? current().runtimeState}</span>}
        </Show>
      </p>
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
      <Composer
        client={props.client}
        storage={props.storage}
        target={target}
        destination={props.destination}
        capture={props.capture}
        blocked={blocked()}
        settled={() => void reader.refresh()}
      />
    </section>
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
