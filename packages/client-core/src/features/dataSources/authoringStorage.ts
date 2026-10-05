import type { AuthoringTurnRequest } from '@acorn/protocol/authoring.ts'

// Where an AI authoring conversation keeps its context on this computer: one entry per Node, target,
// and target id. AuthoringConversation reads and writes it. It lives apart from the component so the
// panel studio's store can move an entry without importing Solid components.

type Target = AuthoringTurnRequest['target']
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export const authoringStorageKey = (cacheId: string, target: Target, targetId: string): string =>
  `acorn:ai-authoring:v1:${cacheId}:${target}:${targetId}`

/** Moves a conversation to the id its target was saved under, such as a new panel's draft id, so it
 *  isn't left behind under the id the target had before it was saved. */
export function moveAuthoringConversation(storage: Storage | undefined, cacheId: string, target: Target, from: string, to: string): void {
  const saved = storage?.getItem(authoringStorageKey(cacheId, target, from))
  if (!storage || saved == null) return
  storage.setItem(authoringStorageKey(cacheId, target, to), saved)
  storage.removeItem(authoringStorageKey(cacheId, target, from))
}
