// The shaping half of `agents.reviewInput.v1` (docs/managed-agents/session-events.md § Review input).
// AgentLifecycle reads the rows; this decides what of them a reviewer may see, and cuts it to size.
import { truncateBytes } from '@acorn/plugin-api/node'
import type { AgentInputPart, AgentTurn } from '../../contract/wire.ts'
import {
  MAX_REVIEW_FINAL_TEXT_BYTES,
  MAX_REVIEW_USER_TEXT_BYTES,
  type AgentReviewProvenance,
  type AgentReviewText,
} from '../../contract/lifecycle'

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

/**
 * The turn's text and context parts, in order, under one aggregate byte bound. A part past the bound is
 * cut, and every part after it is dropped. Files, attachments, and images are left out: a path or a
 * byte is not something a reviewer reads.
 */
export function reviewUserText(
  turn: Pick<AgentTurn, 'source' | 'input'>,
  maxBytes = MAX_REVIEW_USER_TEXT_BYTES,
): {
  userText: AgentReviewText[]
  userTextTruncated: boolean
} {
  const parts = turn.input
    .flatMap((part: AgentInputPart): Array<{ text: string; provenance: AgentReviewProvenance }> => {
      if (part.type === 'text') {
        return [
          {
            text: part.text,
            provenance: turn.source === 'interactive' ? { kind: 'person' } : { kind: 'turn', source: turn.source },
          },
        ]
      }
      if (part.type === 'context')
        return [{ text: part.content, provenance: { kind: 'context', source: part.source, label: part.label } }]
      return []
    })
    .filter((part) => part.text.trim())
  const userText: AgentReviewText[] = []
  let left = maxBytes
  for (const part of parts) {
    if (left <= 0) return { userText, userTextTruncated: true }
    const truncated = bytes(part.text) > left
    userText.push({ ...part, text: truncated ? truncateBytes(part.text, left) : part.text, truncated })
    left -= bytes(part.text)
    if (truncated) return { userText, userTextTruncated: true }
  }
  return { userText, userTextTruncated: false }
}

type AssistantEvent = { text?: unknown; append?: unknown; messageId?: unknown; subagentId?: unknown }

/**
 * The last top-level assistant message, folded from the ledger's append-only deltas. A subagent's
 * message is its own conversation, not the agent's answer.
 */
export function finalAssistantText(
  events: readonly AssistantEvent[],
  maxBytes = MAX_REVIEW_FINAL_TEXT_BYTES,
): {
  finalText: string
  finalTextTruncated: boolean
} {
  let last: { messageId: unknown; text: string } | null = null
  for (const event of events) {
    if (typeof event.text !== 'string' || event.subagentId !== undefined) continue
    if (event.append === true && last && last.messageId === event.messageId) last.text += event.text
    else last = { messageId: event.messageId, text: event.text }
  }
  const text = last?.text.trim() ?? ''
  const finalTextTruncated = bytes(text) > maxBytes
  return { finalText: finalTextTruncated ? truncateBytes(text, maxBytes) : text, finalTextTruncated }
}
