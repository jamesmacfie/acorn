import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js'
import type { BridgeAgentHint, BridgeAgentSession, BridgeAttachmentRef } from '@acorn/protocol/extensionBridge.ts'
import { Text } from '@acorn/client-core/kit/components/content'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Fold, Inline, Stack } from '@acorn/client-core/kit/components/layout'
import { Button, Card, Chip } from '@acorn/client-core/kit/components/primitives.tsx'
import { renderMarkdown } from '@acorn/client-core/kit/lib/markdown'
import { runtimeIcon, runtimeTone } from '@acorn/plugin-agents/contract/runtimeState.ts'
import type { BrowserApi } from '../browser'
import { CallFailure } from '../messages'
import { attachmentPreviews } from './attachmentPreviews'
import type { BridgeClient } from './bridgeClient'
import { Composer } from './Composer'
import { conversationItems, conversationReader, type ConversationWindow, type ToolLine } from './conversationWindow'
import { errorGuidance } from './guidance'
import type { DraftTarget } from '../localState'
import { Requests } from './Requests'
import { agentName, toolMark } from './state'

// How near the bottom of the page still counts as reading the newest message.
const FOLLOW_SLACK_PX = 40

// The panel's page is the scroller. Like the desktop's transcript, a conversation opens on its newest
// message and keeps it in view as messages arrive and the composer grows, until the reader scrolls up.
// Scrolling back to the bottom follows again.
function followNewest(element: HTMLElement): void {
  const page = document.scrollingElement ?? document.documentElement
  let following = true
  const pin = () => {
    if (following) page.scrollTop = page.scrollHeight
  }
  const scrolled = () => {
    following = page.scrollHeight - page.scrollTop - page.clientHeight <= FOLLOW_SLACK_PX
  }
  const resized = new ResizeObserver(pin)
  resized.observe(element)
  addEventListener('scroll', scrolled, { passive: true })
  onCleanup(() => {
    resized.disconnect()
    removeEventListener('scroll', scrolled)
  })
}

