// The agent conversation on one line of a change request: the agents plugin's card, with the line's
// notes as its opening messages. The change request's own diff draws it, and so does any tree that
// shows the request's lines, through the code host's `changeRequestLines` capability. Both build the
// same origin, so a line has one conversation wherever it's read.
import { createMemo, Show, type JSX } from 'solid-js'
import type { ChangeRequestLines } from '@acorn/plugin-api/client'
import { loadDiffLineContext, type DiffSource, type PinnedNote } from '@acorn/plugin-api/ui/diff'

/**
 * Where an agent conversation on a diff line came from. The same shape as the agents plugin's
 * `InlineDiffOrigin`, restated because a shared library can't import a plugin. The host passes the
 * agents plugin's capability, and assigning it here is what checks the two still agree.
 */
export type InlineOrigin = {
  kind: 'inline-diff'
  source: 'changes' | 'pull-request'
  taskId: string
  path: string
  side: 'old' | 'new'
  line: number
  patchKey: string
  quote: string
  scope?: 'staged' | 'unstaged'
  pull?: Pull
}

type Pull = { owner: string; repo: string; number: string }

/** The part of the agents plugin's inline diff surface the change request views use. */
export type InlineDiffSurface = {
  prime: (taskId: string) => void
  /** A session can also be a side question, which isn't about a diff line. */
  sessionsForTask: (
    taskId: string,
  ) => readonly { origin?: InlineOrigin | { kind: 'btw' } | null; archivedAt?: number | null }[]
  reportPatches: (
    scope: { taskId: string; source: 'pull-request'; pull: Pull },
    patches: Record<string, string | null>,
  ) => void
  Card: (props: {
    origin: InlineOrigin
    loadContext: () => Promise<string>
    onClose?: () => void
    notes?: readonly PinnedNote<JSX.Element>[]
  }) => JSX.Element
}

export const sameLine = (left: InlineOrigin, right: InlineOrigin): boolean =>
  left.taskId === right.taskId &&
  left.source === right.source &&
  left.path === right.path &&
  left.side === right.side &&
  left.line === right.line &&
  left.patchKey === right.patchKey &&
  left.pull?.owner === right.pull?.owner &&
  left.pull?.repo === right.pull?.repo &&
  left.pull?.number === right.pull?.number

/** The origin of the conversation on a line of a change request's file whose patch is `patchKey`. */
export const lineOrigin = (
  taskId: string,
  pull: Pull,
  patchKey: string,
  at: { path: string; side: 'old' | 'new'; line: number; quote: string },
): InlineOrigin => ({
  kind: 'inline-diff',
  source: 'pull-request',
  taskId,
  path: at.path,
  side: at.side,
  line: at.line,
  patchKey,
  quote: at.quote.slice(0, 2_000),
  pull,
})

/**
 * The card on one line: shown when the line has notes, a conversation, or `open`, as ✦ sets it.
 * `fallback` draws otherwise, and when there's no card at all, such as without the agents plugin or for
 * a line with no patch.
 */
export function LineConversation(props: {
  inline: InlineDiffSurface | undefined
  origin: InlineOrigin | null
  notes: readonly PinnedNote<JSX.Element>[]
  open: boolean
  onClose: () => void
  loadContext: () => Promise<string>
  fallback: JSX.Element
}) {
  // Memoised: read directly, every session update would rebuild the card and blur its textarea.
  const shown = createMemo(
    () => {
      const origin = props.origin
      const inline = props.inline
      if (!origin || !inline?.Card) return null
      if (props.open || props.notes.length) return origin
      const talked = inline
        .sessionsForTask(origin.taskId)
        .some(
          (session) =>
            session.origin?.kind === 'inline-diff' && sameLine(session.origin, origin) && !session.archivedAt,
        )
      return talked ? origin : null
    },
    null,
    { equals: (a, b) => a === b || (!!a && !!b && sameLine(a, b)) },
  )
  return (
    <Show when={shown()} keyed fallback={props.fallback}>
      {(origin) => {
        const Card = props.inline!.Card
        return <Card origin={origin} notes={props.notes} loadContext={props.loadContext} onClose={props.onClose} />
      }}
    </Show>
  )
}

/**
 * The cards a code host provides as `changeRequestLinesId(<its plugin id>)`, so a tree showing lines of
 * a task's change request draws the same conversations as the request's diff. `useDiff` reads the
 * task's change request and its diff, inside the component that draws the cards. The agent reads the
 * code around a line from that diff, not from the tree, so it gets the change request's own lines.
 */
export function changeRequestLines(options: {
  inline: () => InlineDiffSurface | undefined
  useDiff: (taskId: string) => { pull: () => Pull | null } & Pick<DiffSource, 'topology' | 'loadSegments'>
}): ChangeRequestLines {
  return {
    forTask: (taskId) => {
      options.inline()?.prime(taskId)
      const diff = options.useDiff(taskId)
      return (props) => {
        const origin = createMemo(() => {
          const pull = diff.pull()
          const patchKey = diff.topology()?.files.find((file) => file.path === props.path)?.patchKey
          return pull && patchKey ? lineOrigin(taskId, pull, patchKey, props) : null
        })
        const old = props.side === 'old'
        const row = () => ({
          kind: old ? ('delete' as const) : ('insert' as const),
          path: props.path,
          oldNo: old ? props.line : null,
          newNo: old ? null : props.line,
          raw: props.quote,
          toks: [],
        })
        return (
          <LineConversation
            inline={options.inline()}
            origin={origin()}
            notes={props.notes}
            open={props.open}
            onClose={props.onClose}
            loadContext={() => loadDiffLineContext(diff, row())}
            fallback={props.fallback}
          />
        )
      }
    },
  }
}
