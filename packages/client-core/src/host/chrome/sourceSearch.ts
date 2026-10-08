import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { PluginRailItem, PluginSourceDescriptor } from '@acorn/protocol/api.ts'
import {
  DEFAULT_COMMAND_SEARCH_DEBOUNCE_MS,
  DEFAULT_COMMAND_SEARCH_MIN_QUERY,
  MAX_COMMAND_SEARCH_QUERY,
} from '@acorn/protocol/commands.ts'
import { debounce } from '../../kit/lib/state/debounce'
import { chromeSearchKey, readRailSearch } from './chromeData'
import { filterSourceItems } from './sourceFilter'

// The Search field above a descriptor source's rail list, shared by the desktop and terminal hosts so
// both say the same thing at the same moment (docs/plugins/descriptors.md § Searching a source).
//
// Typing narrows the loaded rows at once. Once the text settles, a source with a `search` route asks
// the plugin, and the provider's answer replaces the local matches, because provider matching and a
// local substring are not the same rule. Until it answers, or if it fails, the local matches stay.

/**
 * - `idle`: no text, so the ordinary list.
 * - `local`: only the loaded rows were searched. The source has no route, or the text is too short.
 * - `searching`: local matches while the provider is asked.
 * - `done`: the provider's answer.
 * - `failed`: local matches, because the provider search failed.
 */
export type SourceSearchStatus = 'idle' | 'local' | 'searching' | 'done' | 'failed'

export type SourceSearch = {
  items: () => PluginRailItem[]
  status: () => SourceSearchStatus
  /** The provider holds more matches than it sent. */
  incomplete: () => boolean
}

export function createSourceSearch(input: {
  pluginId: string
  nodeId: string
  descriptor: () => PluginSourceDescriptor
  projectId: () => string | undefined
  /** The field's text. The caller passes '' while the list is hidden, so nothing searches unseen. */
  text: () => string
  loaded: () => PluginRailItem[]
}): SourceSearch {
  const text = () => input.text().trim()
  const outbound = () => {
    const query = text().slice(0, MAX_COMMAND_SEARCH_QUERY)
    return input.descriptor().search && query.length >= DEFAULT_COMMAND_SEARCH_MIN_QUERY ? query : ''
  }

  // The text the provider is asked about, which trails the field by the debounce. Clearing is
  // immediate, so an emptied field never waits to show its list.
  const [settled, setSettled] = createSignal('')
  const settle = debounce(setSettled, DEFAULT_COMMAND_SEARCH_DEBOUNCE_MS)
  onCleanup(settle.cancel)
  createEffect(() => {
    const query = outbound()
    if (query) settle(query)
    else {
      settle.cancel()
      setSettled('')
    }
  })

  // Keyed by project and text, so an answer for an earlier scope can never be drawn for this one, and
  // abandoned with its signal when the key moves on. Kept out of the persisted cache: a search is
  // asked again rather than restored as if it had just answered.
  const remote = createQuery(() => {
    const query = settled()
    const projectId = input.projectId()
    return {
      queryKey: chromeSearchKey(input.pluginId, input.descriptor().id, projectId, query),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readRailSearch(input.pluginId, input.descriptor().search!, input.nodeId, query, projectId, signal),
      enabled: !!query && query === outbound(),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
      meta: { persist: false },
    }
  })

  const local = createMemo(() => filterSourceItems(input.loaded(), text()))
  const status = (): SourceSearchStatus => {
    if (!text()) return 'idle'
    if (!outbound()) return 'local'
    if (settled() !== outbound() || remote.isPending) return 'searching'
    if (remote.isError) return 'failed'
    return 'done'
  }

  return {
    items: () => {
      if (!text()) return input.loaded()
      return status() === 'done' ? remote.data?.items ?? [] : local()
    },
    status,
    incomplete: () => status() === 'done' && !!remote.data?.incomplete,
  }
}

/** The line drawn above the rows while a search is not plainly finished, or undefined for none. */
export const sourceSearchNotice = (search: SourceSearch): string | undefined => {
  if (search.status() === 'searching') return 'Searching…'
  if (search.status() === 'failed') return "Couldn't search beyond the loaded rows."
  if (search.incomplete()) return 'More matches than shown. Add to the search to narrow it.'
  return undefined
}

/** What an empty result says. The source's own empty state describes an empty list, never a search. */
export const sourceSearchEmpty = (status: SourceSearchStatus): string => {
  if (status === 'searching') return 'Searching…'
  if (status === 'failed') return "No loaded rows match, and the search couldn't reach the provider."
  if (status === 'done') return 'No matches.'
  return 'Nothing matches that search.'
}
