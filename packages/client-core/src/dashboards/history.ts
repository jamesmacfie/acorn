import { createMemo, type Accessor } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { dashboardHistoryRoute, type DashboardHistoryResponse } from '@acorn/protocol/api.ts'
import { TREND_DAYS, type MeasureSample } from '@acorn/dashboards-core/trend.ts'
import { readJson } from '../apiClient'
import { activeNodeId } from '../node/activeNode'

// A panel's recorded measure series, read from the node that stores it (docs/dashboards.md § Trends).
//
// Not through the panel's own fan-out, unlike its rows. The fan-out gives a collection read a deadline, a
// cache fallback and the live/stale/offline vocabulary, because those rows are what the panel is. A
// history series is a decoration on a number that has already rendered, so a node that can't answer for
// it simply draws no sparkline, and there's nothing here to badge stale.
//
// One reader, one query key, and the same node the rows came from: a trend beside a number fetched from
// a different machine would be two answers about two different worlds.

const DAY_MS = 86_400_000
/** One day past the drawn fortnight, so a `week` baseline sitting exactly on the 14-day floor is still
 *  in the answer (trend.ts § baselineValue searches back twice the window). */
const SINCE_MS = (TREND_DAYS + 1) * DAY_MS

/** The recorded series for one panel, or an empty one whenever it isn't asked for, isn't answered yet,
 *  or was answered with nothing. Emptiness is the cold state, not an error. */
export function createMeasureHistory(
  panelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>,
): Accessor<MeasureSample[]> {
  // Captured at creation, as `createPanelData` does: a node switch remounts this tree rather than
  // mutating it underneath.
  const nodeId = activeNodeId() ?? ''

  const query = createQuery(() => ({
    queryKey: ['dashboard-history', nodeId, panelId()],
    enabled: !!nodeId && !!panelId() && enabled(),
    // `since` is computed inside the fetch, never in the key: a clock reading in a query key mints a new
    // cache entry on every render and turns a fortnightly read into a poll.
    queryFn: () => readJson<DashboardHistoryResponse>(
      `${dashboardHistoryRoute}?panelId=${encodeURIComponent(panelId()!)}&since=${Date.now() - SINCE_MS}`,
      { nodeId },
    ),
    // The sampler writes hourly, so this is generous rather than lazy. Anything faster is a poll for a
    // number that can't have changed.
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
  }))

  return createMemo(() => query.data?.samples ?? [])
}
