import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'

// Whether one attachment in an unsent draft may be swapped for another, and what the draft becomes
// (docs/managed-agents.md § Draft attachments, and docs/plugins.md § Asking the owner for who asks).
//
// Pure, and its own file, because it is a compare-and-swap between two owners that cannot share a
// transaction: the draft is an array in the composer and the replacement is a row on the node. The
// composer does the I/O around this — fetch the replacement's metadata, write the draft, clean up —
// and every rule about whether the swap is allowed at all is here, where a test can drive the cases
// that lose a person's attachment if they are wrong.

/** The caps the composer applies to a draft, restated here so this decision is complete on its own.
 *  The node re-checks both at enqueue; these exist so a reader is refused before an upload. */
export const MAX_DRAFT_ATTACHMENT_BYTES = 25 * 1024 * 1024

export type ReplacementDecision =
  /** Nothing to do, and not a failure. */
  | { kind: 'noop' }
  /** Swap it. `next` is the whole draft, with exactly one element changed and the order kept. */
  | { kind: 'replace'; next: AgentAttachment[] }
  /** Refuse, with something a person can read. */
  | { kind: 'refuse'; reason: string }

export function decideReplacement(input: {
  /** The draft as it is now, re-read after any await rather than captured before one. */
  current: readonly AgentAttachment[]
  /** The attachment the owner bound this handler to. */
  expectedId: string
  /** What the contributor claims it edited. Absent is allowed; wrong is not. */
  claimedExpectedId?: unknown
  /** The candidate, as the node describes it. */
  replacement: AgentAttachment
  taskId: string
}): ReplacementDecision {
  const refuse = (reason: string): ReplacementDecision => ({ kind: 'refuse', reason })

  // A contributor cannot address a slot it was not drawn in: the owner checks the id it was told to
  // expect against the one it actually bound.
  if (input.claimedExpectedId !== undefined && input.claimedExpectedId !== input.expectedId) {
    return refuse('That is not the attachment this slot is showing.')
  }
  // First, and it has to be. Attachment storage is content addressed, so an edit that changed no
  // pixels hashes to the source and comes back AS the source. Every check below would then be asking
  // whether the draft may contain the attachment it already contains, and the refusal path would
  // delete it.
  if (input.replacement.id === input.expectedId) return { kind: 'noop' }
  if (input.replacement.taskId !== input.taskId) return refuse('That attachment belongs to another task.')
  if (!input.replacement.mediaType.startsWith('image/')) return refuse('An attachment can only be replaced by an image.')

  const at = input.current.findIndex((item) => item.id === input.expectedId)
  // The reader removed it, sent the turn, or switched sessions while an editor was open.
  if (at < 0) return refuse('That attachment is no longer in this draft.')
  if (input.current.some((item) => item.id === input.replacement.id)) {
    return refuse('That attachment is already in this draft.')
  }
  const aggregate = input.current.reduce(
    (total, item) => total + (item.id === input.expectedId ? 0 : item.byteSize),
    input.replacement.byteSize,
  )
  if (aggregate > MAX_DRAFT_ATTACHMENT_BYTES) return refuse('Turn attachments are limited to 25 MiB in total.')

  return { kind: 'replace', next: input.current.map((item, position) => (position === at ? input.replacement : item)) }
}
