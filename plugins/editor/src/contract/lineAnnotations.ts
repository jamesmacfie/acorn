// `editor:line`: what other plugins know about the cursor line of a saved file, drawn after the end of
// that line (docs/editor/line-annotations.md). Line blame is the first contributor.

/** The qualified point id. Editor registers the bare `line` in its client half. */
export const EDITOR_LINE_POINT = 'editor:line'

/** The field order the host mints lookups in. `revision` is in the key so an answer about an older
 *  body of the file attaches to nothing. */
export const EDITOR_LINE_KEY = ['taskId', 'path', 'line', 'revision'] as const

/** `line` is one-based. `revision` is the SHA-256, in hex, of the file's exact UTF-8 bytes on disk,
 *  the same body hash line markers use. */
export type EditorLineAnnotationKey = { taskId: string; path: string; line: number; revision: string }
