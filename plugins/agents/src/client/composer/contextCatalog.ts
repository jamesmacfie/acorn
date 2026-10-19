import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import { agentContextContributions } from '@acorn/plugin-api/client'
import type {
  AgentContextCaptureScope,
  AgentContextContribution,
  AgentContextOption,
} from '@acorn/protocol/agentContext.ts'
import type { ContextCategory } from './contextReferences'

const SEARCH_DEBOUNCE_MS = 200

type Listing = { items?: AgentContextOption[]; error?: string; read: number }

/** A source's items for a query, as the composer last heard them. `items` is absent while loading. */
type ContextListing = { items?: readonly AgentContextOption[]; error?: string }

/**
 * The items each context source offers one composer, read on demand and kept for the session.
 *
 * A source that lists everything is read once per `refresh` and filtered by the composer. A source
 * that declares `search` is asked again for each query, after the typing pauses. Reading a listing
 * starts the read it needs, so the `#` list and the **Context** popover never ask for a source nobody
 * opened.
 */
export function createContextCatalog(scope: () => AgentContextCaptureScope) {
  const [listings, setListings] = createSignal<Record<string, Listing>>({})
  // Not reactive: which reads are in flight, so a listing asked for twice reads once.
  const pending = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let generation = 0
  let refreshed = 0

  const scopeKey = () => `${scope().taskId}:${scope().sessionId ?? ''}`
  createEffect(
    on(scopeKey, () => {
      generation++
      pending.clear()
      timers.forEach(clearTimeout)
      timers.clear()
      setListings({})
    }),
  )
  onCleanup(() => timers.forEach(clearTimeout))

  const keyFor = (contribution: AgentContextContribution, query: string) =>
    contribution.search ? `${contribution.keyword}\u0000${query}` : contribution.keyword

  const read = (contribution: AgentContextContribution, key: string, query: string) => {
    const started = generation
    const at = refreshed
    pending.add(key)
    contribution
      .options(scope(), contribution.search ? query : undefined)
      .then(
        (items): Listing => ({ items, read: at }),
        (caught: unknown): Listing => ({
          error: caught instanceof Error ? caught.message : `Unable to list ${contribution.label}.`,
          read: at,
        }),
      )
      .then((listing) => {
        if (started !== generation) return
        pending.delete(key)
        setListings((current) => ({ ...current, [key]: listing }))
      })
  }

  /** What `contribution` offers for `query`. Starts a read when there is nothing current to show. */
  const listing = (contribution: AgentContextContribution, query = ''): ContextListing => {
    const key = keyFor(contribution, query.trim())
    const known = listings()[key]
    if ((!known || known.read < refreshed) && !pending.has(key)) {
      if (!contribution.search) read(contribution, key, '')
      else {
        // One timer per source, so only the query the typing stopped on is sent.
        clearTimeout(timers.get(contribution.keyword))
        timers.set(
          contribution.keyword,
          setTimeout(() => {
            timers.delete(contribution.keyword)
            if (!pending.has(key)) read(contribution, key, query.trim())
          }, SEARCH_DEBOUNCE_MS),
        )
      }
    }
    // A stale list stays on screen until the fresh one lands, so tokens don't flicker uncoloured.
    return known?.error ? { error: known.error } : { items: known?.items }
  }

  return {
    contributions: agentContextContributions,
    listing,
    /** Lists already read, without starting any. What a hand-typed token can resolve against. */
    categories(): ContextCategory[] {
      const read = listings()
      return agentContextContributions().map((contribution) => ({
        keyword: contribution.keyword,
        label: contribution.label,
        itemless: contribution.itemless,
        // A searching source has no one list that holds everything. Its tokens resolve through the
        // draft's map, which completion writes.
        items: contribution.search ? undefined : read[contribution.keyword]?.items,
      }))
    },
    /** Read every list again the next time it is asked for. Called when the field takes focus. */
    refresh() {
      refreshed++
    },
  }
}

export type ContextCatalog = ReturnType<typeof createContextCatalog>