// One conversation: a window of its messages and tool calls, and a composer whose draft belongs to
// this conversation alone. The parent mounts one per session, so every reply and write here is bound
// to `target` and can't reach another conversation.
export function Conversation(props: {
  client: BridgeClient
  storage: BrowserApi['storage']
  target: DraftTarget
  // The conversation's row as its task's list read it, until the conversation's own read arrives.
  session: BridgeAgentSession
  // The person just started it, so the message box takes the cursor.
  focused?: boolean
  online: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  // Which of its tool runs are open, by key, and the toggle. The panel keeps these while it's open.
  folds: Record<string, boolean>
  fold(key: string, open: boolean): void
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
    if (session().archivedAt) return 'This conversation is archived. Your draft is kept.'
    if (!props.online) return 'Offline. Your draft is kept.'
    return null
  }
  const items = createMemo(() => conversationItems(view()?.records ?? []))
  // One of the Node's waiting requests is this conversation's, which says more than the runtime state:
  // an agent can be working while a subagent waits on the person.
  const waiting = () =>
    session().runtimeState === 'waiting' || (view()?.requests ?? []).some((request) => request.status === 'pending')
  const working = () => !waiting() && session().runtimeState === 'working'
  const foldKey = (runKey: string) => `${target.sessionId}:${runKey}`

  const [stopping, setStopping] = createSignal(false)
  const [stopProblem, setStopProblem] = createSignal<string | null>(null)
  const stop = async () => {
    setStopping(true)
    setStopProblem(null)
    try {
      await props.client.call({
        op: 'session.cancel',
        nodeId: target.nodeId,
        sessionId: target.sessionId,
        key: crypto.randomUUID(),
      })
    } catch (error) {
      setStopProblem(errorGuidance(error instanceof CallFailure ? error : new CallFailure('node_error', String(error))))
    } finally {
      setStopping(false)
      void reader.refresh()
    }
  }

  return (
    <div class="view conversation" aria-label="Conversation" ref={followNewest}>
      <div class="conversation-body">
        <Show when={readError() && !gone()}>
          <p class="problem" role="alert">
            {errorGuidance(readError()!)}
          </p>
        </Show>
        <Show when={(view()?.from ?? 0) > 0}>
          <Button label="Earlier messages" onPress={() => void reader.earlier()} />
        </Show>
        <Show when={view()} fallback={<p class="quiet">{gone() ? '' : 'Loading the conversation…'}</p>}>
          <Show when={items().length || view()!.queued.length} fallback={<p class="quiet">No messages yet.</p>}>
            <ol class="transcript">
              <For each={items()}>
                {(item) => {
                  if (item.kind === 'tool') return <ToolLineItem line={item} />
                  if (item.kind === 'tools')
                    return (
                      <li>
                        <ToolRun
                          lines={item.lines}
                          open={props.folds[foldKey(item.key)] ?? false}
                          toggle={(open) => props.fold(foldKey(item.key), open)}
                        />
                      </li>
                    )
                  if (item.kind === 'error')
                    return (
                      <li>
                        <Message stripe="danger" label="Error">
                          <p class="error-text">{item.text}</p>
                        </Message>
                      </li>
                    )
                  if (item.kind === 'agent')
                    return (
                      <li>
                        <Message stripe="ok" label={agentName(session())} at={item.at}>
                          <Markdown text={item.text} />
                        </Message>
                      </li>
                    )
                  return (
                    <li>
                      <Message stripe="accent" label={item.workflow ? 'Workflow' : 'You'} at={item.at}>
                        <Show when={item.text}>
                          <Markdown text={item.text} />
                        </Show>
                        <Attachments attachments={item.attachments} url={previews.url} />
                      </Message>
                    </li>
                  )
                }}
              </For>
              <For each={view()!.queued}>
                {(turn) => (
                  <li>
                    <Message stripe="accent" label="You" note="Queued">
                      <Show when={turn.text}>
                        <Markdown text={turn.text} />
                      </Show>
                      <Attachments attachments={turn.attachments} url={previews.url} />
                    </Message>
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
        blocked={blocked()}
        focused={props.focused ?? false}
        settled={() => void reader.refresh()}
        activity={
          <>
            <Show when={working()}>
              <div class="activity">
                <Icon name={runtimeIcon('working')} tone={runtimeTone('working')} spin />
                <span class="grow">Working</span>
                <Button
                  variant="ghost"
                  size="sm"
                  busy={stopping()}
                  disabled={!props.online || gone()}
                  onPress={() => void stop()}
                >
                  <Icon name="square" />
                  Stop
                </Button>
              </div>
            </Show>
            <Show when={waiting()}>
              <div class="activity">
                <Icon name={runtimeIcon('waiting')} tone={runtimeTone('waiting')} />
                <Text tone="warn">Waiting for you</Text>
              </div>
            </Show>
            <Show when={stopProblem()}>
              {(problem) => (
                <p class="problem" role="alert">
                  {problem()}
                </p>
              )}
            </Show>
          </>
        }
      />
    </div>
  )
}

// A transcript card, as the desktop's: a stripe for who it's from, an eyebrow with the speaker and the
// time, then the content.
function Message(props: {
  stripe: 'accent' | 'ok' | 'danger'
  label: string
  // When the Node recorded it, or a word in place of the time.
  at?: number
  note?: string
  children: JSX.Element
}) {
  const time = () =>
    props.at === undefined
      ? props.note
      : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(props.at)
  return (
    <Card pad="sm" stripe={props.stripe}>
      <Stack gap="row">
        <Inline>
          <Text emphasis="eyebrow">{props.label}</Text>
          <Show when={time()}>{(shown) => <Text emphasis="eyebrow">{shown()}</Text>}</Show>
        </Inline>
        {props.children}
      </Stack>
    </Card>
  )
}

// One tool call: its state as a mark, its title, and any state but done in words.
function ToolLineItem(props: { line: ToolLine }) {
  const status = () => props.line.status
  return (
    <li class="tool">
      <Icon
        name={toolMark(status()).icon}
        tone={toolMark(status()).tone}
        spin={status() === 'running'}
        title={status() ?? 'unknown'}
      />
      <span>
        {props.line.title}
        <Show when={status() !== 'completed' && status()}>
          {(shown) => <Text tone={shown() === 'failed' ? 'danger' : 'muted'}> · {shown()}</Text>}
        </Show>
      </span>
    </li>
  )
}

// A run of tool calls as one fold. A failed call stays in view under the closed fold, so a failure is
// never hidden behind a count.
function ToolRun(props: { lines: ToolLine[]; open: boolean; toggle(open: boolean): void }) {
  const failed = () => props.lines.filter((line) => line.status === 'failed')
  return (
    <>
      <Fold
        level="sub"
        label={`${props.lines.length} tool calls`}
        meta={
          <Show when={failed().length}>
            <Text tone="danger">· {failed().length} failed</Text>
          </Show>
        }
        open={props.open}
        onOpenChange={props.toggle}
      >
        <ol class="tool-lines">
          <For each={props.lines}>{(line) => <ToolLineItem line={line} />}</For>
        </ol>
      </Fold>
      <Show when={!props.open && failed().length}>
        <ol class="tool-lines">
          <For each={failed()}>{(line) => <ToolLineItem line={line} />}</For>
        </ol>
      </Show>
    </>
  )
}

// A message as the desktop renders it: the shared renderer's escaped and sanitized HTML. A remote image
// shows as its alt text, so a message can't make the browser fetch an address it names.
function Markdown(props: { text: string }) {
  return <div class="ui-markdown" innerHTML={renderMarkdown(props.text, { images: 'placeholder' })} />
}

// The attachments a turn sent, as chips: a screenshot shows its picture, read through the bridge.
function Attachments(props: { attachments: BridgeAttachmentRef[]; url(attachmentId: string): Promise<string | null> }) {
  return (
    <Show when={props.attachments.length}>
      <div class="attachments">
        <For each={props.attachments}>
          {(attachment) => {
            const [url, setUrl] = createSignal<string | null>(null)
            if (attachment.image) void props.url(attachment.id).then(setUrl)
            const name = attachment.name ?? (attachment.image ? 'Screenshot' : 'Attachment')
            return (
              <Chip
                leading={
                  <Show when={url()} fallback={<Icon name={attachment.image ? 'image' : 'paperclip'} tone="muted" />}>
                    {(source) => <img class="thumb" src={source()} alt={name} />}
                  </Show>
                }
              >
                {name}
              </Chip>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
