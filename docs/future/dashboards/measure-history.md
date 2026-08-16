# Measure history: sampling, storage, and the stat that earns a trend

**Unbuilt.** The foundation half (store + routes + sampling) is **phase 0** of the accepted
redesign; the display half (delta, sparkline) is **phase 3** and waits on the store having data
(`README.md § build order`).

## The problem, stated honestly

The collections wire carries **current rows only**. A stat that says "6 open now" is derivable; a
stat that says "▲ 2 vs last week" is not, and neither is a sparkline of that measure over time —
there is no history anywhere in the system. Two ways to get one:

- **Ask plugins for history.** Refused. It grows the plugin contract with a time-series obligation
  every provider inherits forever (`refused.md § No new field type without a fight` is the same
  budget argument), most providers cannot answer it (GitHub does not serve "how many PRs were open
  last Tuesday"), and the invariant says the contract never grows to chase a use case.
- **The host records what it already fetched.** Chosen. The host is already polling collections and
  computing measures; sampling that number over time is host machinery over existing reads, invisible
  to every plugin. This *does* grow the **core node↔client contract** (a route pair) and the node's
  storage (a table) — allowed, and exactly the split the invariant draws.

Two tiers fall out, and they are different features wearing one mark:

| Tier | Needs | Shows | Available |
| --- | --- | --- | --- |
| **Activity** | nothing new | rows bucketed by their own `updated`-role datetime, per day — the line chart's existing arithmetic (`chart.ts § dayBucket`) at sparkline size | the moment the rows arrive |
| **History** | this file's store | the panel's *measure* sampled over time — the number the stat shows, as it was | accrues from when the panel starts being drawn |

Never blur them in the UI: activity is "when did these rows change", history is "what was this
number". The trend config below names which one a panel shows.

## Storage: node-side, per user, its own table

**Not the `core.dashboards` prefs slice.** Three reasons, each sufficient: the slice has a 64KB cap
and history is unbounded-ish time-series; every sample would rewrite and re-sync the whole blob
(write amplification through the prefs machinery); and old clients round-trip slices by re-writing
what they parsed, which would make any old client a history-eraser. History is **data with a
retention policy, not preferences**.

It follows the node for the same reason panel definitions do: the panel describes the node's
resources, and every client paired with the node should see the same trend
(`docs/state.md § Scope rules`).

```sql
create table dashboard_measure_samples (
  user_id     text    not null,           -- from the authenticated principal, never the body
  panel_id    text    not null,
  signature   text    not null,           -- see invalidation, below
  bucket      integer not null,           -- UTC hour start, epoch ms
  value       real    not null,
  recorded_at integer not null,
  primary key (user_id, panel_id, bucket)
)
```

### The routes (core contract, additive)

- `GET /v2/core/dashboards/history?panelId=…&since=…` →
  `{ signature: string, samples: [{ bucket: number, value: number }] }`, ascending, capped at the
  retention window. Empty series → `{ signature: '', samples: [] }`, never 404: absence is data.
- `PUT /v2/core/dashboards/history` with `{ panelId, signature, bucket, value }` — idempotent
  upsert on `(user, panel, bucket)`, **last write wins**. That single property is the whole
  multi-client story: two clients polling the same panel write the same bucket and converge, no
  coordination, no dedupe protocol.
- Both behind the existing `requireUser` principal gate; `user_id` is stamped server-side. Body
  parsing follows the house route conventions (`ApiError`/`respondError`), caps below enforced
  server-side.

### Invalidation: the signature

A panel whose meaning changed must not keep its old trend — a filter added yesterday makes last
week's samples a lie. `signature` = a stable hash of the parts of the definition that change what
the measure *means*: `queries` (ids + params), `mapping` (columns + value maps + field maps),
`shaping.filters`, `view.aggregate`, `view.field`. Not the view kind, not sort/limit/projection,
not title, not geometry — those change presentation, not meaning.

On `PUT` with a signature different from the stored one, the server **deletes the series and starts
the new one**. Drift is never papered over — the same posture as the pinned-schema rule in
`dynamic-collections.md`. The UI consequence is a trend that visibly restarts ("since 17 Aug"),
which is honest.

`removePanel` (definition deletion, the armed one) issues a best-effort `DELETE` for the series;
orphans that slip through age out under retention. Unplacing deletes nothing — the definition
survives and so does its history.

### Caps and retention (server-owned)

- One sample per hour bucket per panel — the `PUT` shape makes finer granularity unrepresentable.
- Retention compaction, on a lazy schedule (piggyback the node's existing maintenance seam, else on
  write): hourly samples kept 14 days; older buckets collapsed to one per UTC day (the day's last
  value — the stat shows point-in-time state, so last-known beats averaging); daily samples kept
  400 days, then dropped.
- Hard cap ~1,000 rows per (user, panel) after compaction; a series at cap drops oldest first.
  Worst case for a busy board of 50 panels is trivially small; the cap exists so nothing needs to
  trust that arithmetic.

## Sampling: the client writes what it just rendered

Sampling lives beside `createPanelData` — the one place the assembled, shaped, mapped rows and the
measure already exist. Rules, each one a decision:

- **Only live, complete answers sample.** A cache-fallback render must not re-record a stale value
  at a fresh timestamp, and a partial answer (one source down) measures availability, not data — a
  mixed board missing GitHub would record a dip that never happened. All sources resolved live, or
  no sample.
- **The sampled value is the panel's measure** — `view.aggregate`/`view.field` over the
  post-filter, post-mapping rows. Not raw row counts, not per-field series. One number per panel
  per bucket; the feature is a stat trend, not a metrics platform.
- **Write once per bucket per session-sight:** after a successful assembly, `PUT` if this client
  has not written this panel's current bucket yet (last-write-wins makes over-writing harmless,
  this is just politeness to the route).
