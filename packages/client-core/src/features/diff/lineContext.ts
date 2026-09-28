import type { CodeRow } from '../../kit/diff/diffModel'
import type { DiffSource } from './source'
import type { PlainCodeRow } from '@acorn/diff-document/document'

/** A bounded excerpt from the one segment containing a clicked code line. */
export async function loadDiffLineContext(source: DiffSource, row: CodeRow): Promise<string> {
  const file = source.topology()?.files.find((candidate) => candidate.path === row.path)
  if (!file?.patchKey) return row.raw
  const side = row.kind === 'delete' ? 0 : 2
  const line = row.kind === 'delete' ? row.oldNo : row.newNo
  if (line == null) return row.raw
  const ordinal = file.segments.findIndex((segment) => {
    const first = segment.lines[side]!
    const last = segment.lines[side + 1]!
    return first > 0 && first <= line && line <= last
  })
  if (ordinal < 0) return row.raw
  const [payload] = await source.loadSegments([{ path: row.path, patchKey: file.patchKey, ordinal }], new AbortController().signal)
  const code = (payload?.rows ?? []).filter((item): item is PlainCodeRow => item.kind === 'normal' || item.kind === 'insert' || item.kind === 'delete')
  const at = code.findIndex((item) => (side === 0 ? item.oldNo : item.newNo) === line)
  if (at < 0) return row.raw
  return code.slice(Math.max(0, at - 3), at + 4).map((item) =>
    `${item.kind === 'insert' ? '+' : item.kind === 'delete' ? '-' : ' '}${item.oldNo ?? ''}:${item.newNo ?? ''} ${item.raw}`,
  ).join('\n')
}
