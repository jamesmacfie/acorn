import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { TURN_TEXT_MAX_CHARS } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi } from '../browser'
import { CallFailure, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { CaptureFailure, screenshotData, turnInput, withCapture, type CaptureKind, type PageCapture } from '../capture'
import { errorGuidance } from './guidance'
import { acknowledged, changeDraft, loadDraft, saveDraft, type Draft, type DraftTarget } from '../localState'

const CAPTURE_LABELS: Record<CaptureKind, string> = {
  link: 'Add page link to chat',
  selection: 'Add selected text to chat',
  screenshot: 'Add screenshot to chat',
}

// Lucide's link, text-cursor, and camera glyphs, drawn in the text colour.
// Functions, so each composer draws its own nodes.
const CAPTURE_ICONS: Record<CaptureKind, () => JSX.Element> = {
  link: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  selection: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1" />
      <path d="M7 22h1a4 4 0 0 0 4-4v-1" />
      <path d="M7 2h1a4 4 0 0 1 4 4v1" />
    </svg>
  ),
  screenshot: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  ),
}

const CAPTURE_NAMES: Record<PageCapture['kind'], string> = {
  link: 'Page',
  selection: 'Selected text',
  screenshot: 'Screenshot',
  context: 'Item',
}

const sameIds = (left: readonly string[] | undefined, right: readonly string[]) =>
  (left ?? []).length === right.length && right.every((id, index) => left?.[index] === id)

