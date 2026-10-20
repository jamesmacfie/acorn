// A data record's way into the editor pane: the content link kind, and its item, which names a
// task-relative path and a line. The line comes first, so a colon in the path can't split it.

export const EDITOR_FILE_TARGET = 'editor.file'

export const fileTargetItem = (path: string, line: number): string => `${line}:${path}`

export function parseFileTargetItem(item: string): { path: string; line: number } | null {
  const match = /^(\d+):(.+)$/.exec(item)
  return match ? { line: Number(match[1]), path: match[2]! } : null
}
