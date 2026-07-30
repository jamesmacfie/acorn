# Complete WASI plugin example

**Status:** Normative example<br>
**Example coordinate:** `acme/service-monitor`<br>
**Requirement prefix:** `EX-WASI`

The validated manifest is
[`plugin-manifest-wasi.json`](../contracts/examples/plugin-manifest-wasi.json). It is the canonical
manifest example for the default Community executable runtime.

## Purpose and artifacts

Service Monitor reads owner-declared HTTPS health endpoints, stores bounded observations, publishes
health transitions, and renders a workspace/task health view.

The immutable package contains:

- `runtime/service-monitor.wasm`, implementing `acorn:plugin@2.0.0`;
- a declarative UI bundle;
- input/output/event/settings/wizard JSON Schemas;
- migration `0 → 1`;
- localization/assets without executable markup;
- SBOM and build provenance; and
- signed manifest and transparency evidence.

There is no native process, socket, bespoke UI, install script, or raw secret.

## Settings and setup

Workspace settings contain at most 100 endpoint records:

| Field | Constraint |
| --- | --- |
| `id` | UUIDv7 |
| `label` | 1–80 Unicode scalars |
| `url` | HTTPS, no userinfo/fragment, 2,048 bytes |
| `intervalMs` | 30,000–3,600,000 |
| `timeoutMs` | 1,000–15,000 and lower than interval |
| `expectedStatus` | integer 100–599, default 200 |
| `enabled` | boolean |

The wizard explains behavior, requests brokered-HTTP authority, collects endpoints, resolves and
displays canonical destinations/private-address rejection, performs one bounded test, and commits
settings. Permission denial or failed tests can be resumed without duplicating settings.

`EX-WASI-001` Endpoint changes are treated as network-authority changes. The broker grant is updated
before the worker may contact a new canonical destination.

## Runtime

One supervised WASI worker runs per installation generation. It has no ambient filesystem, socket,
environment, clock, randomness, process, database, or secret authority. Host interfaces provide:

- deterministic timer scheduling;
- brokered HTTPS GET with no redirects unless separately approved;
- plugin database transactions;
- event publication;
- structured redacted logging; and
- health/shutdown.

The scheduler coalesces overlapping checks per endpoint. It performs no catch-up burst after Node
downtime and uses bounded exponential backoff with jitter supplied by the host.

Responses are capped at 64 KiB and discarded after status/latency extraction. Bodies, headers,
cookies, DNS answers, and provider errors are not persisted or emitted.

`EX-WASI-002` DNS and every redirect target are revalidated against the grant; loopback, link-local,
private, metadata, Unix-socket, non-HTTPS, and credential-bearing URLs fail before connection.

## Data and events

The isolated plugin database stores endpoint UUID, canonical URL hash, last status class, latency,
observed timestamp, consecutive failures, and alert state. It retains seven days of observations
within the manifest quota and compacts to hourly aggregates after 24 hours.

The plugin publishes `dev.acme.service-monitor.alert.raised.v1`,
`alert.cleared.v1`, and `observation.recorded.v1`. Events contain endpoint UUID/label, status class,
latency, transition, and workspace URI. They contain no full URL, response content, headers, DNS
data, or stack trace.

At-least-once event delivery is harmless because event IDs and alert transitions are idempotent.

## UI

The workspace/task view uses standard status, list, metric, timeline, loading, stale, permission,
offline, and error renderers. Actions are refresh, enable/disable, edit, and open settings. Refresh
is rate-limited and calls a declared command.

The worker never sends UI trees directly. A declared query returns the bounded view model; the
Client produces a semantic document/view session through the registered declarative contribution.

## Update, failure, and quarantine

An update stages a new component generation and recoverable database copy. Migration, readiness,
one authorized test check, and document validation precede atomic routing switch. Old handles are
revoked. Failure restores the old generation and database.

Repeated traps, fuel exhaustion, schema-invalid output, or network-policy attempts count toward
health. A confirmed authority violation quarantines the plugin without auto-restart.

## Conformance

- Validate the manifest, WIT imports/exports, schemas, UI, wizard, and migration digests.
- Attempt direct sockets, `/etc`/home access, environment reads, clock/random access, process spawn,
  raw secret reads, and handle reuse after revocation; all fail.
- Test DNS rebinding, redirect escape, slow/large responses, decompression bomb, invalid TLS, and
  offline Node behavior.
- Trap before/after storage commit and prove one transition/event.
- Exhaust memory/fuel/deadline and prove worker containment.
- Update with failing migration/readiness and prove atomic rollback.
- Uninstall with data deletion and prove the database, worker, subscriptions, grants, schedules,
  and Client contribution are gone.
