# Integration and model providers

Acorn separates provider connections from the behavior a provider contributes. Core owns encrypted
connection storage and lifecycle for every credentialed provider. External-item integrations such
as Linear and Rollbar additionally own link integrity, mirrored resources, context formatting,
reference discovery, and mutations. Model providers such as OpenAI and Anthropic instead contribute
text generation behind a server-only runtime.

The implementation lives under `apps/desktop/src/core/server/integrations/`. Public cross-process types
live in `apps/desktop/src/core/shared/integrations.ts`; client source, pane, and link contributions live in
`apps/desktop/src/app/client/providerContributions.tsx`.

## Connection, integration, and model registries

Every provider first registers one `ConnectionProviderContribution` with:

- identity metadata (`id`, label, glyph, and kind);
- a connection contract (`fields`, `validate`, `normalize`, `test`, and an optional connection-count
  limit);
- open-ended capabilities;
- provider/per-connection request concurrency budgets;
- a safe public projection used by Settings and connection discovery.

An external-item provider extends that base as an `IntegrationProviderContribution` with:

- executable mirrored-resource descriptors (`key`, `read`, `refresh`) and a versioned cache codec;
- optional linked-context formatter, reference resolver, and mutations;
- pagination, cache, context, backoff, and resolution budgets;
- memory-evidence policy. Providers may propose evidence, but `acceptedWrites` is structurally
  false—accepted memory remains human-gated.

The connection registry rejects duplicate providers/credential fields, invalid limits, and public
descriptors that differ from the safe projection. The external-item registry separately enforces
resource/link obligations. The model registry accepts only adapters whose matching connection
provider declares `textGeneration`.

GitHub is registered as the non-connectable `identity` provider. Its connection is synthesized from
the authenticated session and cannot be rotated or disconnected. Linear and Rollbar are stored,
multi-row providers: each account/workspace/project connection has an opaque stable id. OpenAI and
Anthropic are app-wide `model-provider` connections, limited to one connection each by reversible
service/UI policy; the table remains multi-row.

## Connection identity and lifecycle

`integrations` stores the core-readable connection state:

| Field | Ownership |
| --- | --- |
| `id`, `provider`, `userId`, `label` | Core identity and display |
| `access_token` (`authRef` in TypeScript) | Encrypted secret material; server-only |
| `authKind`, `status`, `lastValidatedAt`, `lastError` | Core lifecycle/health |
| `account`, `scopes`, `capabilities` | Provider-normalized, safe public summary |
| `config` | Provider-codec-owned non-secret configuration |
| `createdAt`, `updatedAt` | Core audit timestamps |

Credential forms submit write-only values. A descriptor validates and normalizes them; the core
connection service encrypts and writes the result. List/test/connect responses use `Integration`
summaries and never include `authRef`, credential values, or wholesale upstream responses.
Settings renders the same descriptor fields for external integrations and model providers.

Lifecycle routes:

| Method | Route | Effect |
| --- | --- | --- |
| `GET` | `/api/integrations` | Public provider catalog plus synthesized/stored connection summaries |
| `POST` | `/api/integrations` | Validate, normalize, encrypt, and create a connection |
| `PUT` | `/api/integrations/:id` | Rotate credentials while preserving the connection id and linked state |
| `POST` | `/api/integrations/:id/test` | Run provider health test and update status/validation fields |
| `PATCH` | `/api/integrations/:id` | Disable or re-enable without deleting state |
| `DELETE` | `/api/integrations/:id` | Core cascade: bindings, cached items, task links, then the row |

Disable, reauth, and rotation preserve caches, task links, and bindings. Disconnect removes those
derived/provider-owned rows. Accepted memory is outside this cascade.

Live fan-out uses `forEachConnection`; it filters disabled/needs-auth rows and decrypts only in the
server process. Mirrored reads use `runProviderResource` instead: core resolves the stored
connection, reads cache before credentials, suppresses outbound work for disabled/needs-auth rows,
then projects the descriptor through the shared sync engine. This is why reauthentication can
still serve stale linked detail without leaking one account's cache or backoff state into another.

## Model-provider runtime

`plugins/model-providers/server/` contains the official OpenAI and Anthropic SDK adapters. SDK types
and wire objects stop there. The adapters validate/test API keys with model-list requests and
provide one-shot text generation through `core/server/modelProviders/`.

