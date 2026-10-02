import type { AgentEventRecord, AgentToolCall, AgentWebActivity } from '../contract/wire.ts'

// One tool card per call, in one place, because several sides apply it.
//
// A harness reports a tool call as a run of updates on one id: the call, its output as it streams, its
// status. On this developer's database `tool` is half of every event recorded, and a long session is
// mostly them: 38,000 of one session's 48,000 rows. The transcript has always folded a call's updates
// into one card (client/sessions/conversationItems.ts), so every client was paging through, parsing and
// re-projecting rows it was only going to merge. The HTTP snapshot and event pages now fold them before
// they serialise, for a reader that asks (../server/routes/managed.ts, `fold=1`).
//
// The ledger itself now keeps a call as two rows, its opener and its latest state
// (../server/sessions/ledgerFold.ts, which merges with `mergeToolCall` below). Readers that do not ask
// for this fold, such as workflow execution, the wait route and export, get those two rows.

// Field by field rather than a spread: the normalizers write absent values as present-but-undefined
// keys, which a spread would use to wipe what an earlier update reported.
export const mergeToolCall = (previous: AgentToolCall, next: AgentToolCall): AgentToolCall => ({
  id: previous.id,
  parentId: next.parentId ?? previous.parentId,
  title: next.title || previous.title,
  ...(next.name || previous.name ? { name: next.name ?? previous.name } : {}),
  kind: next.kind ?? previous.kind,
  status: next.status ?? previous.status,
  input: next.input ?? previous.input,
  output: next.outputAppend
    ? (previous.output ?? '') + (next.output ?? '')
    : next.output ?? previous.output,
  paths: next.paths ?? previous.paths,
  subagentId: next.subagentId ?? previous.subagentId,
  web: next.web && previous.web ? mergeWebActivity(previous.web, next.web) : next.web ?? previous.web,
})

// Same convention, one level down. A provider reports the request and the sources on different
// updates — Claude Code sends the query, then the results, then the status, all on the same call id
// — so a spread would let each of those wipe the last. An explicit empty result list is the
// provider saying it found nothing and does replace; an absent one means it had nothing to add.
const mergeWebActivity = (previous: AgentWebActivity, next: AgentWebActivity): AgentWebActivity => ({
  action: next.action ?? previous.action,
  results: next.results ?? previous.results,
  status: next.status ?? previous.status,
})

/** The key the transcript folds a call's updates under: one card per call per turn. */
export const toolCardKey = (turnId: string | null, toolId: string): string => `${turnId ?? 'session'}:${toolId}`

/**
 * Collapse a seq-ordered page so that each tool call carries one record.
 *
 * The surviving record keeps the first update's id, seq and timestamp, so the card lands where it
 * landed before, and `foldedThroughSeq` says how far it reaches. `subagentId` stays the first
 * update's too, because that is what decides whose stream the transcript puts the card in.
 *
 * The fold stays inside the page it is given. A call that spans two pages arrives as two records, and
 * the transcript folds the second into the first the way it folds any update, so the second has to
 * say whether its output continues the first's. It does unless some row in its page set the output
 * outright: a Codex command streams appends and then reports the whole output once more at the end,
 * and appending that to the earlier page's half would draw the first half twice.
 */
export function foldToolEvents(events: AgentEventRecord[]): AgentEventRecord[] {
  const out: AgentEventRecord[] = []
  const cards = new Map<string, number>()
  // Cards whose output some row in this page replaced rather than appended to.
  const replaced = new Set<string>()
  const replaces = (call: AgentToolCall) => call.output != null && !call.outputAppend
  for (const record of events) {
    if (record.event.type !== 'tool') {
      out.push(record)
      continue
    }
    const key = toolCardKey(record.turnId, record.event.tool.id)
    const at = cards.get(key)
    const open = at === undefined ? undefined : out[at]
    if (at === undefined || open?.event.type !== 'tool') {
      cards.set(key, out.length)
      if (replaces(record.event.tool)) replaced.add(key)
      out.push(record)
      continue
    }
    if (replaces(record.event.tool)) replaced.add(key)
    const merged = mergeToolCall(open.event.tool, record.event.tool)
    out[at] = {
      ...open,
      event: {
        type: 'tool',
        tool: {
          ...merged,
          subagentId: open.event.tool.subagentId,
          outputAppend: merged.output != null && !replaced.has(key) ? true : undefined,
        },
      },
      foldedThroughSeq: record.seq,
    }
  }
  return out
}
