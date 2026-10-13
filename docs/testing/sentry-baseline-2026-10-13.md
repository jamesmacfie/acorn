# Sentry baseline, October 13, 2026

These numbers come from one day of normal use of the desktop dev app, the 24 hours before about
4:40 PM on October 13, 2026 (03:40 UTC). They're the "before" numbers for phases 06 to 10 of
[UI performance](../future/ui-performance/README.md). The data is in Sentry org `acorn-u3`, project
`acorn-development`.

Read [the sampling rules](../telemetry/diagnosis.md) before comparing. Node `http.request` spans
outside a trace are kept only at 250 ms or more, so their counts are slow calls, not totals.

## How to rerun

Use the Sentry MCP with `organizationSlug: acorn-u3`, `regionUrl: https://us.sentry.io`, and a `24h`
period. Each table below names its dataset and query. Compare a full working day with a full working
day, because an idle evening drags every percentile down.

## Healthy

These held up and need no work:

| Measure | Value |
| --- | --- |
| `agents.session.open` with `outcome:ready`, p50 and p95 | 163 ms, 1.2 s |
| `ui.feature.open`, p50 and p95 | 133 ms, 1.2 s |
| Node `runtime.cpu`, average | 2.2% |
| `sql.select.p95`, average | 1.2 ms |
| `cache.serialize.p95`, typical | 14 ms |
| `renderer.startup.usable`, p50 over 20 launches | 1.3 s |

## Git processes from checkout admission

Metrics dataset, `metric.name:[git.rev_parse.count,proc.spawn.count,git.status.count]`, summed by
`owner`:

| Metric | Owner `core` | Owner `git` | Owner `preview` |
| --- | --- | --- | --- |
| `git.rev_parse.count` | 34,575 | 17,321 | 6,370 |
| `proc.spawn.count` | 47,401 | 31,126 | 6,399 |
| `git.status.count` | 11,656 | 3,099 | 0 |

Spans dataset, `span.op:http.request`, grouped by `route`:

| Route | Slow calls | p50 | p95 |
| --- | --- | --- | --- |
| `/v1/p/git/tasks/:id/local/status` | 1,021 | 502 ms | 4.0 s |
| `/v1/core/tasks/:id/tools` | 705 | 537 ms | 2.6 s |
| `/v1/core/task-statuses` | 431 | 443 ms | 1.6 s |
| `/v1/p/git/tasks/:id/local/dependencies` | 30 | 7.3 s | 45.7 s |
| `/v1/p/docker/task-summary` | 1,494 | 393 ms | 2.3 s |

## Session-open timeouts

Spans dataset, `span.op:[agents.session.open,agents.sidebar.open]`, grouped by `outcome`:

| Span | Outcome | Count | Duration |
| --- | --- | --- | --- |
| `agents.session.open` | `ready` | 292 | p95 1.2 s |
| `agents.session.open` | `timeout` | 10 | 30.0 s each |
| `agents.sidebar.open` | `timeout` | 2 | 30.1 s each |

The 12 timeouts lift the `agents.session.open` p95 across all outcomes to 6.3 s. In trace
`41de71cabd856889fdb7f64d379e1e1f`, every request under the open finished within 140 ms, and the
timed-out span is a second `agents.session.open` nested inside the first.

## Renderer memory

Metrics dataset, `metric.name:runtime.memory.footprint runtime:renderer`:

| Average | p95 | Peak |
| --- | --- | --- |
| 800 MB | 1.5 GB | 2.6 GB, at 3:49 PM |

The footprint stayed near 2 GB from 3:30 PM to the end of the window. The worst query-cache saves fell
in the same minutes: `cache.dehydrate` took 101 s at 3:45 PM and `cache.write` took 16 s at 3:47 PM.
The node's `runtime.memory.rss` peaked at 606 MB, and the helper's at 161 MB.

## Agent provider processes

Metrics dataset, `metric.name:[agent.processes.live,agent.processes.idle,agent.processes.memory]`,
sampled every 60 s:

| Metric | Average | p95 | Peak |
| --- | --- | --- | --- |
| `agent.processes.live` | 2 | 10 | 18 |
| `agent.processes.idle` | 1.4 | 8 | 17 |
| `agent.processes.memory` | 682 MB | 3.2 GB | 8.0 GB, at 4:38 PM |

`agent.processes.idle` counts processes with nothing running inside them, however long they've been
idle. The idle stop is 30 minutes by default, so this gauge can't show how many were past the limit.

## Response size

Metrics dataset, `metric.name:api.response.bytes.max`, grouped by `route`:

| Route | Average | Peak |
| --- | --- | --- |
| `/v1/core/prefs` | 573 KB | 589 KB |
| `/v1/p/agents/sessions` | 474 KB | 2.2 MB |
| `/v1/p/editor/tasks` | 267 KB | 575 KB |
| `/v1/p/git/tasks` | 33 KB | 830 KB |

The persisted query cache held about 147 queries and 1.9 million characters per save
(`cache.characters.max`), and the client saved it 1,830 times in the day.
