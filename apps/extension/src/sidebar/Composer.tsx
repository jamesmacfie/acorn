import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { TURN_TEXT_MAX_CHARS } from '@acorn/protocol/extensionBridge.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { formatChord } from '@acorn/client-core/kit/lib/formatChord'
import type { BrowserApi } from '../browser'
import { CallFailure, isUncertain } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { screenshotData, turnInput, type PageCapture } from '../capture'
import { errorGuidance } from './guidance'
import {
  acknowledged,
  changeDraft,
  changedCaptures,
  loadDraft,
  saveDraft,
  type Draft,
  type DraftTarget,
} from '../localState'

export const CAPTURE_NAMES: Record<PageCapture['kind'], string> = {
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
  storage: BrowserApi['storage']
  target: DraftTarget
  // Why sending is off right now, or null.
  blocked: string | null
  // A send finished, either way. The conversation reads itself again.
  settled(): void
}) {
  const target = props.target
  const [draft, setDraft] = createSignal<Draft>({ text: '' })
  const [loaded, setLoaded] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const [note, setNote] = createSignal<string | null>(null)
  // The desktop composer's size toggle, with its chords. The panel runs no keymap, so the field reads
  // its own keys: Command or Control with Enter sends, and with Shift as well toggles the size.
  const [expanded, setExpanded] = createSignal(false)
  const chords = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing) return
    event.preventDefault()
    if (event.shiftKey) setExpanded((open) => !open)
    else event.currentTarget.form?.requestSubmit()
  }
  let mounted = true
  let typed = false
  // A capture stored from elsewhere, such as the page's right-click menu, joins the visible draft, so
  // the next save here keeps it. This composer's own saves come back with the same captures.
  const followStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const stored = area === 'local' ? changedCaptures(target, changes) : undefined
    if (
      !stored ||
      !loaded() ||
      sameIds(
        stored.map((capture) => capture.id),
        captures().map((capture) => capture.id),
      )
    )
      return
    setDraft((current) => ({ ...current, captures: stored }))
  }
  props.storage.onChanged.addListener(followStorage)
  onCleanup(() => {
    mounted = false
    props.storage.onChanged.removeListener(followStorage)
  })

  onMount(() => {
    // Text typed before storage answered wins over the stored text.
    void loadDraft(props.storage.local, target).then((stored) => {
      if (!mounted) return
      setDraft(typed ? { ...stored, text: draft().text } : stored)
      setLoaded(true)
    })
  })

  // Every change to this conversation's draft goes through here: to the visible draft while mounted,
  // otherwise to the stored one.
  const apply = async (change: (current: Draft) => Draft): Promise<void> => {
    if (!mounted) return changeDraft(props.storage.local, target, change)
    const previous = draft()
    const next = change(previous)
    setDraft(next)
    await saveDraft(props.storage.local, target, next, previous)
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
      <div class="field">
        <textarea
          name="message"
          rows={expanded() ? 18 : 3}
          maxLength={TURN_TEXT_MAX_CHARS}
          placeholder="Message the agent"
          value={text()}
          onInput={(event) => edit(event.currentTarget.value)}
          onKeyDown={chords}
        />
        <button
          type="button"
          class="icon"
          aria-label={expanded() ? 'Collapse the message box' : 'Expand the message box'}
          aria-pressed={expanded()}
          title={`${expanded() ? 'Collapse' : 'Expand'} ${formatChord('meta+shift+enter')}`}
          onClick={() => setExpanded((open) => !open)}
        >
          <Icon name={expanded() ? 'minimize-2' : 'maximize-2'} />
        </button>
      </div>
      <div class="row toolbar">
        <span class="grow" />
        <button type="submit" disabled={sending() || (!text().trim() && !captures().length) || props.blocked !== null}>
          {sending() ? 'Sending…' : retrying() ? 'Retry' : 'Send'}
        </button>
      </div>
      <Show when={props.blocked ?? note()}>{(shown) => <p class="notice">{shown()}</p>}</Show>
    </form>
  )
}
