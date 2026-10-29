// What the node half serves and the pane draws (docs/first-party-plugins/review-guide.md).

/** One reviewable piece of the change: a hunk, or a whole file change with no text to show. */
export type DiffItem = {
  /** The path and the item's 1-based position in that file, such as `src/billing/invoice.ts#2`. */
  id: string
  path: string
  /** The path before a rename or copy. */
  oldPath: string | null
  /** One `@@` hunk with its lines. Empty for a binary file, a pure rename, or a mode change. */
  patch: string
  /** What a change with no hunk text is, such as "Binary file". Empty for a hunk. */
  note: string
}

type GuideSection = {
  title: string
  /** Markdown. */
  why: string
  kind: 'core' | 'supporting'
  items: DiffItem[]
}

/** A guide after the coverage check: every item of the diff appears exactly once. */
export type Guide = {
  summary: string
  sections: GuideSection[]
  /** Items the harness left out, in file order. The pane draws them last as "Not covered by the guide". */
  uncovered: DiffItem[]
  /** Items the harness put in more than one section. Each stays in the first. */
  repeated: number
  /** IDs in the answer that name no item of the diff. Dropped. */
  unknown: number
}

export type StoredGuide = {
  status: 'generating' | 'ready' | 'failed' | 'stale'
  profileId: string
  baseRef: string
  baseSha: string
  headSha: string
  sessionId: string | null
  error: string | null
  guide: Guide | null
  updatedAt: number
}

export type AgentProfile = { id: string; label: string }

/** `GET /guide?taskId=`, and the answer to the two POSTs. */
export type GuideView = {
  /** False when the task has no primary change request. The pane shows an empty state. */
  hasChangeRequest: boolean
  profiles: AgentProfile[]
  /** The person's saved choice, or the first profile when they haven't chosen. */
  profileId: string | null
  /** The newest guide for the task. */
  guide: StoredGuide | null
}

export const CHANGED_CHANNEL = 'plugin:review-guide:changed'
