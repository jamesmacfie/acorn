import type { AgentEventRecord, AgentUsage } from '@acorn/protocol/managedAgents.ts'

// One usage line per turn, in one place, because two sides now apply it.
//
// A harness reports usage as a running snapshot rather than a delta: on this developer's database
// `usage` is a quarter of every event ever recorded, about 58 rows a turn. The transcript has always
// folded them into a single card (client/sessions/conversationItems.ts, and docs/managed-agents.md
// "Usage folds the same way, one line per turn"), so every client was carrying 57 rows a turn it was
// only ever going to throw away. The HTTP snapshot now folds them before it serialises.
//
// The durable ledger keeps every row. Pricing, the usage settings page, `exportSnapshot` and workflow
// execution all read the ledger, and they read it unfolded.

// Field by field rather than a spread: a normalizer writes an absent value as a present-but-undefined
// key, and a spread would use it to wipe what an earlier update reported.
export const mergeAgentUsage = (previous: AgentUsage, next: AgentUsage): AgentUsage => ({
  inputTokens: next.inputTokens ?? previous.inputTokens,
  outputTokens: next.outputTokens ?? previous.outputTokens,
  cachedInputTokens: next.cachedInputTokens ?? previous.cachedInputTokens,
  contextUsed: next.contextUsed ?? previous.contextUsed,
  contextSize: next.contextSize ?? previous.contextSize,
  cost: next.cost ?? previous.cost,
})

/**
 * Collapse a seq-ordered run of events so that each turn carries one `usage` record.
 *
 * The rule is the transcript's own, copied so the two cannot drift: there is one open usage line at a
 * time; an update whose turn matches it, or which carries no turn at all, merges into it; anything
 * else opens the next line. The trailing turn-less update is how a cost reaches a line that started
 * with only a context count, and it is why this is not simply "group by turn id".
 *
 * The surviving record keeps the first update's id, seq and timestamp, so a card lands where it
 * landed before and the seq order is untouched.
 */
export function foldUsageEvents(events: AgentEventRecord[]): AgentEventRecord[] {
  const out: AgentEventRecord[] = []
  let line = -1
  for (const record of events) {
    if (record.event.type !== 'usage') {
      out.push(record)
      continue
    }
    const open = line >= 0 ? out[line] : undefined
    if (open?.event.type === 'usage' && (record.turnId === null || record.turnId === open.turnId)) {
      out[line] = { ...open, event: { type: 'usage', usage: mergeAgentUsage(open.event.usage, record.event.usage) } }
      continue
    }
    line = out.length
    out.push(record)
  }
  return out
}

/**
 * Where the open usage line sits in a folded run, or `-1` when there is none. The transcript keeps one
 * open line at a time, so this is the last `usage` record in the array.
 */
export function openUsageLine(events: AgentEventRecord[]): number {
  for (let at = events.length - 1; at >= 0; at--) if (events[at].event.type === 'usage') return at
  return -1
}
