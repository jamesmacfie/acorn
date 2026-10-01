import { readLocal, writeLocal, clearLocal } from '@acorn/plugin-api/client'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'

export type StoredComposerDraft = { text: string; attachmentIds: string[]; contexts: AgentContextSnapshot[] }
type DraftField = keyof StoredComposerDraft
const claims = new Map<string, string>()
const pendingMigrations = new Map<string, string>()
export const composerDraftKey = (nodeId: string | null, sessionId: string): string =>
  `acorn.agent-payload.${JSON.stringify([nodeId, sessionId])}`
const fields: readonly DraftField[] = ['text', 'attachmentIds', 'contexts']
const fieldKey = (key: string, field: DraftField) => `${key}.${field}`
const legacyKeys = (id: string) => [`acorn.agent-draft.${id}`, `acorn.agent-attachments.${id}`, `acorn.agent-context.${id}`]
const parse = (value: string | null): unknown => {
  try { return JSON.parse(value ?? 'null') } catch { return null }
}
const arrayFrom = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const contextsFrom = (value: unknown): AgentContextSnapshot[] => arrayFrom(value).filter((item): item is AgentContextSnapshot =>
  typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'context')
const idsFrom = (value: unknown): string[] => arrayFrom(value).filter((item): item is string => typeof item === 'string')

export function readComposerPayload(nodeId: string | null, sessionId: string): StoredComposerDraft {
  const key = composerDraftKey(nodeId, sessionId)
  const [textKey, attachmentsKey, contextsKey] = legacyKeys(sessionId)
  const claimKey = `acorn.agent-legacy-owner.${sessionId}`
  const claimed = claims.get(sessionId) ?? readLocal(claimKey)
  const legacy = claimed && claimed !== key ? { text: '', attachmentIds: [], contexts: [] } : {
    text: readLocal(textKey) ?? '', attachmentIds: idsFrom(parse(readLocal(attachmentsKey))),
    contexts: contextsFrom(parse(readLocal(contextsKey))),
  }
  const storedText = readLocal(fieldKey(key, 'text'))
  const storedAttachments = readLocal(fieldKey(key, 'attachmentIds'))
  const storedContexts = readLocal(fieldKey(key, 'contexts'))
  const text = parse(storedText)
  const payload = {
    text: storedText === null ? legacy.text : typeof text === 'string' ? text : '',
    attachmentIds: storedAttachments === null ? legacy.attachmentIds : idsFrom(parse(storedAttachments)),
    contexts: storedContexts === null ? legacy.contexts : contextsFrom(parse(storedContexts)),
  }
  if (legacy.text || legacy.attachmentIds.length || legacy.contexts.length) {
    // Claim before any asynchronous metadata read. Failed storage still leaves one in-memory owner.
    claims.set(sessionId, key)
    writeLocal(claimKey, key)
    pendingMigrations.set(key, sessionId)
    writeComposerPayload(key, payload)
  }
  return payload
}

/** A text edit writes only text. Migration retries all fields before retiring the legacy payload. */
export function writeComposerPayload(key: string, payload: StoredComposerDraft, field?: DraftField): boolean {
  const migrating = pendingMigrations.get(key)
  const wanted = migrating || !field ? fields : [field]
  let success = true
  for (const part of wanted) {
    const encoded = JSON.stringify(payload[part])
    writeLocal(fieldKey(key, part), encoded)
    if (readLocal(fieldKey(key, part)) !== encoded) success = false
  }
  if (success && migrating) {
    legacyKeys(migrating).forEach(clearLocal)
    pendingMigrations.delete(key)
  }
  if (success && !payload.text && !payload.attachmentIds.length && !payload.contexts.length) {
    fields.forEach(part => clearLocal(fieldKey(key, part)))
  }
  return success
}

export function deleteComposerPayload(nodeId: string | null, sessionId: string): void {
  const key = composerDraftKey(nodeId, sessionId)
  fields.forEach(part => clearLocal(fieldKey(key, part)))
  pendingMigrations.delete(key)
  if ((claims.get(sessionId) ?? readLocal(`acorn.agent-legacy-owner.${sessionId}`)) === key) {
    legacyKeys(sessionId).forEach(clearLocal)
  }
}
