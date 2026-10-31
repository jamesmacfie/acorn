/** The diff location that opened a managed agent conversation. */

export type InlineDiffOrigin = {
  kind: 'inline-diff'
  source: 'changes' | 'pull-request'
  taskId: string
  path: string
  side: 'old' | 'new'
  line: number
  patchKey: string
  quote: string
  access?: 'read-only' | 'full'
  scope?: 'staged' | 'unstaged'
  pull?: { owner: string; repo: string; number: string }
  /** The notes pinned to the line when the conversation started, such as a review guide's. They're
   *  its opening messages, and they went to the agent with the reader's first question. */
  notes?: InlineDiffNote[]
}

/** A note on a diff line, as the conversation keeps it: `DiffNoteText` from `@acorn/plugin-api/ui/diff`. */
export type InlineDiffNote = {
  tone?: 'neutral' | 'warn' | 'danger'
  label?: string
  author?: string
  /** The plugin that pinned it, as the host verified. */
  from?: string
  title?: string
  body?: string
}

export const sameInlineLine = (left: InlineDiffOrigin, right: InlineDiffOrigin): boolean =>
  left.taskId === right.taskId &&
  left.source === right.source &&
  left.path === right.path &&
  left.side === right.side &&
  left.line === right.line &&
  left.patchKey === right.patchKey &&
  left.scope === right.scope &&
  left.pull?.owner === right.pull?.owner &&
  left.pull?.repo === right.pull?.repo &&
  left.pull?.number === right.pull?.number
