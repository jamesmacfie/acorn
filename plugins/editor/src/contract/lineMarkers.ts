import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

/** The two independent questions the editor can answer about a displayed line. */
export type EditorLineMarkerKind = 'pull-request' | 'uncommitted'

/** Inclusive, one-based line numbers in the document currently on disk. */
export type EditorLineRange = { from: number; to: number }

export type EditorLineMarkerSet = {
  kind: EditorLineMarkerKind
  ranges: EditorLineRange[]
}

/**
 * One optional source of line provenance. Providers own their source data and return positions in the
 * current working-tree document, so the editor never needs to know which plugin supplied them.
 */
export type EditorLineMarkerProvider = {
  kind: EditorLineMarkerKind
  read(taskId: string, path: string): Promise<EditorLineRange[]>
}

export const EDITOR_LINE_MARKERS = extensionPointId<EditorLineMarkerProvider>('editor:line-markers')

export const isEditorRelativePath = (path: string): boolean =>
  typeof path === 'string'
  && !!path
  && !path.startsWith('/')
  && !path.startsWith('-')
  && !path.split('/').includes('..')
  && !path.includes('\0')

export type UnifiedDiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm

/** Parse only unified-diff coordinates. File bodies never enter the marker contract. */
export function unifiedDiffHunks(patch: string): UnifiedDiffHunk[] {
  const hunks: UnifiedDiffHunk[] = []
  for (const match of patch.matchAll(HUNK_HEADER)) {
    hunks.push({
      oldStart: Number(match[1]),
      oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] === undefined ? 1 : Number(match[4]),
    })
  }
  return hunks
}

export function normalizedLineRanges(ranges: readonly EditorLineRange[]): EditorLineRange[] {
  const sorted = ranges
    .filter((range) => Number.isInteger(range.from) && Number.isInteger(range.to) && range.from > 0 && range.to >= range.from)
    .map((range) => ({ ...range }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  const out: EditorLineRange[] = []
  for (const range of sorted) {
    const previous = out[out.length - 1]
    if (previous && range.from <= previous.to + 1) previous.to = Math.max(previous.to, range.to)
    else out.push(range)
  }
  return out
}

/** With zero context, each new-side hunk range is exactly the changed line run. */
export function changedLineRanges(patch: string): EditorLineRange[] {
  return normalizedLineRanges(unifiedDiffHunks(patch).flatMap((hunk) => hunk.newLines > 0
    ? [{ from: hunk.newStart, to: hunk.newStart + hunk.newLines - 1 }]
    : []))
}

const intersections = (
  ranges: readonly EditorLineRange[],
  from: number,
  to: number,
): EditorLineRange[] => {
  if (to < from) return []
  return ranges.flatMap((range) => {
    const start = Math.max(range.from, from)
    const end = Math.min(range.to, to)
    return start <= end ? [{ from: start, to: end }] : []
  })
}

/**
 * Move line ranges expressed against HEAD through a zero-context HEAD-to-worktree diff.
 *
 * Unchanged spans retain exact identity. If a local replacement overlaps a marked HEAD line, the
 * replacement's whole new run remains marked; that is the only honest mapping when several old lines
 * become a differently sized block. Pure local insertions shift later markers without acquiring the
 * pull-request marker themselves, and locally deleted marked lines disappear.
 */
export function translateLineRanges(
  ranges: readonly EditorLineRange[],
  worktreePatch: string,
): EditorLineRange[] {
  const source = normalizedLineRanges(ranges)
  if (!source.length) return []
  const translated: EditorLineRange[] = []
  let oldCursor = 1
  let newCursor = 1

  for (const hunk of unifiedDiffHunks(worktreePatch)) {
    // A zero-old-lines hunk inserts after oldStart, so that anchor line belongs to the unchanged span.
    const unchangedOldTo = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1
    for (const range of intersections(source, oldCursor, unchangedOldTo)) {
      translated.push({
        from: newCursor + (range.from - oldCursor),
        to: newCursor + (range.to - oldCursor),
      })
    }

    if (hunk.oldLines > 0 && hunk.newLines > 0) {
      const changedOldTo = hunk.oldStart + hunk.oldLines - 1
      if (intersections(source, hunk.oldStart, changedOldTo).length) {
        translated.push({ from: hunk.newStart, to: hunk.newStart + hunk.newLines - 1 })
      }
    }

    oldCursor = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart + hunk.oldLines
    // Like a zero-old-lines insertion, a zero-new-lines deletion is anchored on the preceding line.
    // The next unchanged new-side line therefore starts one line after newStart.
    newCursor = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart + hunk.newLines
  }

  const lastLine = source[source.length - 1]!.to
  for (const range of intersections(source, oldCursor, lastLine)) {
    translated.push({
      from: newCursor + (range.from - oldCursor),
      to: newCursor + (range.to - oldCursor),
    })
  }
  return normalizedLineRanges(translated)
}
