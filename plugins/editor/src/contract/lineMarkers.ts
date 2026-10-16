import type { CoreServices } from '@acorn/plugin-api/node'
import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

/** The two independent questions the editor can answer about a displayed line. */
type EditorLineMarkerKind = 'pull-request' | 'uncommitted'

/** Inclusive, one-based line numbers in the document currently on disk. */
export type EditorLineRange = { from: number; to: number }

export type EditorLineMarkerSet = {
  kind: EditorLineMarkerKind
  ranges: EditorLineRange[]
}

/** Exact UTF-8 disk body for which these optional annotations were observed. */
export type EditorLineMarkerSnapshot = {
  revision: string | null
  markers: EditorLineMarkerSet[]
}

/**
 * One optional source of line provenance. Providers own their source data and return positions in the
 * current working-tree document, so the editor never needs to know which plugin supplied them.
 */
export type EditorLineMarkerProvider = {
  kind: EditorLineMarkerKind
  // The editor supplies an already confined root. Providers still resolve their own authority
  // and reject a different root; older loaded providers can ignore the optional third argument.
  read(taskId: string, path: string, source?: { root: string }): Promise<EditorLineRange[]>
}

export const EDITOR_LINE_MARKERS = extensionPointId<EditorLineMarkerProvider>('editor:line-markers')

export const isEditorRelativePath = (path: string): boolean =>
  typeof path === 'string' &&
  !!path &&
  !path.startsWith('/') &&
  !path.startsWith('-') &&
  !path.split('/').includes('..') &&
  !path.includes('\0')

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
    .filter(
      (range) => Number.isInteger(range.from) && Number.isInteger(range.to) && range.from > 0 && range.to >= range.from,
    )
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
  return normalizedLineRanges(
    unifiedDiffHunks(patch).flatMap((hunk) =>
      hunk.newLines > 0 ? [{ from: hunk.newStart, to: hunk.newStart + hunk.newLines - 1 }] : [],
    ),
  )
}

const intersections = (ranges: readonly EditorLineRange[], from: number, to: number): EditorLineRange[] => {
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
export function translateLineRanges(ranges: readonly EditorLineRange[], worktreePatch: string): EditorLineRange[] {
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

/** The two ends of a change request a marker provider compares: its target branch and its head
 *  commit, from the code host's mirror. `key` names the change request, so concurrent reads of one
 *  share their git work. */
export type ChangeRequestComparison = { key: string; baseRef: string; headSha: string }

type MarkerCore = Pick<CoreServices, 'tasks' | 'git'>
const GIT_SHA = /^[0-9a-f]{40}$/i

const gitText = async (core: MarkerCore, root: string, args: string[]): Promise<string | null> => {
  const result = await core.git.git(args, { cwd: root, timeoutMs: 15_000 })
  return result.code === 0 && !result.truncated ? result.stdout.trim() : null
}

async function comparisonBase(core: MarkerCore, root: string, baseRef: string): Promise<string | null> {
  const valid = await core.git.git(['check-ref-format', '--branch', baseRef], { cwd: root, timeoutMs: 10_000 })
  if (valid.code !== 0) return null
  for (const ref of [`refs/remotes/origin/${baseRef}`, `refs/heads/${baseRef}`, baseRef]) {
    const commit = await gitText(core, root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (commit && GIT_SHA.test(commit)) return commit
  }
  return null
}

/**
 * A code host's change request lines in the local working document. Both ends come from the host's
 * mirror. A second diff translates those head coordinates through later local commits and uncommitted
 * edits before they reach the editor, without treating unpushed commits as part of the change request.
 */
export const changeRequestLineMarkers = (
  core: MarkerCore,
  comparisonFor: (taskId: string) => Promise<ChangeRequestComparison | null>,
): EditorLineMarkerProvider => {
  // Only active resolutions join. Neither mutable refs nor rejected promises survive a wave.
  const waves = new Map<string, Promise<{ head: string; mergeBase: string } | null>>()
  const resolveComparison = async (root: string, headSha: string, baseRef: string) => {
    const [head, base] = await Promise.all([
      gitText(core, root, ['rev-parse', '--verify', '--quiet', `${headSha}^{commit}`]),
      comparisonBase(core, root, baseRef),
    ])
    if (!head || head.toLowerCase() !== headSha.toLowerCase() || !base) return null
    const mergeBase = await gitText(core, root, ['merge-base', head, base])
    return mergeBase && GIT_SHA.test(mergeBase) ? { head, mergeBase } : null
  }
  return {
    kind: 'pull-request',
    read: async (taskId, path, source) => {
      if (!isEditorRelativePath(path)) return []
      const [root, comparison] = await Promise.all([core.tasks.root(taskId), comparisonFor(taskId)])
      if (!root || !comparison?.baseRef || !comparison.headSha || !GIT_SHA.test(comparison.headSha)) return []
      if (source && source.root !== root) throw new Error('Marker worktree changed')
      const key = JSON.stringify([root, comparison.key, comparison.baseRef, comparison.headSha])
      let wave = waves.get(key)
      if (!wave) {
        wave = resolveComparison(root, comparison.headSha, comparison.baseRef).finally(() => {
          waves.delete(key)
        })
        waves.set(key, wave)
      }
      const resolved = await wave
      if (!resolved) return []
      const { head, mergeBase } = resolved
      const diff = (from: string, to?: string) =>
        gitText(core, root, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--unified=0',
          from,
          ...(to ? [to] : []),
          '--',
          `:(literal)${path}`,
        ])
      const [changePatch, worktreePatch] = await Promise.all([diff(mergeBase, head), diff(head)])
      // A failed translation cannot honestly reuse head coordinates in the working document.
      if (changePatch === null || worktreePatch === null) throw new Error('Marker comparison unavailable')
      return translateLineRanges(changedLineRanges(changePatch), worktreePatch)
    },
  }
}
