# Phase 5: the Sentry exporter

Status: not started. Waits on phases 0, 1, and 4.

## Goal

`plugins/sentry-telemetry` (new) exists, ships in the app, and does nothing until a DSN is entered
in Settings → Integrations and the core switch is on. From then on every batch the node collects
becomes Sentry envelopes: transactions and spans, structured logs, trace metrics, error events, and
cron check-ins, as [05-sentry-exporter.md](./05-sentry-exporter.md) maps them.

## Why this phase, and why now

It is the thing the owner asked for, and it is last because it is a sink: it needs the collector
(phase 0), the renderer's half of every trace (phase 1), and the recorder to test against (phase 4).

## Scope

In:

- `plugins/sentry-telemetry/acorn-plugin.config.mjs` (new), `src/node/index.ts` (new),
  `src/server/provider.ts` (new), `src/server/envelope.ts` (new), `src/server/exporter.ts` (new),
  `src/tree/settings.tsx` (new), tests beside each.
- `apps/desktop/scripts/build-bundled-plugins.mjs`: the id in `BUNDLED_PLUGINS`.
- A smoke run against a real project, recorded in the phase's commit.

Out: reading Sentry issues (the `sentry` integration); release and source-map upload; persistence
across restarts.

## Design detail

As [05-sentry-exporter.md](./05-sentry-exporter.md). Decisions at build time:

**Transactions from a batch, not from a trace store.** A root span and the children that share its
trace id in the same batch become one transaction. A child whose root is not in the batch goes as a
standalone `span` item. Sentry stitches them by trace id. Holding spans back to wait for a root is
refused; it is the persistence the folder refuses under another name.

**Check-ins from completed spans.** The exporter only sees a `schedule.run` span when it ends, so it
sends `in_progress` with the span's start timestamp and `ok` or `error` with its duration in the same
envelope. Sentry accepts the pair out of order within one envelope.

**Rate limits per category.** `X-Sentry-Rate-Limits` names categories. A limited category is dropped
until the window ends and counted as a `sentry.dropped` metric the exporter emits about itself,
which is the one place the exporter emits telemetry of its own.

## Code touched

The new package, the bundled list, and a `docs/integrations.md` section.

## Tests

- Provider: `validate` parses a DSN and refuses a malformed one; `normalize` labels and configures.
- Envelope: each record kind serialises to the documented item; `log` and `trace_metric` appear at
  most once per envelope; a batch with a root and two children produces one transaction with two
  spans.
- Exporter: a 429 with a category header drops that category and keeps the others; a network error
  backs off; the queue drops oldest at 200; nothing is sent with no connection.
- A recorder-based end-to-end test: `makeTestNodeContext` with the token, a fake `fetch`, a batch in,
  envelopes out.

## Docs owed

`docs/integrations.md` (the provider and the two-plugin split), `docs/security.md` § Credential
handling (the DSN posture), `docs/future/integration-ideas.md` (the note), `docs/telemetry.md` (new in phase 0; the
exporter as the first sink).

## Doors left open

1. `environment` and `release` come from the connection's `config`, so a second connection to a
   staging project is two rows, not a mode.
2. The envelope module has no acorn imports, so it can move to a shared package if a second
   Sentry-speaking plugin appears.

## Done when

- The smoke in [05-sentry-exporter.md](./05-sentry-exporter.md) passes against a real project.
- Disconnecting the connection stops exports within one flush; removing the plugin's trust does the
  same.
- `pnpm lint`, `pnpm test`, and `pnpm --filter @acorn/node build:plugin sentry-telemetry` are green.

## Verify before building

- `publicConnectionProvider` is exported from `@acorn/plugin-api/node` and `kind: 'observability'`
  is in `IntegrationProviderKind`.
- `ctx.providers.withConnection(userId, providerId, visit)` exists on the loaded tier.
- `BUNDLED_PLUGINS` in `apps/desktop/scripts/build-bundled-plugins.mjs` lists five ids.
- The Sentry envelope, log, metric, and check-in pages still describe the shapes in
  [01-landscape.md](./01-landscape.md).