`generateTextForConnection` accepts a user id, opaque connection id, bounded provider-neutral input,
and the server encryption key. It:

1. resolves the connection under that user;
2. requires a connected `textGeneration` capability;
3. decrypts immediately before the call;
4. schedules by provider and connection;
5. propagates cancellation and a bounded timeout;
6. maps provider failures to the shared provider error vocabulary;
7. returns text, provider/connection/model identity, and safe usage counts.

There is intentionally no generic generation HTTP or public-automation endpoint. A consuming plugin
owns its authenticated feature route, prompt, data-disclosure policy, validation, and UI, then calls
the core runtime. Renderer code discovers eligible connections only from `/api/integrations` via
`availableModelConnections`; it never receives an SDK client or secret.

OpenAI uses the Responses API with `store: false`, separate instructions/input, and the SDK's
aggregated `output_text`. Anthropic uses the Messages API with top-level `system` instructions and
concatenates text content blocks. Recommended model ids are adapter-owned and the actual response
model id is returned.

## External references and link integrity

The shared identity is:

```ts
type ExternalRef = {
  providerId: string
  connectionId: string
  displayId: string
  externalId?: string
  url?: string
  locator?: Record<string, string>
}
```

`task_links.identifier` remains the human display id. `task_links.ref_json` stores the complete
reference when a provider needs a stable external id, canonical URL, or locator scope.

Task-link writes accept `connectionId`, identifier, and provider-owned ref fields. Core loads the
connection and stamps `providerId`; a caller-supplied provider/connection mismatch is rejected.
Workspace binding writes likewise verify every referenced connection before replacing bindings.
This is a data-integrity and security boundary, not a client convention. Task panes, pane intents,
query keys, detail routes, and mutation routes retain that `connectionId`; only PR text that has no
connection information uses Linear's documented bare-id first-hit behavior.

## Cached items and codecs

Provider items remain in the generic `issues` table, keyed by
`(userId, integrationId, identifier)`. The JSON payload is a versioned cached item:

```ts
type CachedExternalItem<Summary, Detail> = {
  ref: ExternalRef
  summary: Summary
  detail?: Detail
  listFetchedAt?: number
  detailFetchedAt?: number
  schemaVersion: number
  deletedAt?: number
  truncated?: boolean
}
```

Every read seam invokes the registered codec. Codecs normalize pre-Phase-7 blobs, reject malformed
data without throwing into the pane/context surface, and cap serialized size using the provider's
budget. A list refresh merges a new summary over the cached item and retains existing detail. The
conformance suite explicitly passes a detailed row through `mergeSummary` to prevent descriptions,
comments, or activity being clobbered.

Each mirrored-resource descriptor is executable: `key` produces an opaque per-connection sync key,
`read` decodes the provider cache, and `refresh` performs the upstream fetch plus persistence. Core's
resource runtime applies serve-then-revalidate, stale fallback, provider/per-connection concurrency,
rate-limit backoff, pagination and serialized-size limits. Provider HTTP routers are registered next
to descriptors and projected once by `integrationProviderRoutes`; the server composition root does
not import Linear or Rollbar.

Linked context never performs a live provider fetch. Missing/malformed rows become explicit absent
state, stale rows are marked stale, and deleted rows can render as tombstones. The linked-issues
context section looks up the provider by the link's stamped id and delegates formatting; core does
not inspect `state`, `status`, or `level` fields.

## Sources, panes, references, and mutations

Client sources are registry contributions. Availability is derived from the source registry plus
connection health—not `SOURCE_IDS`, source switches, or provider-specific settings metadata. Source
promotion is executable descriptor behavior (`canPromote`, `prepare`, `create`, optional
`afterCreate`/`attachToCurrentTask`). Linear declares workspace/repo promotion with branch
suggestion; Rollbar declares repo-and-branch preparation plus attach-to-current-task. App rendering
and rail glyphs resolve the contribution by id.

Provider panes declare their provider id and accept `integration:show-ref` pane intents. Context
jumps and repeated opens route through the client event bus, so selecting an already-visible linked
item still acts. Missing or unresolvable refs leave the pane in its normal state.

