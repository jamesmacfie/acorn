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
}

export const sameInlineLine = (left: InlineDiffOrigin, right: InlineDiffOrigin): boolean =>
  left.taskId === right.taskId && left.source === right.source && left.path === right.path &&
  left.side === right.side && left.line === right.line && left.patchKey === right.patchKey &&
  left.scope === right.scope && left.pull?.owner === right.pull?.owner &&
  left.pull?.repo === right.pull?.repo && left.pull?.number === right.pull?.number
