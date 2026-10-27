import { createEffect, createMemo, createSignal, Show, type Component } from 'solid-js'
import { openPane } from '@acorn/plugin-api/client'
import { Alert, DiffPane } from '@acorn/plugin-api/ui'
import { loadDiffLineContext, type CodeRow, type DiffLineAnchor, type DiffSource } from '@acorn/plugin-api/ui/diff'
import type { Thread } from '../model/types'

// A change request's diff: the shared diff shell (client-core's DiffPane, docs/diff-rendering.md)
// filled in by the host. The host answers the shell's questions, which document, where its segments
// come from, and what a comment does. This adds what every code host does the same way: the threads
// in the shell's vocabulary, the warning that the host's file limit cut the list short, opening a line
// in the editor, and the agent conversation anchored to a line.
//
// The document is the host's, cut into segments with no patch text in it. The viewer asks for the
// segments it is near. Binary and too-large files have no patch; the shell renders a "No diff" row.

/**
 * Where an agent conversation on a diff line came from. The same shape as the agents plugin's
 * `InlineDiffOrigin`, restated because a shared library can't import a plugin. The host passes the
 * agents plugin's capability, and assigning it here is what checks the two still agree.
 */
type InlineOrigin = {
  kind: 'inline-diff'
  source: 'changes' | 'pull-request'
  taskId: string
  path: string
  side: 'old' | 'new'
  line: number
  patchKey: string
  quote: string
  scope?: 'staged' | 'unstaged'
  pull?: { owner: string; repo: string; number: string }
}

/** The part of the agents plugin's inline diff surface this view uses. */
export type InlineDiffSurface = {
  prime: (taskId: string) => void
  /** A session can also be a side question, which isn't about a diff line. */
  sessionsForTask: (
    taskId: string,
  ) => readonly { origin?: InlineOrigin | { kind: 'btw' } | null; archivedAt?: number | null }[]
  reportPatches: (
    scope: { taskId: string; source: 'pull-request'; pull: { owner: string; repo: string; number: string } },
    patches: Record<string, string | null>,
  ) => void
  Card: Component<{ origin: InlineOrigin; loadContext: () => Promise<string>; onClose?: () => void }>
}

const sameLine = (left: InlineOrigin, right: InlineOrigin): boolean =>
  left.taskId === right.taskId &&
  left.source === right.source &&
  left.path === right.path &&
  left.side === right.side &&
  left.line === right.line &&
  left.patchKey === right.patchKey &&
  left.pull?.owner === right.pull?.owner &&
  left.pull?.repo === right.pull?.repo &&
  left.pull?.number === right.pull?.number

export type ChangeRequestDiffSource = Omit<DiffSource, 'threads' | 'inlineChat' | 'openLine'> & {
  /** Threads already verified against this diff's revision (`inlineReviewThreads`). */
  threads: () => Thread[]
}

