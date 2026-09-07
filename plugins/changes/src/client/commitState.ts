import { createMemo, createSignal } from 'solid-js'
import { persistDraft } from '@acorn/plugin-api/client'
import type { CommitMessageRequest, CommitOptions, GeneratedCommitMessage, HeadCommit } from '../shared/api'
import { commitMode, generateReason, type ChangesGroups, type CommitMode } from './model'

// The commit editor's state: the message, the three options, what the button will do, and the two
// verbs behind it.
//
// Its own module rather than another hundred lines of ./changesModel.tsx, because everything here is
// about one field and it needs four things from the world — a task id, the groups, HEAD's message,
// and a way to commit. That makes it testable beside the pane instead of only inside a model that
// fetches over HTTP and subscribes to a poll.

/** What the state needs from outside it. `commit` and `headCommit` are the HTTP calls, injected so a
 *  test can answer them without a node. */
export type CommitDeps = {
  taskId: string
  groups: () => ChangesGroups
  headCommit: () => Promise<HeadCommit | null>
  commit: (message: string, options: CommitOptions) => Promise<{ ok: boolean; reason?: string }>
  /** Ask a connected model provider for a message. Throws on a refusal, unlike `commit`: the node
   *  answers a provider failure as an error envelope, and the code in it is what the alert needs
   *  (./model.ts § generateReason). */
  commitMessage: (request: CommitMessageRequest) => Promise<GeneratedCommitMessage>
  /** The footer's alert line. Cleared with `''`, which is what a commit that landed writes. */
  onError: (reason: string) => void
  /** Re-read the tree. The status resource's `refetch` in the model. */
  onCommitted: () => void | Promise<void>
}

export type CommitState = ReturnType<typeof createCommitState>

/** Where a commit draft is kept on this device. The task id follows it and the node does not: a
 *  draft belongs to the worktree the reader is looking at, and the same task on another node is
 *  another worktree with another set of changes in it. */
export const DRAFT_PREFIX = 'changes:commit-draft:'

export function createCommitState(deps: CommitDeps) {
  // A draft is losable and device-local by the recorded decision
  // (docs/state-ownership.md § Scope rules), which is what lets it live in `localStorage` rather than
  // in a row somebody has to migrate. Written on every keystroke and reseeded when the task changes.
  //
  // Held here, above the footer, because the footer is a region the host can unmount on its own:
  // below 80 columns the pane shows the list or the diff and never both, and a message typed before
  // a trip to the diff has to still be there afterwards (docs/panes.md § Layout model).
  const [draft, setDraft] = createSignal('')
  persistDraft(() => deps.taskId, draft, setDraft, DRAFT_PREFIX)

  // The three options, for this visit only. Nothing about them is worth remembering: an amend is
  // about one commit, and a reader who skipped git's hooks once did it for a reason that has passed
  // by the next commit.
  const [amend, setAmend] = createSignal(false)
  const [signoff, setSignoff] = createSignal(false)
  const [noVerify, setNoVerify] = createSignal(false)
  const [committing, setCommitting] = createSignal(false)
  // A second busy verb beside `committing`, on the pattern `remoteBusy` set: the wand shows it and
  // nothing else in the footer needs to know, because a generate writes no file and blocks no commit.
  const [generating, setGenerating] = createSignal(false)
  // Whether the keys are in the message field, which is what the two chords are gated on. A signal
  // the field reports into rather than a question asked of the host: neither the DOM's
  // `document.activeElement` nor the terminal's region store is a plugin's to read.
  const [editorFocused, setEditorFocused] = createSignal(false)

  const mode = createMemo<CommitMode>(() => commitMode(deps.groups()))

  // Amend is a mode, not a verb: the menu item turns it on and the button below then reads Amend.
  // The prefill only ever lands in an empty field, so a reader who wrote a new message and then
  // decided to amend keeps what they wrote.
  async function toggleAmend(): Promise<void> {
    const next = !amend()
    setAmend(next)
    if (!next || draft().trim()) return
    const head = await deps.headCommit()
    // Asked again after the await, because the reader can type while the read is in flight and their
    // text wins over HEAD's.
    if (head && !draft().trim()) setDraft(head.message)
  }

  /**
   * Commit what the mode says, with the options the menu set.
   *
   * `all` is the one thing the client decides rather than the node: with nothing staged the button
   * reads Commit tracked and this sends `git commit -a`, so the node never has to guess which of the
   * two a bare commit meant.
   *
   * An amend runs even on a clean tree, which is how a message gets reworded. Every other mode with
   * nothing to commit is refused before the round trip.
   */
  async function commit(over: { amend?: boolean } = {}): Promise<void> {
    const message = draft().trim()
    const amending = over.amend ?? amend()
    if (!message || committing()) return
    if (mode() === 'none' && !amending) return
    setCommitting(true)
    const res = await deps.commit(message, {
      all: mode() === 'tracked',
      amend: amending,
      signoff: signoff(),
      noVerify: noVerify(),
    }).finally(() => setCommitting(false))
    // The draft survives a refusal, which is the point of a veto arriving as a reason rather than as
    // a silent failure: the reader fixes what the handler objected to and presses again.
    if (!res.ok) {
      deps.onError(res.reason ?? 'Commit failed.')
      return
    }
    deps.onError('')
    setDraft('')
    setAmend(false)
    await deps.onCommitted()
  }

  /** Turn amend on if it is off, then commit. One chord for the reader who knows they are amending
   *  and has not opened the menu. */
  async function amendCommit(): Promise<void> {
    if (!amend()) await toggleAmend()
    await commit({ amend: true })
  }

  /**
   * Put a provider-written message in the field.
   *
   * Through `setDraft`, which is the same door typed text uses, so the draft is persisted, the commit
   * button re-reads its own state, and `before-commit` sees a message with nothing special about it.
   * There is no second path to a commit.
   *
   * Whether it is safe to overwrite what is there is the button's question, not this one's: the wand
   * arms before it replaces a message somebody wrote (./GenerateButton.tsx).
   */
  async function generate(pick: CommitMessageRequest): Promise<void> {
    if (generating()) return
    setGenerating(true)
    deps.onError('')
    try {
      const result = await deps.commitMessage(pick)
      // A blank answer leaves the field alone. Whatever is in it was worth more than nothing, and a
      // provider that answered with whitespace has said nothing to put there.
      //
      // A real answer does overwrite, including text typed while the provider was working. That is
      // the one thing the wand asked about before it started (./GenerateButton.tsx), which is the
      // difference from `toggleAmend` above, where nobody was asked.
      if (result.message.trim()) setDraft(result.message)
    } catch (error) {
      deps.onError(generateReason(error))
    } finally {
      setGenerating(false)
    }
  }

  return {
    draft,
    setDraft,
    /** What the commit button does and says: the index, every tracked change, or nothing. */
    commitMode: mode,
    committing,
    amend,
    toggleAmend,
    signoff,
    setSignoff,
    noVerify,
    setNoVerify,
    editorFocused,
    setEditorFocused,
    /** Whether the button can do anything. An amend is allowed on a clean tree, because rewording
     *  HEAD is a commit with nothing new in it. */
    canCommit: () => !!draft().trim() && (amend() || mode() !== 'none'),
    commit,
    amendCommit,
    /** Whether a provider is writing a message. The wand's `busy`, and the one thing that makes it
     *  refuse a second press. */
    generating,
    generate,
  }
}
