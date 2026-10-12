import type { BrowserApi } from '../browser'

// What the sidebar keeps in this browser profile's storage: unsent drafts, and the destination it
// last showed on each Node. Neither leaves the browser until the person sends.

type Storage = BrowserApi['storage']['local']

// A draft belongs to one conversation, named by all three IDs, so switching shows that conversation's
// own draft and never carries one into another.
export type DraftTarget = { nodeId: string; taskId: string; sessionId: string }

// `pending` is a send the Node didn't confirm: the text sent and the key it went with. Sending that
// same text again reuses the key, so the Node answers with the turn it may already have made.
export type Draft = { text: string; pending?: { key: string; text: string } }

const draftKey = (target: DraftTarget) => `draft:${target.nodeId}:${target.taskId}:${target.sessionId}`

export async function loadDraft(storage: Storage, target: DraftTarget): Promise<Draft> {
  const stored = (await storage.get([draftKey(target)]))[draftKey(target)] as Draft | undefined
  return typeof stored?.text === 'string' ? stored : { text: '' }
}

export async function saveDraft(storage: Storage, target: DraftTarget, draft: Draft): Promise<void> {
  if (!draft.text && !draft.pending) await storage.remove([draftKey(target)])
  else await storage.set({ [draftKey(target)]: draft })
}

// The Node accepted `sent`. Clear the draft if it still reads that; keep anything typed since.
export async function acknowledgeDraft(storage: Storage, target: DraftTarget, sent: string): Promise<Draft> {
  const current = await loadDraft(storage, target)
  const next = { text: current.text === sent ? '' : current.text }
  await saveDraft(storage, target, next)
  return next
}

export type Destination = { projectId: string | null; taskId: string | null; sessionId: string | null }

const destinationKey = (nodeId: string) => `destination:${nodeId}`

export async function loadDestination(storage: Storage, nodeId: string): Promise<Destination> {
  const stored = (await storage.get([destinationKey(nodeId)]))[destinationKey(nodeId)] as Destination | undefined
  return { projectId: stored?.projectId ?? null, taskId: stored?.taskId ?? null, sessionId: stored?.sessionId ?? null }
}

export const saveDestination = (storage: Storage, nodeId: string, destination: Destination): Promise<void> =>
  storage.set({ [destinationKey(nodeId)]: destination })
