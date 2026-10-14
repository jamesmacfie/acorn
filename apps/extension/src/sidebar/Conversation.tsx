import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { BridgeAgentHint, BridgeAgentSession, BridgeAttachmentRef } from '@acorn/protocol/extensionBridge.ts'
import { renderMarkdown } from '@acorn/client-core/kit/lib/markdown'
import type { BrowserApi } from '../browser'
import { CallFailure } from '../messages'
import { conversationLink } from '../acornLinks'
import { CopyAcornLink, OpenInAcorn } from './OpenInAcorn'
import { attachmentPreviews } from './attachmentPreviews'
import type { BridgeClient } from './bridgeClient'
import type { CaptureKind, PageCapture } from '../capture'
import { Composer } from './Composer'
import { conversationItems, conversationReader, type ConversationWindow } from './conversationWindow'
import { errorGuidance } from './guidance'
import type { DraftTarget } from '../localState'
import { Requests } from './Requests'
import { State, agentName, agentState, toolTone } from './state'

// One conversation: a window of its messages and tool calls, and a composer whose draft belongs to
// this conversation alone. The parent mounts one per session, so every reply and write here is bound
// to `target` and can't reach another conversation.
export function Conversation(props: {
  client: BridgeClient
  storage: BrowserApi['storage']
  target: DraftTarget
  // The conversation's row as its task's list read it, until the conversation's own read arrives.
  session: BridgeAgentSession
  taskTitle: string
  back(): void
  online: boolean
  // Whether Open in Acorn may open the desktop app, or copies its link.
  opensLinks: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  capture(kind: CaptureKind): Promise<PageCapture>
}) {
  const target = props.target
  const listed = props.session
  const link = conversationLink(target.nodeId, target.taskId, target.sessionId)
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
          <span class="title grow">{props.taskTitle}</span>
          <OpenInAcorn href={link} opensLinks={props.opensLinks} class="link" />
          <Show when={props.opensLinks && link}>{(href) => <CopyAcornLink href={href()} class="link" />}</Show>
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
                      <span class="dot" data-tone={toolTone(item.status)} role="img" aria-label={item.status ?? 'unknown'} />
                      <span>
                        {item.title}
                        {/* The dot says done on its own; any other state is written out too. */}
                        <Show when={item.status !== 'completed' && item.status}>
                          {(status) => <span class="quiet"> · {status()}</span>}
                        </Show>
                      </span>
                    </li>
                  ) : (
                    <li class={item.kind}>
                      <strong>{item.kind === 'you' ? 'You' : item.kind === 'agent' ? 'Agent' : 'Error'}</strong>
                      <Show when={item.text}>
                        <Show when={item.kind !== 'error'} fallback={<p>{item.text}</p>}>
                          <Markdown text={item.text} />
                        </Show>
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
                      <Markdown text={turn.text} />
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

// A message as the desktop renders it: the shared renderer's escaped and sanitized HTML. A remote image
// shows as its alt text, so a message can't make the browser fetch an address it names.
function Markdown(props: { text: string }) {
  return <div class="ui-markdown" innerHTML={renderMarkdown(props.text, { images: 'placeholder' })} />
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
