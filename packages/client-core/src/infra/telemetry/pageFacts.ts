import type { QueryClient } from '@tanstack/solid-query'
import { segmentCaches } from '../../features/diff/segmentCaches'
import { emitMetric, telemetryEnabled } from './emitter'

// A few counts about the page, as gauges every thirty seconds (docs/telemetry/diagnosis.md § Diagnosing an
// unresponsive view). They sit beside the renderer's memory, which the shell measures from outside
// (docs/shell.md § What the shell reports), so a rise in one can be read against the other.
//
// Only while collecting and only while the page is visible. A hidden window runs at background
// priority, and a count taken there says more about the scheduler than about the page. Each read is
// a counter, one DOM call, or a copy of a short list. None of them walks the tree in script.

/** How often the page is counted. Memory moves over minutes. */
export const PAGE_FACTS_MS = 30_000

const readers = new Map<string, () => number>()

/**
 * Report a count the caller's module owns, such as how many workers it is running. Registered at
 * module load, so a module that never loaded has nothing to count and reports nothing. A second
 * registration under the same name replaces the first.
 */
export function registerPageFact(name: string, read: () => number): void {
  readers.set(name, read)
}

const gauge = (name: string, value: number, unit = '1'): void => {
  if (Number.isFinite(value) && value >= 0) emitMetric('core', { name, type: 'gauge', value, unit })
}

/** Count once now. Exposed for the test; the timer below is the caller in the app. */
export function samplePageFacts(activeClient: () => QueryClient): void {
  if (!telemetryEnabled() || document.visibilityState !== 'visible') return
  try {
    gauge('ui.page.elements', document.getElementsByTagName('*').length)
    // The kit's timeline marks each drawn turn with this class (kit/components/content/Timeline.tsx).
    // Most of them are agent transcript turns.
    gauge('ui.page.timeline_turns', document.getElementsByClassName('ui-timeline-turn').length)
    const client = activeClient()
    // Copies the cache's list of queries, which is pointers, a few thousand at most.
    gauge('ui.page.query_entries', client.getQueryCache().getAll().length)
    const diff = segmentCaches.get(client)?.stats()
    if (diff) {
      gauge('ui.page.diff_cache.rows', diff.rows)
      gauge('ui.page.diff_cache.bytes', diff.plainBytes + diff.enrichmentBytes, 'byte')
    }
  } catch {
    // A diagnostic must not fail the page it describes.
  }
  for (const [name, read] of readers) {
    try {
      gauge(name, read())
    } catch {
      // The same, and one broken reader does not cost the others.
    }
  }
}

/** Count the page on a timer until the returned function is called. Off, a tick is one boolean read. */
export function startPageFacts(activeClient: () => QueryClient): () => void {
  const timer = setInterval(() => samplePageFacts(activeClient), PAGE_FACTS_MS)
  return () => clearInterval(timer)
}

/** Test seam: forget every registered reader. */
export function _resetPageFacts(): void {
  readers.clear()
}
