// Other plugins' marks on the files Editor draws: tree rows and open tabs (docs/editor/file-annotations.md).
//
// The shared annotation host does the transport, validation, provenance and stale-answer rejection.
// This module only builds Editor's keys and draws what came back.
import { For, Show } from 'solid-js'
import { Icon, StatusDot } from '@acorn/plugin-api/ui'
import { annotationsFor, requestAnnotations } from '@acorn/plugin-api/ui/host'
import { HOST } from '@acorn/plugin-api/ui/tokens'
import { EDITOR_FILE_POINT, type EditorFileAnnotationKey } from '../contract/fileAnnotations'

export type FileMark = ReturnType<typeof annotationsFor>[number]

/** Glyphs drawn beside one file. Every mark stays in the legend, however many there are. */
const MAX_GLYPHS = 3

/** The severity mapping both hosts use, the same one the shared marks use. */
const FILE_MARK_TONE = { info: 'muted', warn: 'warn', danger: 'danger' } as const

/**
 * Ask every contributor about these files, in one request each.
 *
 * Call it from an effect: the host re-asks when a contributor, the Node or its freshness changes, and
 * a call with the same paths is a string compare. Paths are deduplicated, so a file shown in the tree
 * and in a tab is asked about once. No files asks nothing, because no row or tab could draw a mark.
 *
 * One batch per Editor pane, and one Editor pane per client. A second pane would replace this pane's
 * batch; merging every mount's paths here is the fix if that ever happens.
 */
export function requestFileAnnotations(taskId: string, paths: readonly string[]): void {
  if (!paths.length) return
  requestAnnotations(
    EDITOR_FILE_POINT,
    [...new Set(paths)].map((path): EditorFileAnnotationKey => ({ taskId, path })),
  )
}

export const fileMarks = (taskId: string, path: string): FileMark[] =>
  annotationsFor(EDITOR_FILE_POINT, { taskId, path } satisfies EditorFileAnnotationKey)

/** Every mark with the plugin that said it, for a tooltip or an accessible label. */
export const fileMarkLegend = (marks: readonly FileMark[]): string =>
  marks.map((mark) => `${mark.text} — ${mark.pluginId}`).join('; ')

/** The marks in the shape the kit's document tabs draw. */
export const tabMarks = (marks: readonly FileMark[]) =>
  marks.map((mark) => ({
    tone: FILE_MARK_TONE[mark.severity],
    label: `${mark.text} — ${mark.pluginId}`,
    ...(mark.icon ? { icon: mark.icon } : {}),
  }))

/** A few glyphs beside a tree row's name. Not focusable and not labelled: the row carries the legend. */
export function FileMarkGlyphs(props: { marks: readonly FileMark[] }) {
  return (
    <For each={props.marks.slice(0, MAX_GLYPHS)}>
      {(mark) => (
        // The terminal has a glyph for only some icon names, so it always draws a dot.
        <Show when={HOST === 'dom' && mark.icon} fallback={<StatusDot tone={FILE_MARK_TONE[mark.severity]} />}>
          {(name) => <Icon name={name()} tone={FILE_MARK_TONE[mark.severity]} />}
        </Show>
      )}
    </For>
  )
}
