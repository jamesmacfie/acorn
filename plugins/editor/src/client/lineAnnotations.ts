// Other plugins' marks on the cursor line (docs/editor/line-annotations.md).
//
// The shared annotation host does the transport, validation, provenance and stale-answer rejection.
// This module decides when to ask, which is once the cursor settles on a line of a saved document, and
// hands the answer to the owner to draw.
import { createEffect, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js'
import type { Text } from '@codemirror/state'
import { debounce, pluginLabel } from '@acorn/plugin-api/client'
import { annotationsFor, requestAnnotations } from '@acorn/plugin-api/ui/host'
import { EDITOR_LINE_POINT, type EditorLineAnnotationKey } from '../contract/lineAnnotations'
import type { LineAnnotationMark } from './lineAnnotationExtension'
import { markerRevision } from './markerRevision'

/** How long the cursor rests before Editor asks. Moving it hides the label at once. */
const LINE_ANNOTATION_DELAY_MS = 300

/** The shown file's cursor line and saved body. */
type CursorLine = { path: string; line: number; body: Text }

export type LineAnnotationInput = {
  taskId: string
  /** The device setting. A memo, because `on` re-fires on every read of an inline getter. */
  enabled: Accessor<boolean>
  /** Null when there's nothing to ask about: no graphical view, a dirty or saving document, or a
   *  selection over more than one line. */
  cursorLine: () => CursorLine | null
  /** Draw these marks on this line of this file, or clear the label with null. */
  draw: (annotation: { path: string; line: number; marks: LineAnnotationMark[] } | null) => void
}

const sameKey = (a: EditorLineAnnotationKey | null, b: EditorLineAnnotationKey): boolean =>
  !!a && a.path === b.path && a.line === b.line && a.revision === b.revision

export function createLineAnnotations(input: LineAnnotationInput) {
  const [key, setKey] = createSignal<EditorLineAnnotationKey | null>(null)
  // The body hash is a full read of the document, so it's kept for as long as the body is the same.
  let hashed: { body: Text; revision: Promise<string> } | undefined

  const ask = async () => {
    const cursor = input.enabled() ? input.cursorLine() : null
    if (!cursor) return
    if (hashed?.body !== cursor.body) hashed = { body: cursor.body, revision: markerRevision(cursor.body.toString()) }
    const revision = await hashed.revision.catch(() => null)
    const now = input.enabled() ? input.cursorLine() : null
    if (!revision || !now || now.path !== cursor.path || now.line !== cursor.line || now.body !== cursor.body) return
    const next = { taskId: input.taskId, path: cursor.path, line: cursor.line, revision }
    // A save that changed nothing, or a settle with the cursor still, keeps the label and its tooltip.
    if (!sameKey(key(), next)) setKey(next)
  }
  const settle = debounce(() => void ask(), LINE_ANNOTATION_DELAY_MS)
  onCleanup(() => settle.cancel())

  createEffect(() => {
    const current = key()
    if (!current) return
    requestAnnotations(EDITOR_LINE_POINT, [current])
    const marks = annotationsFor(EDITOR_LINE_POINT, current).map((mark): LineAnnotationMark => ({
      text: mark.text,
      credit: pluginLabel(mark.pluginId),
      ...(mark.detail ? { detail: mark.detail } : {}),
    }))
    untrack(() => input.draw({ path: current.path, line: current.line, marks }))
  })

  createEffect(
    on(
      input.enabled,
      (enabled) => {
        if (enabled) return settle()
        settle.cancel()
        setKey(null)
        input.draw(null)
      },
      { defer: true },
    ),
  )

  return {
    /** The cursor moved, the text changed, or another file is on screen: forget the line and ask
     *  again once the cursor settles. The label itself is hidden by the editor state. */
    moved: () => {
      setKey(null)
      settle()
    },
    /** The saved body may have changed under a cursor that didn't move, such as after autosave. */
    settle: () => settle(),
  }
}
