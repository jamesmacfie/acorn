import { createEffect, createMemo, createSignal, For, mapArray, Show, type JSX } from 'solid-js'
import { openPane } from '@acorn/plugin-api/client'
import { Alert, DiffPane } from '@acorn/plugin-api/ui'
import { DiffNoteCard } from '@acorn/plugin-api/ui/host'
import {
  loadDiffLineContext,
  type CodeRow,
  type DiffLineAnchor,
  type DiffSource,
  type PinnedNote,
} from '@acorn/plugin-api/ui/diff'
import type { Thread } from '../model/types'
import { LineConversation, lineOrigin, sameLine, type InlineDiffSurface, type InlineOrigin } from './lineConversation'

// A change request's diff: the shared diff shell (client-core's DiffPane, docs/diff-rendering.md)
// filled in by the host. The host answers the shell's questions, which document, where its segments
// come from, and what a comment does. This adds what every code host does the same way: the threads
// in the shell's vocabulary, the warning that the host's file limit cut the list short, opening a line
// in the editor, and the agent conversation anchored to a line, which a mark that's a note opens with.
//
// The document is the host's, cut into segments with no patch text in it. The viewer asks for the
// segments it is near. Binary and too-large files have no patch; the shell renders a "No diff" row.

const TONE = { info: 'neutral', warn: 'warn', danger: 'danger' } as const

/** A mark that's a note, as the line's card draws it: the mark's text as the title, its detail as the
 *  body. Its fold is this view's. */
function markNote(
  row: CodeRow,
  mark: {
    pluginId: string
    severity: keyof typeof TONE
    text: string
    note?: { author: string; label: string }
    detail?: { value: string }
  },
): PinnedNote<JSX.Element> {
  const [folded, setFolded] = createSignal(false)
  return {
    props: {
      side: row.kind === 'delete' ? 'old' : 'new',
      line: (row.kind === 'delete' ? row.oldNo : row.newNo) ?? 0,
      tone: TONE[mark.severity],
      title: mark.text,
      from: mark.pluginId,
      ...(mark.note ? { author: mark.note.author, label: mark.note.label } : {}),
      ...(mark.detail ? { body: mark.detail.value } : {}),
    },
    folded,
    setFolded,
  }
}

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
  // The line whose card the reader opened with ✦.
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
    return lineOrigin(taskId, pull, patchKey, {
      path: row.path,
      side: row.kind === 'delete' ? 'old' : 'new',
      line,
      quote: row.raw,
    })
  }
  const opened = (row: CodeRow): boolean => {
    const open = openInline()
    const origin = inlineOrigin(row)
    return !!open && !!origin && sameLine(open, origin)
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
            render: (row, marks) => {
              const notes = createMemo(mapArray(marks, (mark) => markNote(row, mark)))
              const fallback = <For each={notes()}>{(note) => <DiffNoteCard note={note} />}</For>
              return (
                <LineConversation
                  inline={inline()}
                  origin={inlineOrigin(row)}
                  notes={notes()}
                  open={opened(row)}
                  onClose={() => setOpenInline(null)}
                  loadContext={() => loadDiffLineContext(diffSource, row)}
                  fallback={fallback}
                />
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
  // Each key names the task, so a mark answered for one task's diff never draws on another's. A diff
  // browsed outside a task asks with an empty one.
  // A sibling of the pane rather than a wrapper: DiffPane is a fragment that fills its container, and
  // the warning stays above it whichever file is on screen.
  return (
    <>
      <Show when={props.warning()}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      <DiffPane source={diffSource} annotations={props.annotations} annotationKeyFields={{ task: taskId ?? '' }} />
    </>
  )
}
