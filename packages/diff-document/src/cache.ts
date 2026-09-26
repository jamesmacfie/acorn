import type { FileDocument } from './segment'

/**
 * Parsed files by patch digest, least recently used first out, bounded by the bytes their rows weigh.
 *
 * For a provider's node process, so a burst of segment requests against one large file parses its
 * patch once rather than once per batch. Keyed by content, so an entry can never be stale; it can only
 * be gone, and a miss parses again. The newest entry is kept even when it alone is over the budget,
 * because the request that parsed it is about to read it.
 */
export function documentCache(maxBytes: number) {
  const entries = new Map<string, FileDocument>()
  let bytes = 0
  return {
    get(key: string): FileDocument | undefined {
      const doc = entries.get(key)
      if (doc) {
        entries.delete(key)
        entries.set(key, doc)
      }
      return doc
    },
    set(key: string, doc: FileDocument): void {
      const previous = entries.get(key)
      if (previous) {
        bytes -= previous.bytes
        entries.delete(key)
      }
      entries.set(key, doc)
      bytes += doc.bytes
      for (const [oldest, entry] of entries) {
        if (bytes <= maxBytes || oldest === key) break
        entries.delete(oldest)
        bytes -= entry.bytes
      }
    },
    /** What is held, for a test. */
    stats: () => ({ entries: entries.size, bytes }),
  }
}

export type DocumentCache = ReturnType<typeof documentCache>
