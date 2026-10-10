// `editor:file`: what other plugins know about a file Editor draws, as batched annotation marks
// (docs/editor/file-annotations.md).
//
// Separate from `editor:file-status` (./fileStatus.ts), which is Git's status read for the whole
// task, and from line markers (./lineMarkers.ts), which mark ranges inside one document.

/** The qualified point id. Editor registers the bare `file` in its client half. */
export const EDITOR_FILE_POINT = 'editor:file'

/** The field order the host mints lookups in. Task identity is in every key because one contributor
 *  may serve several Editor mounts; `path` is the case-preserving worktree-relative path. */
export const EDITOR_FILE_KEY = ['taskId', 'path'] as const

export type EditorFileAnnotationKey = { taskId: string; path: string }

/** Marks kept from one contributor for one batch. The rest are dropped with a warning. */
export const MAX_EDITOR_FILE_MARKS = 256