export function ChangeRequestDiff(props: {
  source: ChangeRequestDiffSource
  /** The task this diff is drawn in. Without one there is no editor to open and no agent to ask. */
  taskId?: string
  /** Which change request, as the agent conversation names it. `owner` is the repository namespace. */
  pull: { owner: string; repo: string; number: string }
  /** The agents plugin's inline diff surface, when it is running. */
  inline?: () => InlineDiffSurface | undefined
  /** The host's warning that its file limit cut the list short. */
  warning: () => string | null
  /** The `<pluginId>:diff-line` point other plugins mark lines through. */
  annotations: string
}) {
  const source = props.source
  const taskId = props.taskId
  const pull = props.pull
  const inline = () => props.inline?.()
  const topology = () => source.topology()

  createEffect(() => {
    if (taskId) inline()?.prime(taskId)
  })
  createEffect(() => {
    const files = topology()?.files
    if (taskId && files)
      inline()?.reportPatches(
        { taskId, source: 'pull-request', pull },
        Object.fromEntries(files.map((file) => [file.path, file.patchKey])),
      )
  })
  const [openInline, setOpenInline] = createSignal<InlineOrigin | null>(null)
  createEffect(() => {
    const opened = openInline()
    if (opened && topology()?.files.find((file) => file.path === opened.path)?.patchKey !== opened.patchKey)
      setOpenInline(null)
  })
  const inlineOrigin = (row: CodeRow): InlineOrigin | null => {
    if (!taskId) return null
    const patchKey = topology()?.files.find((file) => file.path === row.path)?.patchKey
    const line = row.kind === 'delete' ? row.oldNo : row.newNo
    if (!patchKey || line == null) return null
    return {
      kind: 'inline-diff',
      source: 'pull-request',
      taskId,
      path: row.path,
      side: row.kind === 'delete' ? 'old' : 'new',
      line,
      patchKey,
      quote: row.raw.slice(0, 2_000),
      pull,
    }
  }
  const inlineAnchors = createMemo<DiffLineAnchor[]>(() => {
    if (!taskId) return []
    const visible = (inline()?.sessionsForTask(taskId) ?? []).flatMap((session) => {
      const origin = session.origin
      if (
        origin?.kind !== 'inline-diff' ||
        origin.source !== 'pull-request' ||
        session.archivedAt ||
        origin.pull?.owner !== pull.owner ||
        origin.pull.repo !== pull.repo ||
        origin.pull.number !== pull.number
      )
        return []
      if (topology()?.files.find((file) => file.path === origin.path)?.patchKey !== origin.patchKey) return []
      return [{ path: origin.path, side: origin.side, line: origin.line }]
    })
    const opened = openInline()
    return opened ? [...visible, { path: opened.path, side: opened.side, line: opened.line }] : visible
  })

  const diffSource: DiffSource = {
    ...source,
    // The shell's vocabulary for a side.
    threads: () =>
      source.threads().map((thread) => ({
        ...thread,
        side: thread.side === 'old' ? 'LEFT' : thread.side === 'new' ? 'RIGHT' : null,
      })),
    ...(taskId
      ? {
          inlineChat: {
            anchors: inlineAnchors,
            open: (row: CodeRow) => setOpenInline(inlineOrigin(row)),
            render: (row: CodeRow) => {
              // Memoised: read directly, every session update would rebuild the card and blur its textarea.
              const shown = createMemo(
                () => {
                  const origin = inlineOrigin(row)
                  if (!origin || !inline()?.Card) return null
                  const exists = inline()
                    ?.sessionsForTask(taskId)
                    .some(
                      (session) =>
                        session.origin?.kind === 'inline-diff' &&
                        sameLine(session.origin, origin) &&
                        !session.archivedAt,
                    )
                  return exists || (openInline() && sameLine(openInline()!, origin)) ? origin : null
                },
                null,
                { equals: (a, b) => a === b || (!!a && !!b && sameLine(a, b)) },
              )
              return (
                <Show when={shown()} keyed>
                  {(origin) => {
                    const Card = inline()!.Card
                    return (
                      <Card
                        origin={origin}
                        loadContext={() => loadDiffLineContext(diffSource, row)}
                        onClose={() => setOpenInline(null)}
                      />
                    )
                  }}
                </Show>
              )
            },
          },
          openLine: (row: CodeRow) => {
            if (row.newNo == null) return
            openPane(taskId, 'editor', { kind: 'editor:reveal', path: row.path, line: row.newNo }, 'add')
          },
        }
      : {}),
  }

  // What another plugin knows about a line of this diff — coverage, a lint result — drawn under the
  // row it belongs to. The host fetches, batches and stamps; this only names the point
  // (docs/plugins/cooperative-extension-points.md § Cooperative extension points, the `annotation` kind).
  // A sibling of the pane rather than a wrapper: DiffPane is a fragment that fills its container, and
  // the warning stays above it whichever file is on screen.
  return (
    <>
      <Show when={props.warning()}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      <DiffPane source={diffSource} annotations={props.annotations} />
    </>
  )
}
