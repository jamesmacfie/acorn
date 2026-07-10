# Integration providers

Acorn models Linear, Rollbar, and future third-party systems as integration-provider
contributions. Core owns connection storage, lifecycle, link integrity, and cache scheduling;
providers own authentication policy, cached-data codecs, context formatting, reference discovery,
mutations, capabilities, and operating budgets.

The implementation lives under `apps/desktop/src/core/server/integrations/`. Public cross-process types
live in `apps/desktop/src/core/shared/integrations.ts`; client source, pane, and link contributions live in
`apps/desktop/src/app/client/providerContributions.tsx`.

## Provider descriptor and registry

Every provider registers one `IntegrationProviderContribution` with:

- identity metadata (`id`, label, glyph, and kind);
- a connection contract (`fields`, `validate`, `normalize`, `test`);
- open-ended capabilities;
- executable mirrored-resource descriptors (`key`, `read`, `refresh`) and a versioned cache codec;
- optional linked-context formatter, reference resolver, and mutations;
- concurrency, pagination, cache, context, backoff, and resolution budgets;
- memory-evidence policy. Providers may propose evidence, but `acceptedWrites` is structurally
  false—accepted memory remains human-gated.

Activation rejects duplicate providers and inconsistent declarations. Writable comments require
an invalidating mutation; context formatting requires a codec and formatter; browse/promotion
requires a mirrored resource; every codec supplies table-driven conformance fixtures. Client
provider activation performs the corresponding provider-id cross-checks for source, pane, and
content-link contributions.

GitHub is registered as the non-connectable `identity` provider. Its connection is synthesized from
the authenticated session and cannot be rotated or disconnected. Linear and Rollbar are stored,
multi-row providers: each account/workspace/project connection has an opaque stable id.

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
comments, and XSS-safe markdown. Rollbar preserves visible counter identity, stale-cache fallback,
repo/branch prompting, and `+task` attachment.

## Conformance and adding a provider

`core/server/integrations/conformance.test.ts` iterates the registry. A provider is automatically checked
for public-secret hygiene, capability obligations, cache migration/malformed behavior,
summary-over-detail preservation, degradation formatting, positive budgets, and the no-accepted-
memory-write invariant. Route tests separately cover connection-derived link ids and exact lifecycle
row behavior.

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
