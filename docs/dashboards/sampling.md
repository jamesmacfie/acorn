# Sampling and retention

A stat's history trend needs to know what its number was. This page covers the hourly sampler, the
store's retention, and when a series resets. The sampler is
`packages/node-core/src/server/dashboards/sampler.ts`, and the store is `history.ts` beside it.

## Sampling and retention

The core `core:sample-measures` schedule runs hourly in the Node, with no client attached
([schedules](../schedules.md)). For each placed panel with a history trend, it resolves the immutable
publication and every query, calls the same data-source runtime, projects the panel with
`dashboards-core`, and appends the numeric measure. So a stored sample means what the number on screen
means. A pass samples at most 200 panels (`MAX_PANELS_PER_PASS`) and reports the rest.

An unplaced panel is skipped, because nothing draws it. Placing it again resumes sampling, and the gap
between draws as a gap. If any source is unavailable, or the projection has no finite measure, the
panel is skipped, and the run detail names it with the reason. A dip recorded
because one provider was briefly down would be a number that never happened.

The sampler is the store's only writer, and there's no write route. The client reads a series from
`GET /v1/core/dashboards/history`.

## Retention

The store keeps one sample per panel per UTC hour for 14 days (`HOURLY_RETENTION_MS`), then compacts
to one value per UTC day, the day's last value, not an average, for up to 400 days
(`DAILY_RETENTION_MS`). A cap of 1,000 samples per panel (`MAX_SAMPLES_PER_PANEL`) bounds a compaction
bug.

The daily `core:compact-history` pass also drops the history of any panel whose definition was
deleted. It uses the panels the preference defines, not the ones placed, because unplacing a panel
mustn't delete its history. When the preference can't be read, the pass skips this sweep, because
"couldn't read" isn't "no panels".

## When a series resets

Samples are keyed by panel ID and a signature of the measure's definition
(`packages/dashboards-core/src/signature.ts`). A signature change resets that panel's series, because
the old samples would describe a different measure. The signature covers what changes the measure's
meaning: the queries, the mapping, the filters, the aggregate, and the measured field. The view kind,
sort, limit, visible fields, title, geometry, and trend display keys don't count, so retitling or
moving a panel keeps its history.
