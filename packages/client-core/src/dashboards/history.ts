import { createMemo, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { dashboardHistoryRoute, type DashboardHistoryResponse } from '@acorn/protocol/api.ts'
import { TREND_DAYS, type MeasureSample } from '@acorn/dashboards-core/trend.ts'
import { readJson } from '../apiClient'
import { activeNodeId } from '../node/activeNode'

// A panel's recorded measure series, read from the node that stores it (docs/dashboards.md § Trends).
//
// NOT through the panel's own fan-out, unlike its rows. The fan-out exists to give a collection read
// a deadline, a cache fallback and the live/stale/offline vocabulary, because those rows are what the
// panel IS — a history series is a decoration on a number that has already rendered, so a node that
// cannot answer for it simply draws no sparkline. There is nothing here to badge stale: every sample
// is by definition a thing the node knew at a moment that has passed.
//
// One reader, one query key, and the same node the rows came from — a trend beside a number fetched
// from a different machine would be two answers about two different worlds.

const DAY_MS = 86_400_000
/** One day past the drawn fortnight, so a `week` baseline sitting exactly on the 14-day floor is
 *  still in the answer (trend.ts § baselineValue searches back 2× the window). */
const SINCE_MS = (TREND_DAYS + 1) * DAY_MS

/** The recorded series for one panel, or an empty one whenever it is not asked for, not answered
 *  yet, or answered with nothing. Emptiness is the COLD STATE, not an error: a panel given a trend a
 *  minute ago has no samples and the stat says so rather than failing. */
export function createMeasureHistory(
  panelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>,
): Accessor<MeasureSample[]> {
  // Captured at creation, as `createPanelData` captures it and for the same reason: a node switch
  // remounts this tree rather than mutating it underneath.
  const nodeId = activeNodeId() ?? ''

  const query = createQuery(() => ({
    queryKey: ['dashboard-history', nodeId, panelId()],
    enabled: !!nodeId && !!panelId() && enabled(),
    // `since` is computed inside the fetch, never in the key: a clock reading in a query key mints a
    // new cache entry on every render and turns a fortnightly read into a poll.
    queryFn: () => readJson<DashboardHistoryResponse>(
      `${dashboardHistoryRoute}?panelId=${encodeURIComponent(panelId()!)}&since=${Date.now() - SINCE_MS}`,
      { nodeId },
    ),
    // The sampler writes hourly, so this is generous rather than lazy — anything faster is a poll for
    // a number that cannot have changed.
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
  }))

  return createMemo(() => query.data?.samples ?? [])
}
