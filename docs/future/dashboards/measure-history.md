# Measure history: the store, and the stat that earns a trend

**Unbuilt.** The store and its feeder ride the scheduler: sampling is the `collection-sample`
target in [`docs/future/cron/targets.md`](../cron/targets.md), so this file waits on that folder's
phases 1–3 (`README.md § build order`). The display half (delta, sparkline) is dashboards phase 3
and waits on the store accruing samples.

*Design history, one line: an earlier revision of this file had clients sampling opportunistically
while panels rendered, with a PUT route and last-write-wins buckets to make multiple clients
converge. The scheduler obsoleted all of it — see Rejected alternatives.*

## The problem, stated honestly

The collections wire carries **current rows only**. A stat that says "6 open now" is derivable; a
stat that says "▲ 2 vs last week" is not, and neither is a sparkline of that measure over time —
there is no history anywhere in the system. Two ways to get one:

- **Ask plugins for history.** Refused. It grows the plugin contract with a time-series obligation
  every provider inherits forever (`refused.md § No new field type without a fight` is the same
  budget argument), most providers cannot answer it (GitHub does not serve "how many PRs were open
  last Tuesday"), and the invariant says the contract never grows to chase a use case.
- **The host records what it already knows, on a schedule.** Chosen. The node can read every
  collection through the plugin's own route (`../cron/targets.md § seam 1`), it stores the panel
  definitions, and the scheduler gives it a clock. Sampling is host machinery over existing reads,
  invisible to every plugin. It grows the **core node↔client contract** by one read route and the
  node's storage by one table — allowed, and exactly the split the invariant draws.

Two tiers fall out, and they are different features wearing one mark:

| Tier | Needs | Shows | Available |
| --- | --- | --- | --- |
| **Activity** | nothing new | rows bucketed by their own `updated`-role datetime, per day — the line chart's existing arithmetic (`chart.ts § dayBucket`) at sparkline size | the moment the rows arrive |
| **History** | this file's store | the panel's *measure* sampled over time — the number the stat shows, as it was | accrues from when the panel first asks for it |

Never blur them in the UI: activity is "when did these rows change", history is "what was this
number". The trend config below names which one a panel shows.

## Storage: node-side, its own table

**Not the `core.dashboards` prefs slice.** Three reasons, each sufficient: the slice has a 64KB cap
and history is unbounded-ish time-series; every sample would rewrite and re-sync the whole blob;
and old clients round-trip slices by re-writing what they parsed, which would make any old client a
history-eraser. History is **data with a retention policy, not preferences**.

It lives in the node's database because the sampler lives in the node, and it is machine-scoped
like every newer app-state table (the node is single-user — `node-core/server/db/schema.ts`'s own
note):

```ts
export const dashboardMeasureSamples = sqliteTable('dashboard_measure_samples', {
  panelId: text('panel_id').notNull(),
  signature: text('signature').notNull(),      // see invalidation, below
  bucket: integer('bucket').notNull(),          // UTC hour start, epoch ms
  value: real('value').notNull(),
  recordedAt: integer('recorded_at').notNull(),
}, (t) => [primaryKey({ columns: [t.panelId, t.bucket] })])
```

### The read route (core contract, additive)

- `GET /v2/core/dashboards/history?panelId=…&since=…` →
  `{ signature: string, samples: [{ bucket: number, value: number }] }`, ascending, capped at the
  retention window. Empty series → `{ signature: '', samples: [] }`, never 404: absence is data.
  Behind the existing `requireUser` gate.

There is **no write route**: the sampler and the store share a process. `removePanel` (definition
deletion, the armed one) deletes the series through the same core machinery; unplacing deletes
nothing — the definition survives and so does its history.

### Invalidation: the signature

A panel whose meaning changed must not keep its old trend — a filter added yesterday makes last
week's samples a lie. `signature` = a stable hash of the parts of the definition that change what
the measure *means*: `queries` (ids + params), `mapping` (columns + value maps + field maps),
`shaping.filters`, `view.aggregate`, `view.field`. Not the view kind, not sort/limit/projection,
not title, not geometry — those change presentation, not meaning.

The sampler computes the signature each pass; when it differs from the stored one, it **deletes
the series and starts the new one**. Drift is never papered over — the same posture as the
pinned-schema rule in `dynamic-collections.md`. The UI consequence is a trend that visibly restarts
("since 17 Aug"), which is honest.

### Caps and retention

- One sample per hour bucket per panel — the primary key makes finer granularity unrepresentable.
- Retention runs as its own schedule (`core:compact-history`, daily — `../cron/targets.md`):
  hourly samples kept 14 days; older buckets collapsed to one per UTC day (the day's last value —
  the stat shows point-in-time state, so last-known beats averaging); daily samples kept 400 days,
  then dropped.
- Hard cap ~1,000 rows per panel after compaction; a series at cap drops oldest first. The cap
  exists so nothing needs to trust that arithmetic.

## Sampling: the scheduler's pass

One core schedule (`core:sample-measures`, hourly, jittered) — the full mechanics, including the
node-side collection read seam and the shared measure pipeline it requires, are
[`../cron/targets.md § collection-sample`](../cron/targets.md). The rules that belong to *this*
feature:

- **Which panels:** every definition with `view.trend: 'history'` that is placed in at least one
  scope. Unplaced definitions don't sample — nothing renders them, and a trend nobody can see is
  cost without a reader. (Re-placing resumes; the gap is honest.)
- **Only complete answers sample.** A source that fails or is unavailable skips the panel for that
  pass — a partial union measures availability, not data; a mixed board missing GitHub would record
  a dip that never happened. Skips are visible in the schedule's run detail ("12 sampled, 2
  skipped: github unavailable").
- **The sampled value is the panel's measure** — `view.aggregate`/`view.field` over the
  post-filter, post-mapping rows, computed by the same shared pipeline the client renders with. One
  number per panel per bucket; the feature is a stat trend, not a metrics platform.
- **Freshness honesty:** the sample records what the plugin's route serves — its mirror, at its
  age. Sampling never forces revalidation; fresher unattended data is the plugin's own schedule to
  declare (`../cron/README.md § invariants`). The display copy must not claim more than "as the
  node knew it".
- **Gaps are data.** The node off overnight is a hole in the series, not a line to interpolate;
  the scheduler's no-backfill rule (`../cron/engine.md § catch-up`) guarantees at most one
  catch-up sample, honestly timestamped.

Nothing here touches plugin code, `@acorn/protocol/collections.ts`, or the client fetch paths.

## Display: the persisted keys and the marks

### `PanelView` grows three optional keys (additive, tolerant, no version bump)

```ts
// model.ts § PanelView — stat only; other kinds ignore them
trend?: 'history' | 'activity'
compare?: 'day' | 'week'
good?: 'up' | 'down'
```

- Codec: parsed exactly like `shape`/`x`/`series` — literal-checked, dropped when malformed. The
  honest ceiling is the chart keys' own: an old client that writes the blob drops them and the stat
  falls back to a plain number; the panel survives (and the sampler simply stops finding
  `trend: 'history'` until a new client writes it back — degradation, not corruption).
- `normalizePanel`: `trend: 'activity'` requires a datetime field in the schema and is dropped on a
  collection swap that loses one (the `retainShaping` rule applied to a view key);
  `trend: 'history'` asks nothing of the schema and always survives.
- `good` exists because direction-goodness is **not guessable** — open PRs going up is bad for one
  person's board and good for another's. Absent `good` renders the delta in neutral ink, never a
  guessed green. This is display config on the *panel* (the user's judgement), not the field —
  deliberately unlike units/tones, which are the plugin's facts and hang off the field.

### Delta semantics

Baseline = the sample with the greatest bucket ≤ now − window (`day` = 24h, `week` = 7d), searched
no further back than 2× the window. No qualifying sample → **no delta drawn** (the em-dash rule:
absence is a fact, and it is not zero). Delta = current live measure − baseline, rendered signed
("▲ 2 vs last week"), coloured by `good` when set, neutral otherwise.

### Sparkline mark (spec shared with `charts.md`)

Reuses `chart.ts` line arithmetic at small size: last 14 daily points (history tier: last value per
day; activity tier: `dayBucket` counts over the current rows). 2px line, series-identity colour per
`charts.md`, ~10% area wash, 4px end dot with a 2px surface-colour ring, **no axes, no grid, no
ticks** — the stat's number is the axis. Height ≤ 32px inside the stat body; hidden when the panel
is too short rather than compressing the stat (the stat's minimum size already exists in
`layout.ts § SIZES`). Gaps in history render as gaps (broken line), not interpolation.

The editor/wizard offers `trend` only where its tier is available: `activity` needs a datetime
field, `history` needs the scheduler to exist (feature presence, not data presence — an empty
series renders as "collecting since …" under the number, which is the honest cold state).

## Rejected alternatives, on the record

- **Client-writes sampling** (this file's own first design) — clients PUT samples while panels
  render, last-write-wins buckets for multi-client convergence. Rejected once the scheduler
  existed to reject it: history full of holes whenever no dashboard was open, a write route and a
  convergence protocol whose only job was compensating for the wrong writer, and "periodically get
  data" was the requirement all along. The scheduler is the right writer; one writer needs no
  convergence.
- **History in the prefs slice** — cap, write amplification, old-client erasure (above).
- **Device-local history** — panels follow the node; a trend that differs per device contradicts
  the whole persistence story.
- **Per-field/per-row history, arbitrary retention, user-set windows** — that is a metrics product.
  One measure, two windows, fixed retention; when someone outgrows it, the overflow is a plugin
  with a real time-series behind a frame pane, not a fatter store here.

## Done when

- The table exists; `core:sample-measures` accrues one sample per placed history-trend panel per
  hour with **no client attached**, skipping partial answers visibly; `core:compact-history`
  enforces retention — all unit-tested node-side against a fake clock.
- Editing a panel's filters resets its series (signature); editing its title or geometry does not.
- The GET route serves the series behind `requireUser`; deleting a panel deletes its series;
  unplacing does not.
- A stat with `trend: 'history'` draws the sparkline from the store with gaps preserved;
  `compare` draws the delta with the no-baseline case rendering nothing; `good` colours it and its
  absence stays neutral. `trend: 'activity'` draws with zero store involvement.
- An old client renders these panels as plain stats and a round-trip through it keeps the panel
  (dropping only the three keys — the recorded ceiling).
- Nothing in `@acorn/protocol/collections.ts` changed.

## Verify before building

- `../cron/targets.md § collection-sample` — the two seams (node-side collection reads, the shared
  measure pipeline) this file assumes are built; their "done when" gates this one.
- `PanelView` codec in `persist.ts` — the chart-keys pattern the three keys copy; and
  `parsePanelDefinition`'s availability node-side (it moves with the shared pipeline).
- `node-core/src/server/db/schema.ts` — table conventions; the machine-scoped note still holding.
- A stable-stringify for the signature, importable by the node (lives naturally in the shared
  pipeline package).
- `chart.ts § dayBucket` and the line arithmetic the sparkline reuses.