// The message box of one conversation, and the page captures waiting to go with it. The draft belongs
// to `target` alone. An upload, send, or capture that finishes after the person switched away still
// lands in this conversation's stored draft, never in the one showing.
export function Composer(props: {
  client: BridgeClient
  storage: BrowserApi['storage']['local']
  target: DraftTarget
  // Where a message goes, named under the message box.
  destination: string
  capture(kind: CaptureKind): Promise<PageCapture>
  // Why sending is off right now, or null.
  blocked: string | null
  // A send finished, either way. The conversation reads itself again.
  settled(): void
}) {
  const target = props.target
  const [draft, setDraft] = createSignal<Draft>({ text: '' })
  const [loaded, setLoaded] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const [capturing, setCapturing] = createSignal<CaptureKind | null>(null)
  const [note, setNote] = createSignal<string | null>(null)
  let mounted = true
  let typed = false
  onCleanup(() => (mounted = false))

  onMount(() => {
    // Text typed before storage answered wins over the stored text.
    void loadDraft(props.storage, target).then((stored) => {
      if (!mounted) return
      setDraft(typed ? { ...stored, text: draft().text } : stored)
      setLoaded(true)
    })
  })

  // Every change to this conversation's draft goes through here: to the visible draft while mounted,
  // otherwise to the stored one.
  const apply = async (change: (current: Draft) => Draft): Promise<void> => {
    if (!mounted) return changeDraft(props.storage, target, change)
    const previous = draft()
    const next = change(previous)
    setDraft(next)
    await saveDraft(props.storage, target, next, previous)
  }

  const text = () => draft().text
  const captures = () => draft().captures ?? []
  const edit = (value: string) => {
    typed = true
    setNote(null)
    void apply((current) => ({ ...current, text: value })).catch(() =>
      setNote('Browser storage is full, so this draft may not survive closing the sidebar.'),
    )
  }

  const capture = async (kind: CaptureKind) => {
    setCapturing(kind)
    setNote(null)
    try {
      const captured = await props.capture(kind)
      await apply((current) => ({ ...current, captures: withCapture(current.captures ?? [], captured) }))
    } catch (error) {
      if (error instanceof CaptureFailure) setNote(error.message)
      else {
        // Storage refused the larger draft. Keep the visible draft to what is stored.
        if (mounted) setDraft(await loadDraft(props.storage, target))
        setNote('Browser storage is full. Send or remove captures in other conversations, then try again.')
      }
    } finally {
      setCapturing(null)
    }
  }

  // A capture the Node already holds is deleted there too, unless another capture in this draft is the
  // same screenshot: the Node keeps one attachment per task and content. The Node refuses to delete an
  // attachment a turn has sent, so a capture that went with an unconfirmed send stays safe.
  const remove = (removed: PageCapture) => {
    setNote(null)
    void apply((current) => ({
      ...current,
      captures: (current.captures ?? []).filter((other) => other.id !== removed.id),
    }))
    const attachmentId = removed.kind === 'screenshot' ? removed.attachmentId : undefined
    if (attachmentId && !captures().some((other) => other.kind === 'screenshot' && other.attachmentId === attachmentId))
      void props.client
        .call({ op: 'attachment.delete', nodeId: target.nodeId, taskId: target.taskId, attachmentId })
        .catch(() => undefined)
  }

  const retrying = () => {
    const pending = draft().pending
    return (
      !!pending &&
      pending.text === text().trim() &&
      sameIds(
        pending.captures,
        captures().map((c) => c.id),
      )
    )
  }

  const send = async (event: SubmitEvent) => {
    event.preventDefault()
    const message = text().trim()
    const sent = captures()
    if ((!message && !sent.length) || sending() || props.blocked) return
    const ids = sent.map((capture) => capture.id)
    // The same text and captures as an unconfirmed send go with that send's key, so the Node makes at
    // most one turn.
    const key = retrying() ? draft().pending!.key : crypto.randomUUID()
    setSending(true)
    setNote(null)
    let stage: 'upload' | 'submit' = 'upload'
    try {
      await apply((current) => ({ ...current, pending: { key, text: message, captures: ids } }))
      // Each screenshot's attachment is stored the moment the Node names it, so a retry reuses it.
      const attachmentIds = new Map<string, string>()
      for (const capture of sent) {
        if (capture.kind !== 'screenshot') continue
        let attachmentId = capture.attachmentId
        if (!attachmentId) {
          const uploaded = await props.client.call({
            op: 'attachment.upload',
            nodeId: target.nodeId,
            taskId: target.taskId,
            filename: `Screenshot of ${new URL(capture.url).hostname || 'page'}.jpg`,
            mediaType: capture.mediaType,
            data: screenshotData(capture),
          })
          attachmentId = uploaded.attachment.id
          const id = attachmentId
          await apply((current) => ({
            ...current,
            captures: (current.captures ?? []).map((other) =>
              other.id === capture.id ? { ...other, attachmentId: id } : other,
            ),
          }))
        }
        attachmentIds.set(capture.id, attachmentId)
      }
      stage = 'submit'
      await props.client.call({
        op: 'turn.submit',
        nodeId: target.nodeId,
        sessionId: target.sessionId,
        input: turnInput(message, sent, attachmentIds),
        key,
      })
      await apply(acknowledged(message, ids))
    } catch (error) {
      if (!mounted) return
      const failure = error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
      if (isUncertain(failure.code))
        setNote(
          stage === 'upload'
            ? "The Node didn't confirm a screenshot upload. Retry sends it again, and the Node keeps one copy."
            : "The Node didn't confirm this message, so it may have arrived. The conversation was read again; if the message isn't there, Retry sends it once, never twice.",
        )
      else if (failure.code === 'not_selected') setNote('That Node is no longer selected, so nothing was sent.')
      else setNote(errorGuidance(failure))
    } finally {
      if (mounted) setSending(false)
      props.settled()
    }
  }

  return (
    <form class="composer" onSubmit={(event) => void send(event)}>
      <Show when={captures().length}>
        {/* Each capture is a chip; opening it shows exactly what goes to the agent. */}
        <ul class="chips" aria-label="Captures">
          <For each={captures()}>
            {(capture) => (
              <li class="chip" data-testid="capture">
                <details>
                  <summary>
                    <Show when={capture.kind === 'screenshot' && capture.dataUrl}>
                      {(source) => <img class="thumb" src={source()} alt={`Screenshot of ${capture.title}`} />}
                    </Show>
                    <strong>
                      {CAPTURE_NAMES[capture.kind]}
                      {' · '}
                      {capture.title}
                    </strong>
                  </summary>
                  <span class="quiet">{capture.url}</span>
                  <Show when={capture.kind === 'selection' && capture.text}>
                    {(selected) => <blockquote>{selected()}</blockquote>}
                  </Show>
                  <Show when={capture.kind === 'context' && capture.content}>
                    {(content) => <pre class="context">{content()}</pre>}
                  </Show>
                </details>
                <button
                  type="button"
                  class="icon"
                  aria-label={`Remove ${CAPTURE_NAMES[capture.kind]}: ${capture.title}`}
                  disabled={sending()}
                  onClick={() => remove(capture)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <textarea
        name="message"
        rows={3}
        maxLength={TURN_TEXT_MAX_CHARS}
        placeholder="Message the agent"
        value={text()}
        onInput={(event) => edit(event.currentTarget.value)}
      />
      <div class="row toolbar">
        <For each={['link', 'selection', 'screenshot'] as const}>
          {(kind) => (
            <button
              type="button"
              class="icon"
              aria-label={CAPTURE_LABELS[kind]}
              title={CAPTURE_LABELS[kind]}
              aria-busy={capturing() === kind}
              disabled={!loaded() || capturing() !== null}
              onClick={() => void capture(kind)}
            >
              {CAPTURE_ICONS[kind]()}
            </button>
          )}
        </For>
        <span class="grow" />
        <button type="submit" disabled={sending() || (!text().trim() && !captures().length) || props.blocked !== null}>
          {sending() ? 'Sending…' : retrying() ? 'Retry' : 'Send'}
        </button>
      </div>
      <Show when={props.blocked ?? note()}>{(shown) => <p class="notice">{shown()}</p>}</Show>
      <p class="quiet">Goes to {props.destination}</p>
    </form>
  )
}
