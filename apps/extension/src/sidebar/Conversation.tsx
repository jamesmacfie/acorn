import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { TURN_TEXT_MAX_CHARS, type BridgeAgentHint } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { conversationItems, conversationReader, type ConversationWindow } from './conversationWindow'
import { errorGuidance } from './guidance'
import { acknowledgeDraft, loadDraft, saveDraft, type Draft, type DraftTarget } from './localState'

// Failures after which a write may or may not have reached the Node.
const UNCERTAIN = new Set(['ambiguous_mutation', 'host_unavailable', 'node_unreachable'])

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
}) {
  const target = props.target
  const [view, setView] = createSignal<ConversationWindow | null>(null)
  const [readError, setReadError] = createSignal<CallFailure | null>(null)
  const [text, setText] = createSignal('')
  const [pending, setPending] = createSignal<Draft['pending']>()
  const [sending, setSending] = createSignal(false)
  const [sendNote, setSendNote] = createSignal<string | null>(null)
  let mounted = true
  let typed = false

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
    mounted = false
    reader.dispose()
  })

  onMount(() => {
    void reader.refresh()
    // A draft typed before storage answered wins over the stored one.
    void loadDraft(props.storage, target).then((draft) => {
      if (!mounted || typed) return
      setText(draft.text)
      setPending(draft.pending)
    })
  })
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

  const persist = () => void saveDraft(props.storage, target, { text: text(), pending: pending() })
  const edit = (value: string) => {
    typed = true
    setText(value)
    setSendNote(null)
    persist()
  }

  const session = () => view()?.session ?? null
  const gone = () => readError()?.code === 'not_found'
  const blocked = (): string | null => {
    if (gone()) return 'This conversation is no longer on the Node. Your draft is kept.'
    if (session()?.archivedAt) return 'This conversation is archived, so it takes no new messages. Your draft is kept.'
    if (!props.online) return 'The Node is not connected. Your draft is kept until it is.'
    return null
  }
  const retrying = () => pending()?.text === text().trim()

  const send = async (event: SubmitEvent) => {
    event.preventDefault()
    const message = text().trim()
    if (!message || sending() || blocked()) return
    // The same text as an unconfirmed send goes with that send's key, so the Node makes at most one turn.
    const key = pending()?.text === message ? pending()!.key : crypto.randomUUID()
    setPending({ key, text: message })
    persist()
    setSending(true)
    setSendNote(null)
    try {
      await props.client.call({
        op: 'turn.submit',
        nodeId: target.nodeId,
        sessionId: target.sessionId,
        text: message,
        key,
      })
      if (mounted) {
        if (text().trim() === message) setText('')
        setPending(undefined)
        await saveDraft(props.storage, target, { text: text() })
      } else await acknowledgeDraft(props.storage, target, message)
    } catch (error) {
      const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
      if (UNCERTAIN.has(failure.code))
        setSendNote(
          "The Node didn't confirm this message, so it may have arrived. The conversation was read again; if the message isn't there, Retry sends it once, never twice.",
        )
      else if (failure.code === 'not_selected') setSendNote('That Node is no longer selected, so nothing was sent.')
      else setSendNote(errorGuidance(failure))
    } finally {
      setSending(false)
      void reader.refresh()
    }
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
      <Show when={session()?.attention === 'permission' || session()?.attention === 'question'}>
        <p class="notice">The agent is waiting for an answer. Answer it in the Acorn app for now.</p>
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
                    <p>{item.text}</p>
                  </li>
                )
              }
            </For>
            <For each={view()!.queued}>
              {(turn) => (
                <li class="you queued">
                  <strong>You · queued</strong>
                  <p>{turn.text}</p>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </Show>
      <form onSubmit={(event) => void send(event)}>
        <textarea
          name="message"
          rows={3}
          maxLength={TURN_TEXT_MAX_CHARS}
          placeholder="Message the agent"
          value={text()}
          onInput={(event) => edit(event.currentTarget.value)}
        />
        <Show when={blocked() ?? sendNote()}>{(note) => <p class="notice">{note()}</p>}</Show>
        <button type="submit" disabled={sending() || !text().trim() || blocked() !== null}>
          {sending() ? 'Sending…' : retrying() ? 'Retry' : 'Send'}
        </button>
      </form>
    </section>
  )
}
