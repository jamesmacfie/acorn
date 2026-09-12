import { createSignal } from 'solid-js'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'

// The part of an unsent turn that belongs to the session rather than to whoever is drawing it.
//
// The draft text has lived out here since the composer had one mount and still needed to survive
// stepping into a subagent (./../sessions/managedDrafts.ts). The rest of the draft stayed in the
// component, which was true until a session could be open in two panes at once: the Agent pane and the
// Workflows run pane both draw the same conversation now, so two composers address one session.
//
// What that made wrong, in order of how much it costs:
//
//   - `attachments` and `contexts` are the turn's own payload, and both persist to localStorage under a
//     session-keyed key. Two component copies meant two writers of one key, last write wins, and an
//     upload made in one pane vanished from the durable draft when the other pane saved.
//   - `sending`, `uploading` and `replacing` are in-flight guards, not view state. A guard held by one
//     mount has to stop the other: `replacing` exists so a turn cannot enqueue an attachment id that
//     is mid-swap, and a per-mount copy let the second composer do exactly that.
//   - `error` is written by six operations that all address the session, so left per-mount a failure
//     surfaced in whichever copy happened to own the effect.
//
// Held in a `Map` rather than one record per field, because the fields share a lifetime and because
// the hydration below has nowhere to live in the other shape. Signals only in here: a `createMemo` or
// an `onCleanup` outside an owner needs a `createRoot`, and then this module owns disposal of
// something whose lifetime is a session's.

/** A value or an updater, which is what a Solid setter takes. Spelled out so a caller passes either
 *  without the overloads of `Setter<T>` reaching every call site. */
type Update<T> = T | ((current: T) => T)

export type ComposerDraftState = {
  attachments: () => AgentAttachment[]
  setAttachments: (next: Update<AgentAttachment[]>) => void
  contexts: () => AgentContextSnapshot[]
  setContexts: (next: Update<AgentContextSnapshot[]>) => void
  error: () => string
  setError: (next: string) => void
  sending: () => boolean
  setSending: (next: boolean) => void
  uploading: () => boolean
  setUploading: (next: boolean) => void
  /** The id of the attachment being swapped out, or empty. */
  replacing: () => string
  setReplacing: (next: string) => void
  /** The read of the stored draft, once it has been started. See `hydrateComposerDraft`. */
  hydration?: Promise<unknown>
}

const states = new Map<string, ComposerDraftState>()

function create(): ComposerDraftState {
  const [attachments, setAttachments] = createSignal<AgentAttachment[]>([])
  const [contexts, setContexts] = createSignal<AgentContextSnapshot[]>([])
  const [error, setError] = createSignal('')
  const [sending, setSending] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [replacing, setReplacing] = createSignal('')
  return {
    attachments,
    setAttachments: (next) => void setAttachments(next as never),
    contexts,
    setContexts: (next) => void setContexts(next as never),
    error,
    setError: (next) => void setError(next),
    sending,
    setSending: (next) => void setSending(next),
    uploading,
    setUploading: (next) => void setUploading(next),
    replacing,
    setReplacing: (next) => void setReplacing(next),
  }
}

/** This session's shared draft, created on first ask. */
export function composerDraftState(sessionId: string): ComposerDraftState {
  const held = states.get(sessionId)
  if (held) return held
  const next = create()
  states.set(sessionId, next)
  return next
}

/**
 * Read the stored draft back, once per session however many composers ask.
 *
 * Not just a guard against a duplicated signal write: the read fetches an attachment per stored id and
 * may patch the session to clear a consumed fork context, so a second mount running it again is two
 * rounds of requests and a redundant write. Idempotence rather than an owner, because electing one
 * mount to do it means handling the case where that mount is the one that goes away.
 */
export function hydrateComposerDraft(sessionId: string, load: () => Promise<unknown>): void {
  const state = composerDraftState(sessionId)
  if (state.hydration) return
  state.hydration = load().catch(() => undefined)
}

/** Forget a session's draft. Called when the session is deleted, and for the whole map on a node
 *  switch, both from ../sessions/managedStore.ts. A mount that outlives the call resolves the session
 *  again on its next read and gets a fresh entry. */
export function clearComposerDraft(sessionId: string): void {
  states.delete(sessionId)
}

/** Every session's draft. The node switch in ../sessions/managedStore.ts calls this, because a session
 *  id is one node's, and so does a test, because the map is a module singleton and one test's draft
 *  would otherwise be the next one's starting state. */
export function clearComposerDrafts(): void {
  states.clear()
}
