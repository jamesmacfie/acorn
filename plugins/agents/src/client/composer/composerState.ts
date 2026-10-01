import { createSignal } from 'solid-js'
import { activeNodeId } from '@acorn/plugin-api/client'
import type { AgentAttachment } from '../../contract/wire.ts'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import { composerDraftKey, deleteComposerPayload, readComposerPayload, writeComposerPayload } from './composerDraftStorage'

type Update<T> = T | ((current: T) => T)
export type ComposerDraftState = ReturnType<typeof createDraft>
const states = new Map<string, ComposerDraftState>()

function createDraft(nodeId: string | null, sessionId: string) {
  const key = composerDraftKey(nodeId, sessionId)
  const stored = readComposerPayload(nodeId, sessionId)
  const [text, setText] = createSignal(stored.text)
  const [attachments, setAttachments] = createSignal<AgentAttachment[]>([])
  const [contexts, setContexts] = createSignal(stored.contexts)
  const [error, setError] = createSignal('')
  const [sending, setSending] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [replacing, setReplacing] = createSignal('')
  const [capturing, setCapturing] = createSignal('')
  let attachmentIds = stored.attachmentIds
  let textRevision = 0
  let attachmentRevision = 0
  let contextRevision = 0
  let captureRevision = 0
  let valid = true
  let holders = 0
  let preserveHydration = false
  const [hydrated, setHydrated] = createSignal(false)
  const payload = () => ({ text: text(), attachmentIds, contexts: contexts() })
  const persist = (field: keyof ReturnType<typeof payload>) => valid && writeComposerPayload(key, payload(), field)
  const reap = () => {
    if (!valid || preserveHydration || holders || sending() || uploading() || replacing() || capturing() || !hydrated()) return
    if (!text() && !attachmentIds.length && !contexts().length && states.get(key) === state) states.delete(key)
  }
  const state = {
    nodeId, sessionId, key, text, attachments, contexts, error, sending, uploading, replacing, capturing,
    valid: () => valid,
    revisions: () => [textRevision, attachmentRevision, contextRevision] as const,
    captureRevision: () => ++captureRevision,
    captureCurrent: (revision: number) => valid && revision === captureRevision,
    attachmentIds: () => attachmentIds,
    setText(next: string) { if (!valid) return; textRevision++; setText(next); persist('text') },
    setAttachments(next: Update<AgentAttachment[]>) {
      if (!valid) return
      attachmentRevision++
      setAttachments(next as never)
      attachmentIds = attachments().map(item => item.id)
      return persist('attachmentIds')
    },
    setContexts(next: Update<AgentContextSnapshot[]>) {
      if (!valid) return
      contextRevision++; setContexts(next as never); persist('contexts')
    },
    setError(next: string) { if (valid) setError(next) },
    setSending(next: boolean) { setSending(next); reap() },
    setUploading(next: boolean) { setUploading(next); reap() },
    setReplacing(next: string) { setReplacing(next); reap() },
    setCapturing(next: string) { setCapturing(next); reap() },
    hydration: undefined as Promise<unknown> | undefined,
    automaticCapture: undefined as { key: string; run: Promise<AgentContextSnapshot[]> } | undefined,
    hydrated,
    // The Node still advertises pendingForkContext after hydration. Retain its consumed client
    // hydration until deletion, so reaping an empty draft cannot inject the same fork context again.
    preserveForkHydration() { preserveHydration = true },
    finishHydration(success = true) { setHydrated(success); reap() },
    hold() { holders++; let released = false; return () => { if (!released) { released = true; holders--; reap() } } },
    invalidate() { valid = false },
    acknowledge(revisions: readonly number[], submittedAttachments: readonly AgentAttachment[], submittedContexts: readonly AgentContextSnapshot[]) {
      if (!valid) return
      if (textRevision === revisions[0]) state.setText('')
      state.setAttachments(attachmentRevision === revisions[1] ? []
        : attachments().filter(item => !submittedAttachments.includes(item)))
      state.setContexts(contextRevision === revisions[2] ? []
        : contexts().filter(item => !submittedContexts.includes(item)))
      reap()
    },
  }
  return state
}

/** Node-owned attachment ids and context travel with the shared unsent text. */
export function composerDraftState(sessionId: string, nodeId: string | null = activeNodeId()): ComposerDraftState {
  const key = composerDraftKey(nodeId, sessionId)
  let state = states.get(key)
  if (!state) { state = createDraft(nodeId, sessionId); states.set(key, state) }
  return state
}

export function hydrateComposerDraft(sessionId: string, load: () => Promise<unknown>, state = composerDraftState(sessionId)): void {
  if (state.hydration) return
  const run = load().then(() => state.finishHydration(), (error: unknown) => {
    state.setError(error instanceof Error ? error.message : 'Unable to restore draft attachments.')
    if (state.hydration === run) state.hydration = undefined
    state.finishHydration(false)
  })
  state.hydration = run
}

export function clearComposerDraft(sessionId: string, nodeId: string | null = activeNodeId()): void {
  const key = composerDraftKey(nodeId, sessionId)
  if (!states.has(key)) readComposerPayload(nodeId, sessionId)
  states.get(key)?.invalidate()
  states.delete(key)
  deleteComposerPayload(nodeId, sessionId)
}

/** Test/application disposal. Node navigation preserves unsent drafts. */
export function clearComposerDrafts(): void {
  for (const state of states.values()) state.invalidate()
  states.clear()
}