- **Hidden windows don't sample** for free, because hidden windows already don't poll.
- **Panels sample only while placed somewhere.** No placement → nothing renders → nothing samples.
  History has gaps when nobody had the dashboard open; the display below must not interpolate over
  them as if the data were continuous.

Nothing here touches plugin code, `@acorn/protocol/collections.ts`, or the fetch paths.

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
  falls back to a plain number; the panel survives.
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
field, `history` needs the store to exist (feature presence, not data presence — an empty series
renders as "collecting since …" under the number, which is the honest cold state).

## Rejected alternatives, on the record

- **History in the prefs slice** — cap, write amplification, old-client erasure (above).
- **Node-side sampler** (node polls collections itself) — the node cannot run a compiled plugin's
  `fetch` (it is client code), so this splits the fetch path in two and gives loaded and compiled
  collections different trust and freshness stories. The client-writes model keeps one fetch path.
- **Device-local history** — panels follow the node; a trend that differs per device contradicts
  the whole persistence story.
- **Per-field/per-row history, arbitrary retention, user-set windows** — that is a metrics product.
  One measure, two windows, fixed retention; when someone outgrows it, the overflow is a plugin
  with a real time-series behind a frame pane, not a fatter store here.

## Done when

- The table and both routes exist behind `requireUser`, with signature-reset, LWW upsert, caps and
  compaction unit-tested node-side.
- A placed stat panel accrues one sample per hour while rendered live; cache-fallback and
  partial-availability renders provably do not write.
- Editing a panel's filters resets its series (signature); editing its title or geometry does not.
- A stat with `trend: 'history'` draws the sparkline from the store with gaps preserved;
  `compare` draws the delta with the no-baseline case rendering nothing; `good` colours it and its
  absence stays neutral.
- `trend: 'activity'` draws with zero store involvement.
- An old client renders these panels as plain stats and a round-trip through it keeps the panel
  (dropping only the three keys — the recorded ceiling).
- Nothing in `@acorn/protocol/collections.ts` changed.

## Verify before building

- Where core `/v2` routes register and the node's migration seam for the table and compaction
  job — follow the existing conventions there (`docs/architecture-overview.md`, the prefs route).
- `createPanelData` in `data.ts` — that per-source liveness/staleness is distinguishable at the
  point of assembly (the sampling gate needs "all sources live" as a fact, not a guess).
- The stable-stringify utility available client-side for the signature (or add one, tested).
- `PanelView` codec in `persist.ts` — the chart-keys pattern this file's three keys copy.
- Whether a maintenance/compaction seam already exists node-side (sync engine, prefs pruning) to
  piggyback rather than inventing a scheduler.
