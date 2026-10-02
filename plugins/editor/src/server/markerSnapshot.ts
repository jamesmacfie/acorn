import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { normalizedLineRanges, type EditorLineMarkerProvider, type EditorLineMarkerSet, type EditorLineMarkerSnapshot } from '../contract/lineMarkers'

export async function readMarkerProviders(
  providers: readonly EditorLineMarkerProvider[], taskId: string, path: string, root: string,
): Promise<EditorLineMarkerSet[]> {
  const settled = await Promise.allSettled(providers.map(async (provider): Promise<EditorLineMarkerSet> => ({
    kind: provider.kind,
    ranges: normalizedLineRanges(await provider.read(taskId, path, { root })),
  })))
  const byKind = new Map<EditorLineMarkerSet['kind'], EditorLineMarkerSet['ranges']>()
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue // Provenance is optional presentation.
    byKind.set(result.value.kind, normalizedLineRanges([
      ...(byKind.get(result.value.kind) ?? []),
      ...result.value.ranges,
    ]))
  }
  return [...byKind].map(([kind, ranges]) => ({ kind, ranges }))
}

const identity = (s: BigIntStats): string =>
  [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':')

async function observe(path: string) {
  const file = await open(path, 'r')
  try {
    const before = identity(await file.stat({ bigint: true }))
    const bytes = await file.readFile()
    const after = identity(await file.stat({ bigint: true }))
    if (before !== after) return null
    return { identity: after, revision: createHash('sha256').update(bytes).digest('hex') }
  } finally { await file.close() }
}

/** Byte identity rejects restored-mtime edits; ctime and inode also reject ordinary write/restore races. */
export async function markerSnapshot(
  resolve: () => Promise<{ root: string; abs: string }>,
  expected: string,
  read: (root: string) => Promise<EditorLineMarkerSnapshot['markers']>,
): Promise<EditorLineMarkerSnapshot> {
  const stale: EditorLineMarkerSnapshot = { revision: null, markers: [] }
  const source = await resolve()
  const before = await observe(source.abs).catch(() => null)
  if (!before || before.revision !== expected) return stale
  const markers = await read(source.root)
  const target = await resolve()
  if (source.root !== target.root || source.abs !== target.abs) return stale
  const after = await observe(target.abs).catch(() => null)
  if (!after || after.revision !== before.revision || after.identity !== before.identity) return stale
  return { revision: before.revision, markers }
}
