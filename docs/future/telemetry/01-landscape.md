# Landscape: what the vendors need from an SDK

Part of [docs/future/telemetry/](./README.md). Read on 2026-09-10 from Sentry's product page and its
SDK development docs, the OpenTelemetry specification, and the Better Stack, Coralogix, and Datadog
documentation. Vendor pages move; the shapes below are what acorn designs against, and the exporter
phase checks them again before building.

## Sentry

Sentry ships seven product surfaces from one SDK: errors, tracing, structured logs, metrics, profiling,
session replay, and cron and uptime monitors. All of them travel as one wire format, the envelope: a
JSON header line, then items, each with its own header and payload, posted to
`https://<host>/api/<project_id>/envelope/`. The DSN alone authenticates it, in the envelope header or
as `X-Sentry-Auth`. Post-decompression limits are 1 MiB per event, transaction, span, or log item.

What each item needs from the SDK:

| Item type | Payload | What acorn must hold to produce it |
| --- | --- | --- |
| `event` | `event_id`, `timestamp`, `platform`, `level`, `logger`, `transaction`, `release`, `environment`, `tags` (string pairs, 200 chars each), `extra`, `fingerprint`, `exception.values[].{type, value, stacktrace.frames[]}`, `breadcrumbs`, `contexts.{os, device, app, runtime, trace}`, `user` | An error record with name, scrubbed message, optional stack, level, handled flag, attributes, and the trace it happened inside |
| `transaction` | A root span with `name`, `op`, `start_timestamp`, `timestamp`, `status`, `contexts.trace.{trace_id, span_id, parent_span_id}`, and a flat `spans[]` list, each `{span_id, parent_span_id, op, description, start_timestamp, timestamp, status, data}` | Spans with a trace id, a span id, an optional parent, a name, a start, a duration, a status, and attributes |
| `span` | The standalone form of the above, one item per span | The same |
| `log` | Batched, up to 100 per item and one item per envelope: `{timestamp, trace_id (required), level trace..fatal, body, severity_number, attributes: {key: {value, type}}}`; flush at 100 items or 5 seconds; hard queue cap 1,000 | Log records with a level, a body, typed attributes, and a trace id, or a fresh one when there is no trace |
| `trace_metric` | Batched: `{name, type counter/gauge/distribution, value, unit, timestamp, trace_id (required), span_id, attributes}` | Counters, gauges, and histograms with attributes |
| `check_in` | `{check_in_id, monitor_slug, status in_progress/ok/error, duration, environment, release, monitor_config: {schedule: {type: 'interval', value, unit} or crontab, checkin_margin, max_runtime, timezone}}` | A completed span for a scheduled run, with the schedule's key, cadence, outcome, and duration |

Sampling is the SDK's job: `tracesSampleRate` or a `tracesSampler`, decided once per trace and
propagated. Distributed tracing uses a `sentry-trace` header and a `baggage` header; the W3C
`traceparent` form carries the same three fields and Sentry reads it.

What acorn does not build for Sentry, and why, is in [refused.md](./refused.md): replay records the
screen, profiling needs a per-runtime profiler, uptime is a ping with nothing to ping.

## OpenTelemetry

OpenTelemetry names four signals and keeps them independent: traces (a span has a trace id, a span
id, a parent, a name, a kind, a start and end, a status, and attributes), metrics (counter,
up-down counter, gauge, histogram, with attributes), logs (a log record has a timestamp, a severity, a
body, attributes, and the trace and span it happened inside), and events (a log record with an
`event.name`, for a distinct occurrence that needs its own timestamp). Context propagation is shared:
the W3C `traceparent` header, `00-<trace-id 32 hex>-<parent-id 16 hex>-<flags 2 hex>`, and
`baggage`. Resource attributes describe the process once: service name, version, host, OS.

acorn's record model uses those names where it can (`traceId`, `spanId`, `parentSpanId`, `attrs`,
`level`, `body`) so that a future OTLP exporter is a serialiser, not a redesign. It does not take the
dependency: the API package alone is a peer of two things in the lockfile and a dependency of none,
and the SDK is a process-wide singleton that assumes it owns the host's async context.

## Better Stack, Coralogix, Datadog

All three ingest OTLP. Better Stack (formerly Logtail) takes logs, traces, and metrics over OTLP and
correlates them on a shared trace id. Coralogix does the same and adds a browser RUM SDK that reports
runtime errors, network errors, custom measurements, and versioned releases. Datadog's RUM SDK records
sessions, views, actions, errors, resources, and Core Web Vitals, and links a view to the backend
traces its requests produced.

What they have in common is what acorn's model has to carry: a trace id that is the same on the
renderer and the node for one user action, an error that says which release and which view, a
measurement with a name and a unit, and attributes that group and filter. Datadog's "view" and
"action" are acorn's page change and command spans.

## The five signals, and what acorn maps to each

| acorn record | Produced by | Sentry item | OTLP signal |
| --- | --- | --- | --- |
| span | A request, a command, a page change, a schedule run, a hook run, a plugin dispatch, a workflow step, an agent turn | `transaction` for a root, `span` for a child; `check_in` for `schedule.run` | trace |
| log | The logger, in every runtime, and `ctx.log` | `log` | log |
| event | A distinct occurrence with attributes: reconnect, shed, crash-budget hit, pref flipped, plugin failed to load | `event` with `level: info` and no exception, or a breadcrumb on the next error | event |
| metric | Histograms from hot seams (SQL, WebSocket frames, terminal frames, bridge messages, key dispatch), counters, gauges | `trace_metric` | metric |
| error | A caught or uncaught error, with a scrubbed message and an optional stack | `event` with `exception` | log with severity error, or a span event |

Cron check-ins are not a sixth kind. A `schedule.run` span carries the schedule key, cadence, reason,
and outcome; the exporter turns it into the `in_progress` and `ok`/`error` pair.

## Sources

- [Sentry product page](https://sentry.io/welcome/)
- [Sentry envelope format](https://develop.sentry.dev/sdk/data-model/envelopes/)
- [Sentry event payloads](https://develop.sentry.dev/sdk/data-model/event-payloads/)
- [Sentry tracing for SDK authors](https://develop.sentry.dev/sdk/telemetry/traces/)
- [Sentry structured logs for SDK authors](https://develop.sentry.dev/sdk/telemetry/logs/)
- [Sentry metrics for SDK authors](https://develop.sentry.dev/sdk/telemetry/metrics/)
- [Sentry check-ins for SDK authors](https://develop.sentry.dev/sdk/telemetry/check-ins/)
- [Sentry authentication](https://docs.sentry.io/api/auth/)
- [OpenTelemetry specification overview](https://opentelemetry.io/docs/specs/otel/overview/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Better Stack OpenTelemetry ingestion](https://betterstack.com/docs/logs/open-telemetry/)
- [Coralogix RUM overview](https://coralogix.com/docs/user-guides/rum/product-features/overview/)
- [Datadog RUM events](https://docs.datadoghq.com/ddsql_reference/data_directory/dd/dd.rum.dataset/)
