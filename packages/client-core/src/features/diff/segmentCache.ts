import type { QueryClient } from '@tanstack/solid-query'
import { recordSample } from '../../infra/telemetry/emitter'
import { isCodeRow, type DiffRow } from '../../kit/diff/diffModel'

// The node's recently read diff segments, held in memory so returning to a diff paints its rows at
// once (docs/diff-rendering.md § Resident segments).
//
// One cache per query client, which is one per node: the same partition, and the same lifetime, as
// everything else the renderer holds for a node. A pane mounts, reads from it and writes to it, and
// leaves it behind when it unmounts. Removing the node clears it (infra/node/fleet.ts § dropNode).
// Nothing here is ever written to disk.
//
// An entry is one segment of one file: its plain rows, and its coloured rows once colour arrives.
// The two are weighed apart, so colour can be let go before the plain rows that first paint needs.
// The bound is weight, not a count of diffs: rows and estimated bytes, each with its own ceiling. The
// least recently wanted segment goes first, and never one a pane is showing, near, or loading.

/** Rows held across every diff on the node. About six of the largest pull requests anyone reviews;
 *  the segments on screen and near it are a few hundred. */
export const SEGMENT_CACHE_ROWS = 40_000
/** Estimated bytes held, plain and coloured together. */
export const SEGMENT_CACHE_BYTES = 32 * 1024 * 1024

// The estimator's allowances. A budget, not the engine's heap: an object's fields, an array's header
// and a string's two bytes a character, counted the same way every time. Strings rows share, the
// path and the raw text a plain token points at, are counted once.
const ROW_BYTES = 64
const ARRAY_BYTES = 16
const TOKEN_BYTES = 48
const text = (value: string) => value.length * 2

/** What a segment's plain rows weigh: each row, its text, and the one plain token over that text. */
export function plainWeight(rows: readonly DiffRow[]): number {
  let bytes = ARRAY_BYTES
  for (const row of rows) {
    bytes += ROW_BYTES
    if (isCodeRow(row)) bytes += text(row.raw) + ARRAY_BYTES + TOKEN_BYTES
    else if (row.kind === 'hunk') bytes += text(row.text)
  }
  return bytes
}

/** What colouring adds on top: a copy of each code row, its tokens with their text and colours, and
 *  its word spans. */
export function enrichmentWeight(rows: readonly DiffRow[]): number {
  let bytes = ARRAY_BYTES
  for (const row of rows) {
    if (!isCodeRow(row)) continue
    bytes += ROW_BYTES + ARRAY_BYTES
    for (const tok of row.toks) bytes += TOKEN_BYTES + text(tok.content) + text(tok.light) + text(tok.dark)
    if (row.words) {
      bytes += ARRAY_BYTES
      for (const word of row.words) bytes += TOKEN_BYTES + text(word.content)
    }
  }
  return bytes
}

/**
 * A segment's key in the cache: its content key, which is the patch digest, the parser version and
 * the ordinal, plus the path and sha its rows are built with. The path picks the grammar and the sha
 * is what a gap reads the file through, so two files with the same patch never share rows.
 *
 * Nothing else goes in. Rows are a pure function of these, so the same key on any source of the node
 * is the same rows; review threads and theme are not inputs (tokens carry both themes' colours).
 */
export const residentKey = (contentKey: string, path: string, sha: string | null): string => `${contentKey}\u0000${path}\u0000${sha ?? ''}`

/** `provisional` colour is a fallback after the highlight worker timed out: drawn, but a later pane
 *  colours the segment again rather than take it as final. */
export type ResidentSegment = { plain: readonly DiffRow[]; enriched: readonly DiffRow[] | null; provisional: boolean }

export type EvictReason = 'budget' | 'superseded' | 'node-drop'

type Entry = {
  path: string
  patchKey: string
  plain: DiffRow[]
  enriched: DiffRow[] | null
  provisional: boolean
  rows: number
  plainBytes: number
  enrichmentBytes: number
}