Linear's `linear.app` URL parser is registered as a provider-owned content-link contribution. Its
server reference resolver uses the same URL-only detection policy; bare ids retain the documented
first-hit-wins resolution ceiling across multiple Linear connections.

Linear comment creation is the declared `linear.comment` mutation. It requires the `comments`
capability, is `write` risk, uses live resolution before writing, is non-idempotent, and invalidates
the detail resource. Threaded replies preserve `parentId`. Rollbar declares no provider mutation.

## Generic provider errors

Provider routes use the shared `ApiError` envelope and these behavior-oriented codes:

- `provider_not_connected`
- `provider_needs_auth`
- `provider_missing_scope`
- `provider_rate_limited`
- `provider_unavailable`
- `provider_resource_not_found`
- `provider_resource_deleted`
- `provider_resource_forbidden`
- `provider_bad_config`
- `provider_secret_unreadable`

GitHub's identity/session-specific `reauth`, `sso`, and `rate_limited` vocabulary remains unchanged.

## Shipped-provider parity

Linear preserves multi-connection first-hit-wins bare-id resolution, explicit-connection project
browse, workspace-scoped project links, active-only issues, suggested branch defaults, threaded
comments, and XSS-safe markdown. Rollbar is a two-column master/detail Source: a workspace-scoped
active-item list (mapped Rollbar connections only; paginated to 300 and filterable locally by
project/level/environment/counter) beside a reusable
`RollbarItemPanel` detail — the same component the task pane mounts — with Summary, Details, and
Occurrences tabs. Summary reuses the selected list row, item metadata loads only when needed, the
occurrence list loads only when its tab opens, and a normalized privacy-allowlisted diagnostic
(stack frames + safe context, never raw payload) loads only after its occurrence is selected; see
[security.md](./security.md). Every resource has an independent server mirror and persisted TanStack
Query key ([caching.md](./caching.md)). Row selection, mapped-repo/branch task promotion (`+ ws`, which
focuses an existing task instead of duplicating), and attach-to-current-task are distinct actions.
The item counter links through Rollbar's account-independent item permalink (system item ID), while
an occurrence counter links through Rollbar's documented UUID redirect; both URLs are normalized
server-side and cached with their resource. Links retain the canonical system item id; legacy
counter-only links still resolve. Read-only in P1:
no Rollbar mutations, no write scope.

Rollbar instance endpoints place the notifier payload under `result.data` (`data.body.trace`,
`data.body.trace_chain`, or `data.body.message`); `id` and `timestamp` remain result-level siblings.
The upstream type retains `occurrence` only as a compatibility alias. Normalization always happens
before caching, and the raw `data` object never crosses the server boundary.

## Conformance and adding a provider

`core/server/integrations/conformance.test.ts` iterates both registries. Every connection provider is
checked for public-secret hygiene, executable lifecycle behavior, and positive request budgets.
External-item providers are additionally checked for capability obligations, cache
migration/malformed behavior, summary-over-detail preservation, degradation formatting, and the
no-accepted-memory-write invariant. Model registry/runtime and adapter suites cover connection
scope, encryption, state transitions, cancellation, request mapping, and error normalization without
live keys or network calls.

A Sentry-style dry run adds only provider-owned modules and registrations:

1. `plugins/sentry/server/provider.ts`—server descriptor, executable resources, connection
   hooks, codec, formatter, resolver, mutations, budgets, and conformance fixtures.
2. `plugins/sentry/server/routes/sentry.ts`—provider-owned HTTP router, registered by the activation list.
3. `plugins/sentry/client/SentryPane.tsx`—provider pane.
4. `plugins/sentry/client/SentryBrowse.tsx`—source browse/promotion UI.
5. One entry in the server built-in provider activation list and one client provider contribution.
6. Provider-specific parity tests and documentation.

No route switch, settings list, source switch, task-link writer, context formatter, schema change,
or conformance-test logic is required. OAuth refresh, webhooks/background ingestion, dynamic
uninstall, and multi-secret credentials are intentionally deferred until a provider requires them;
new work must extend the connection/resource contracts rather than bypass them.

A new model provider instead adds a connection descriptor and model adapter under
`plugins/model-providers/server/`, then registers both in `app/server/providers.ts`. It must not add
external ids, mirrored resources, task links, or a generic prompt route.
