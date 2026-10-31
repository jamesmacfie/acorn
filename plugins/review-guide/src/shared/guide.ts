// What the node half serves and the pane draws (docs/first-party-plugins/review-guide.md).

/** One reviewable piece of the change: a hunk, or a whole file change with no text to show. */
export type DiffItem = {
  /** The path and the item's 1-based position in that file, such as `README.md#2`. */
  id: string
  path: string
  /** The path before a rename or copy. */
  oldPath: string | null
  /** One `@@` hunk with its lines. Empty for a binary file, a pure rename, or a mode change. */
  patch: string
  /** What a change with no hunk text is, such as "Binary file". Empty for a hunk. */
  note: string
}

/** A short note the harness pinned to one line of a hunk. */
export type GuideNote = {
  /** The ID of a hunk in the note's step. */
  hunk: string
  /** `new` for an added or unchanged line, `old` for a deleted one. */
  side: 'old' | 'new'
  /** The line's number on `side`. */
  line: number
  /** The line's text without its `+`, `-`, or space marker. The note check holds the note to it. */
  text: string
  /** The pane labels them Explains, Look closely, and Risk. */
  tone: 'explain' | 'attention' | 'risk'
  title: string
  /** Markdown. */
  body: string
}

type GuideStep = {
  title: string
  /** Finishes "After this step you'll know". Empty on a guide stored before steps had goals. */
  goal: string
  /** Markdown. */
  why: string
  kind: 'core' | 'supporting'
  items: DiffItem[]
  /** Notes on lines of `items`, in reading order. */
  notes: GuideNote[]
}

/** A guide after the coverage and note checks: every item of the diff appears exactly once, and every
 *  note sits on the line it quotes. */
export type Guide = {
  summary: string
  steps: GuideStep[]
  /** Items the harness left out, in file order. The pane draws them last as "Not covered by the guide". */
  uncovered: DiffItem[]
  /** Items the harness put in more than one step. Each stays in the first. */
  repeated: number
  /** IDs in the answer that name no item of the diff. Dropped. */
  unknown: number
  /** Notes the checks dropped: off their step's hunks, quoting no line, or past a cap. */
  misplacedNotes: number
}

/** How far the reader got through a guide. Kept on the guide's row, so a new guide starts with none. */
export type GuideProgress = {
  /** `overview` and `step-<n>` for each page marked reviewed, as `stepPage` names them. */
  pages: string[]
  /** The keys of the notes marked checked, as `guidePath` gives them. */
  notes: string[]
}

/** `POST /guide/progress`'s body, less the task: one page or one note marked done or not done. */
export type ProgressMark = ({ page: string } | { note: string }) & { done: boolean }

export type StoredGuide = {
  status: 'generating' | 'ready' | 'failed' | 'stale'
  profileId: string
  baseRef: string
  baseSha: string
  headSha: string
  sessionId: string | null
  error: string | null
  guide: Guide | null
  progress: GuideProgress
  /** When generating started. A regenerated guide has a new one. */
  createdAt: number
  updatedAt: number
}

export type AgentProfile = { id: string; label: string }

/** `GET /guide?taskId=`, and the answer to each POST. */
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

/** The longest extra context the person may add when they generate a guide. */
export const GUIDE_CONTEXT_MAX_CHARS = 2_000

/** `POST /guide/generate`'s body, less the task. Every field is optional. */
export type GenerateRequest = {
  profileId?: string
  /** A model from the profile's catalog. Empty or absent leaves the harness's own default. */
  model?: string
  /** What the person wants the guide to focus on. It goes into the prompt and isn't stored. */
  context?: string
}
