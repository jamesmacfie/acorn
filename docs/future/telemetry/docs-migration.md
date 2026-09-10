# Docs migration: every document under `docs/` that changes, and when

Part of [docs/future/telemetry/](./README.md). A phase is not done until the owning doc says the new
true thing. `docs/telemetry.md` (new) is the owning document for the collector, the record model, the
attribute vocabulary, the switch, and the sink contract; the others gain a section or a row and point
to it.

## By document

| Document | Section | Phase | Change |
| --- | --- | --- | --- |
| `docs/telemetry.md` (new) | whole file | 0 | The owning doc: the five kinds, the vocabulary, the switch, the collector's ring and flush, `ctx.telemetry`, `ctx.log`, the `telemetry` token, the `ACORN_PERF` sink, what never leaves the machine. Phases 1 to 4 add a section per runtime. |
| `docs/README.md` | Building, running, shipping | 0 | One row for `docs/telemetry.md`. |
| `docs/plugins.md` | The plugin API; The two contexts, one per tier | 0 | `telemetry` and `log` on both tiers; `core.telemetry` behind the token. |
| `docs/plugins.md` | Activation | 0 | Replace the "there is no `ctx.log`" paragraph with the reversal and its reason. |
| `docs/plugins.md` | Adding a plugin contribution | 0 | The token in the manifest permissions list. |
| `docs/plugin-authoring.md` | The node half | 0 | Replace "There is no `ctx.log`" with a "Telemetry and logging" subsection. |
| `docs/plugin-authoring.md` | Permissions | 0 | The `telemetry` token and its trust text. |
| `docs/plugin-authoring.md` | The client half; Reaching the bridge | 4 | The `telemetry` bridge verb and the client export. |
| `docs/plugin-map.md` | The node API | 0 | Two `ctx` rows and one core facet row. |
| `docs/plugin-map.md` | The client API | 4 | The client telemetry export. |
| `docs/contribution-kinds.md` | the kinds table | 0 | Telemetry and Logging rows, or `tools/arch/contributionKinds.test.ts` fails. |
| `docs/performance.md` | Where each behaviour lives now | 0 | The `perf.ts` row points at the collector; the request line and histograms are the `ACORN_PERF` sink. |
| `docs/local-development.md` | Timing a cold start | 0 | `[service:boot]` marks move to stderr; `SIGUSR2` still dumps. |
| `docs/security.md` | Node-half plugin security, Rung 1 | 0 | New `### Telemetry sinks`: what a sink sees, why the token is high, the scrubber, what never leaves. Row in the summary table. |
| `docs/security.md` | Credential handling | 5 | The DSN through the connection seam; `secrets: false`. |
| `docs/state-ownership.md` | Node-owned state | 0 | The `telemetry.enabled` pref. |
| `docs/api-reference.md` | Request processing | 0 | `traceparent` is read; `x-request-id` is unchanged. |
| `docs/api-reference.md` | routes | 1 | `POST /v2/core/telemetry`, device principal only. |
| `docs/architecture-overview.md` | Package boundaries | 0 | The console rule. |
| `docs/testing.md` | Test layers | 0 | The console baseline and the docPaths marker for planned files. |
| `docs/frontend.md` | a new section | 1 | Interaction traces, page-change and pane-region spans, the owner side-map on registries. |
| `docs/tui.md` | a new section | 3 | Frame and key histograms; how batches leave a process whose stderr is the screen. |
| `docs/shell.md` | the helper and the shell | 3 | Helper boot spans and broker events; the Rust panic record and how it is forwarded. |
| `docs/managed-agents.md` | Harnesses or Sessions | 2 | `agent.turn` and `agent.session` spans. |
| `docs/workflows.md` | Runs | 2 | `workflow.run` and `workflow.step` spans. |
| `docs/integrations.md` | providers | 5 | `sentry-telemetry` as an observability connection provider; the two-plugin split. |
| `docs/future/integration-ideas.md` | Observability, errors, and logs | 5 | Note that the exporter exists and the `sentry` integration is still the Rollbar shape. |
| `docs/future/README.md` | The programmes | 0 | The row for this folder; the retired-folders paragraph when it closes. |

## What this folder deletes when done

When every phase ships, this folder is deleted and one paragraph in `docs/future/README.md`
§ Retired folders says where each behaviour moved. `docs/telemetry.md` (new) owns the result.
