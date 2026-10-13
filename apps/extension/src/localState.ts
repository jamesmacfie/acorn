import type { BrowserApi } from './browser'
import type { PageCapture } from './capture'

// What the sidebar keeps in this browser profile's storage: unsent drafts, and the destination it
// last showed on each Node. Neither leaves the browser until the person sends.

type Storage = BrowserApi['storage']['local']

// A draft belongs to one conversation, named by all three IDs, so switching shows that conversation's
// own draft and never carries one into another.
export type DraftTarget = { nodeId: string; taskId: string; sessionId: string }

// `captures` are page captures waiting to go with the next message. `pending` is a send the Node
// didn't confirm: the text and captures sent, and the key it went with. Sending that same text and
// those same captures again reuses the key, so the Node answers with the turn it may already have made.
export type Draft = {
  text: string
  captures?: PageCapture[]
  pending?: { key: string; text: string; captures?: string[] }
}

const draftKey = (target: DraftTarget) => `draft:${target.nodeId}:${target.taskId}:${target.sessionId}`
// Captures sit under their own key, because a screenshot can be megabytes and the text is saved on
// every keystroke.
const capturesKey = (target: DraftTarget) => `captures:${target.nodeId}:${target.taskId}:${target.sessionId}`

export async function loadDraft(storage: Storage, target: DraftTarget): Promise<Draft> {
  const stored = await storage.get([draftKey(target), capturesKey(target)])
  const draft = stored[draftKey(target)] as Omit<Draft, 'captures'> | undefined
  const captures = stored[capturesKey(target)] as PageCapture[] | undefined
  return {
    ...(typeof draft?.text === 'string' ? draft : { text: '' }),
    ...(Array.isArray(captures) && captures.length ? { captures } : {}),
  }
}

// Writes the captures only when they differ from `previous`. Rejects when browser storage is full; a
// screenshot is the only thing large enough to fill it.
export async function saveDraft(storage: Storage, target: DraftTarget, draft: Draft, previous?: Draft): Promise<void> {
  const { captures = [], ...rest } = draft
  if (!previous || draft.captures !== previous.captures) {
    if (captures.length) await storage.set({ [capturesKey(target)]: captures })
    else await storage.remove([capturesKey(target)])
  }
  if (!rest.text && !rest.pending) await storage.remove([draftKey(target)])
  else await storage.set({ [draftKey(target)]: rest })
}

// Changes the stored draft of a conversation the sidebar no longer shows, for an operation that
// finished after the person moved on.
export async function changeDraft(storage: Storage, target: DraftTarget, change: (draft: Draft) => Draft) {
  const previous = await loadDraft(storage, target)
  await saveDraft(storage, target, change(previous), previous)
}

// The Node accepted a send of `text` with these captures. They leave the draft, and so does the text
// if it still reads the same; anything typed or captured since stays.
export const acknowledged =
  (text: string, captureIds: readonly string[]) =>
  (draft: Draft): Draft => ({
    text: draft.text.trim() === text ? '' : draft.text,
    ...(captureIds.length
      ? { captures: (draft.captures ?? []).filter((capture) => !captureIds.includes(capture.id)) }
      : draft.captures
        ? { captures: draft.captures }
        : {}),
  })

export type Destination = { projectId: string | null; taskId: string | null; sessionId: string | null }

const destinationKey = (nodeId: string) => `destination:${nodeId}`

export async function loadDestination(storage: Storage, nodeId: string): Promise<Destination> {
  const stored = (await storage.get([destinationKey(nodeId)]))[destinationKey(nodeId)] as Destination | undefined
  return { projectId: stored?.projectId ?? null, taskId: stored?.taskId ?? null, sessionId: stored?.sessionId ?? null }
}

export const saveDestination = (storage: Storage, nodeId: string, destination: Destination): Promise<void> =>
  storage.set({ [destinationKey(nodeId)]: destination })