type Holder = { keys: ReadonlySet<string>; changed: (key: string) => void }

/** A pane's claim on the segments it is showing, near, or loading. */
export type SegmentHolder = {
  /** Replace the held set. Anything no longer held becomes evictable at once. */
  hold: (keys: ReadonlySet<string>) => void
  release: () => void
  /**
   * The pane's file moved on from this patch, the way a working tree's does on every save: its
   * segments can never be asked for again, so they go now rather than wait for the budget. The
   * pane's own claim does not keep them, since it still names the old revision until its next
   * demand; another pane's does.
   */
  supersede: (path: string, patchKey: string) => void
}

export function createSegmentCache(limits: { rows: number; bytes: number } = { rows: SEGMENT_CACHE_ROWS, bytes: SEGMENT_CACHE_BYTES }) {
  // Oldest first: a Map iterates in insertion order, and a touch re-inserts.
  const entries = new Map<string, Entry>()
  const holders = new Set<Holder>()
  let rows = 0
  let plainBytes = 0
  let enrichmentBytes = 0
  let inserts = 0
  let evictions = 0
  let oversize = 0

  const over = () => rows > limits.rows || plainBytes + enrichmentBytes > limits.bytes
  const held = (key: string, except?: Holder) => {
    for (const holder of holders) if (holder !== except && holder.keys.has(key)) return true
    return false
  }
  const changed = (key: string) => {
    for (const holder of holders) holder.changed(key)
  }

  const evicted = { segments: 0, rows: 0, bytes: 0 }
  const remove = (key: string, entry: Entry) => {
    entries.delete(key)
    rows -= entry.rows
    plainBytes -= entry.plainBytes
    enrichmentBytes -= entry.enrichmentBytes
    evictions++
    evicted.segments++
    evicted.rows += entry.rows
    evicted.bytes += entry.plainBytes + entry.enrichmentBytes
    changed(key)
  }
  // Counts and weights only, and a fixed reason: no key, path or revision leaves here.
  const reportEvicted = (reason: EvictReason) => {
    if (!evicted.segments) return
    recordSample('core', 'diff.segment_cache.evict', evicted.segments, '1', { reason })
    recordSample('core', 'diff.segment_cache.evicted_rows', evicted.rows, '1', { reason })
    recordSample('core', 'diff.segment_cache.evicted_bytes', evicted.bytes, '1', { reason })
    evicted.segments = evicted.rows = evicted.bytes = 0
  }

  // Least recently wanted first. A segment's colour goes before its plain rows, and only if that is
  // not enough do the rows go too. Held segments stay, even when that leaves the cache over.
  const trim = () => {
    if (!over()) return
    for (const [key, entry] of entries) {
      if (!over()) break
      if (held(key)) continue
      if (entry.enriched) {
        enrichmentBytes -= entry.enrichmentBytes
        entry.enriched = null
        entry.provisional = false
        entry.enrichmentBytes = 0
        changed(key)
        if (!over()) break
      }
      remove(key, entry)
    }
    reportEvicted('budget')
  }

  const stats = () => {
    const documents = new Set<string>()
    for (const entry of entries.values()) documents.add(entry.patchKey)
    return {
      documents: documents.size,
      segments: entries.size,
      rows,
      plainBytes,
      enrichmentBytes,
      inserts,
      evictions,
      oversize,
      rowCeiling: limits.rows,
      byteCeiling: limits.bytes,
    }
  }

  const reportResident = () => {
    const now = stats()
    recordSample('core', 'diff.segment_cache.documents', now.documents)
    recordSample('core', 'diff.segment_cache.segments', now.segments)
    recordSample('core', 'diff.segment_cache.rows', now.rows)
    recordSample('core', 'diff.segment_cache.plain_bytes', now.plainBytes)
    recordSample('core', 'diff.segment_cache.enrichment_bytes', now.enrichmentBytes)
  }

  return {
    /** A segment's rows, without counting as a use. For drawing, which reads far more often than a
     *  reader moves. */
    peek: (key: string): ResidentSegment | undefined => entries.get(key),
    has: (key: string): boolean => entries.has(key),
    /** Mark these as just wanted, so they are the last to go. Once per range change, not per row. */
    touch: (keys: Iterable<string>) => {
      for (const key of keys) {
        const entry = entries.get(key)
        if (!entry) continue
        entries.delete(key)
        entries.set(key, entry)
      }
    },
    /**
     * Plain rows that just arrived, one batch at a time. The caller holds them first, so the batch
     * cannot evict itself before it is drawn. A batch that leaves the cache over its ceilings with
     * nothing left to evict is the oversize case: it stays while it is held and goes when it is not.
     */
    insert: (batch: readonly { key: string; path: string; patchKey: string; plain: DiffRow[] }[]) => {
      let added = 0
      for (const item of batch) {
        // Two panes can ask for the same segment at once. Rows are a pure function of the key, so the
        // entry already held stays, with any colour it has; replacing it would grey out a segment
        // another pane is showing until that pane next asks for colour.
        if (entries.has(item.key)) continue
        const entry: Entry = {
          path: item.path,
          patchKey: item.patchKey,
          plain: item.plain,
          enriched: null,
          provisional: false,
          rows: item.plain.length,
          plainBytes: plainWeight(item.plain),
          enrichmentBytes: 0,
        }
        entries.set(item.key, entry)
        rows += entry.rows
        plainBytes += entry.plainBytes
        added++
      }
      if (!added) return
      inserts += added
      recordSample('core', 'diff.segment_cache.insert', added)
      trim()
      if (over()) {
        oversize++
        recordSample('core', 'diff.segment_cache.oversize', 1)
      }
      reportResident()
    },
    /** Coloured rows for a segment, kept only if it still holds the plain rows they were built from. */
    enrich: (key: string, from: readonly DiffRow[], enriched: DiffRow[], provisional = false): boolean => {
      const entry = entries.get(key)
      if (!entry || entry.plain !== from) return false
      enrichmentBytes -= entry.enrichmentBytes
      entry.enriched = enriched
      entry.provisional = provisional
      entry.enrichmentBytes = enrichmentWeight(enriched)
      enrichmentBytes += entry.enrichmentBytes
      trim()
      return true
    },
    /** A claim for one pane. `changed` hears about any segment that lost its rows or its colour. */
    holder: (onChanged: (key: string) => void): SegmentHolder => {
      const holder: Holder = { keys: new Set(), changed: onChanged }
      holders.add(holder)
      return {
        hold: (keys) => {
          holder.keys = keys
          trim()
        },
        release: () => {
          holders.delete(holder)
          trim()
        },
        supersede: (path, patchKey) => {
          for (const [key, entry] of entries) {
            if (entry.path === path && entry.patchKey === patchKey && !held(key, holder)) remove(key, entry)
          }
          reportEvicted('superseded')
        },
      }
    },
    /** Everything, now. The node is gone. */
    clear: () => {
      for (const [key, entry] of entries) remove(key, entry)
      reportEvicted('node-drop')
      holders.clear()
    },
    stats,
  }
}

export type SegmentCache = ReturnType<typeof createSegmentCache>

// Keyed by the query client rather than by node id, so a pane reads the partition it is already
// drawing from, the provider's, and two nodes cannot share one by construction.
const caches = new WeakMap<QueryClient, SegmentCache>()

export function segmentCacheFor(client: QueryClient): SegmentCache {
  let cache = caches.get(client)
  if (!cache) caches.set(client, (cache = createSegmentCache()))
  return cache
}

/** Forget a node's segments, synchronously. Called with the rest of the node's cache. */
export function dropSegmentCache(client: QueryClient): void {
  caches.get(client)?.clear()
  caches.delete(client)
}
