// Search across core and plugins (docs/plugins.md § Search providers).
//
// Each provider searches its own data and answers with a short list of hits. Results stay grouped by
// provider: relevance scores from different indexes cannot be compared, so one merged ranking would
// be a guess.
import type { NoticeTarget } from '../chrome/notices'

export const searchRoute = '/v1/core/search'

/** One thing a provider found. `taskId` is null for a hit that belongs to no task. `target` uses the
 *  shapes notices use, so the client opens it through the same handler table. */
export type SearchHit = {
  taskId: string | null
  title: string
  preview: string
  target?: NoticeTarget
}

/** `timeout` and `failed` are a provider that could not answer, drawn as such rather than as an empty
 *  group that looks like "nothing matched". */
export type SearchGroup = {
  providerId: string
  label: string
  status: 'ok' | 'timeout' | 'failed'
  hits: SearchHit[]
}

export type SearchResponse = { groups: SearchGroup[] }

/** Shorter queries match too much to be useful and make the full-text providers rank every row. */
export const SEARCH_MIN_LENGTH = 3
