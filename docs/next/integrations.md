# Integration providers — the contract

**Status:** design contract · **Date:** 2026-07-07 · **Companions:**
[contribution-points.md](./contribution-points.md) §4.2/§4.6/§4.7/§4.9/§4.14,
[extensibility.md](./extensibility.md) §8.5, [implementation.md](./implementation.md)
Phase 7 + data-model track, [feature-parity.md](./feature-parity.md) §6,
[security.md](./security.md) §8, [testing.md](./testing.md) §2.6/§4

Citations elsewhere in the set use *(integrations §N)*.

Integration behaviour was previously distributed across six docs as scattered
notes — a source contribution here, a context-staleness rule there, a
`Provider` interface sketch in review.md. That was enough to prove Linear and
Rollbar have homes; it was not enough to build the next provider against. This
doc is the single normative contract: what an integration provider *is*, what
it must declare, and what core does with the declarations.

The forcing observation: **GitHub, Linear, and Rollbar are not three variants
of the same thing.** GitHub is both the identity root and a product
integration. Linear is a multi-workspace issue tracker with comments,
projects, suggested branches, and ambiguous bare identifiers. Rollbar is a
per-project error source with read-mostly items, weak repo affinity, and
fast-changing status. Sentry, Better Stack, and Notion will stress different
axes again: org/project scoping, OAuth vs API-key auth, issue/event/detail
splits, incidents/monitors/logs, page databases, webhooks. The contract below
names those axes explicitly so the first provider with OAuth, a self-hosted
base URL, or richer item identity extends the model instead of hitting a wall.

---

## 1. The provider descriptor

A provider is more than a source or a route namespace. Today the integration
lifecycle is split across unrelated registries — settings UI decides credential
collection, routes decide validation, mirrored resources decide caching, source
registration decides browse/promote, context sections decide what agents see —
with nothing relating them. A plugin could register a pane for links core
cannot validate, or a credential form that stores metadata no codec can parse.

The fix is one first-class contribution
([contribution-points.md](./contribution-points.md) §4.14) that every other
integration-related registration hangs off:

```ts
interface IntegrationProviderContribution {
  id: string                         // 'github', 'linear', 'rollbar', 'sentry'
  label: string
  kind: 'identity' | 'issue-tracker' | 'error-tracker' | 'doc-system'
      | 'observability' | 'generic'
  connection: ConnectionContract     // §3 — credential fields, validate, normalize
  externalIds: ExternalIdContract    // §5 — how identifiers map to ExternalRef
  capabilities: ProviderCapabilities // §4 — machine-readable feature flags
  resources: MirroredResource[]      // §7 — sync descriptors (points §4.9)
  codec: CachedItemCodec             // §7 — parse/version/migrate issues.data
  taskContext?: LinkContextFormatter // §9 — provider-owned context formatting
  refs?: ReferenceResolver           // §13 — detect/resolve external refs in text
  mutations?: ProviderMutation[]     // §11 — declared write actions with risk tiers
  budgets?: ProviderBudgets          // §17 — request/pagination/context limits
  lifecycle?: ProviderLifecycleHooks // §14 — disconnect/reauth/rotate overrides
}
```

Core owns the registry and the cross-checks at activation: a source, pane,
context section, settings page, content link, or agent tool that names a
`providerId` must name a registered one; a provider whose capabilities declare
`comments: 'write'` must supply the matching mutation; a provider with linked
items must supply a codec and (if it contributes context) a formatter. These
are activation-time errors, not runtime surprises — the same posture as the
TOML loader's parse errors *(points §4.10)*.

The exact field names are the implementing phase's to finalize (the standing
rule from [contribution-points.md](./contribution-points.md) applies — the
phase wins, update this doc when it diverges). The *concept* is not
negotiable: the descriptor exists, it is the join point, and core validates
the joins.

## 2. GitHub: identity connection vs product capabilities

The docs correctly keep GitHub authentication in core (the session's `user_id`
is the GitHub login — [extensibility.md](./extensibility.md) §2.2) while GitHub
PR review becomes a plugin. "GitHub is synthesized" is not a complete contract,
though. The boundary, drawn tightly:

- **Identity connection: core-owned, mandatory, session-backed, not
  disconnectable.** Core synthesizes a real `IntegrationConnection`-shaped
  object (`authKind: 'github-session'`) into the same connection registry that
  stored connections live in — it is not a special case in `/api/integrations`
  that every generic API branches around. Its secret ref is the session; there
  is nothing to rotate or disconnect through the integration lifecycle
  (revoking it is logout).
- **GitHub product capabilities: plugin-owned, scope-checked, disableable.**
  The github plugin declares its capabilities (§4) like any provider. The
  settings UI shows capability states, not a single connected boolean: a
  logged-in user can be authenticated yet missing a scope, and the OAuth
  permissions re-request (the existing settings feature —
  [security.md](./security.md) invariant 10) is the remedy surface. Scope
  requirements are declared per capability group: identity-only, PR read, PR
  write (comments/reviews/merge/labels/reviewers/auto-merge), checks + action
  reruns, repo listing.
- **Repo-level authorization failures are resource errors, not connection
  status.** SAML SSO, rate limits, and permission errors on one repo do not
  mean the provider is disconnected; they map to the resource-level error
  codes in §12 and the existing folded vocabulary (`sso`, `rate_limited`,
  `reauth`) stays byte-identical *(parity §16, security invariant 9)*.
- **Disabling the github plugin** (extensibility tenet 6) leaves GitHub auth
  active and its persisted rows inert: tasks keep their `pullNumber` and
  origin, PR panes disappear from the registry (persisted layouts retain the
  id inert), the `checks-green` policy becomes an unknown-policy parse error
  on workflows that name it, and GitHub mirror rows stop refreshing but are
  not deleted. This is the disable column of the §14 lifecycle table applied
  to the one provider whose identity outlives its product surface.
- **`ctx.gh` stays a core service** (state §5) — the REST/GraphQL clients and
  the `ghError` taxonomy. The github plugin is its main consumer, but core
  auth needs the client for the OAuth flow and other plugins may read
  rate-limit state; the dependency points plugin → core, never core → plugin.

## 3. Connections: auth, config, and provider hooks

The current `integrations` row — `provider`, `label`, encrypted `accessToken`,
untyped JSON `meta`, `createdAt` — is too token-centric. Future providers need
API keys, OAuth access+refresh tokens, expiry, base URLs/regions (self-hosted
Sentry, Better Stack regions), an auth subject distinct from the display label
(org/workspace/project/installation id), scopes known at connect time, health
state, and secret rotation that does not destroy links and caches.

The target connection model — what core stores and every generic surface
reads:

```ts
type IntegrationConnection = {
  id: string
  providerId: string                 // stamped by core, never client-supplied (§5)
  userId: string
  label: string                      // user override wins over provider-seeded label
  authKind: 'github-session' | 'api-key' | 'oauth' | 'installation' | 'none'
  authRef: SecretRef | null          // encrypted secret material; never in responses
  account: ProviderAccountRef | null // auth subject: org/workspace/project id + display
  scopes: string[]
  capabilities: Record<string, CapabilityState>  // §4 — resolved at validation
  config: unknown                    // provider codec-owned (base URL, region, …)
  status: 'connected' | 'needs-auth' | 'degraded' | 'disabled'
  createdAt: number
  updatedAt: number
  lastValidatedAt?: number
  lastError?: ProviderErrorCode      // §12 — why status is degraded/needs-auth
}
```

The tiering rule: **typed columns for what core behaviour depends on**
(`status`, `authKind`, `lastValidatedAt`, account/label — core renders health,
schedules revalidation, and gates capabilities off these), **provider
codec-owned `config` for the rest** (validated at the read seam like every
JSON blob — implementation decision 2's untrusted boundary), **and secret
material only ever in `authRef`** (encrypted under `SESSION_ENC_KEY`, per
security invariant 7). "Optional JSON meta" as a catch-all is retired: `meta`
contents migrate into `config` under the provider's codec, and anything core
reads generically gets a column. The migration is incremental — columns land
with the first provider that needs them — but *where each datum belongs* is
decided here, not per-provider.

**Credential collection and validation are provider hooks; storage is one
core path.** Settings UI may be custom per provider, but a provider never
writes the `integrations` table itself. The `ConnectionContract`:

```ts
interface ConnectionContract {
  fields: CredentialField[] | { component: Component }   // declarative preferred
  validate(input): Promise<ValidationResult>              // server-side, pre-storage
  normalize(input, result): NormalizedConnection          // label/account/config/scopes
  test(connection): Promise<HealthResult>                 // settings health check
  refreshAuth?(connection): Promise<RefreshResult>        // OAuth/expiring providers
  revoke?(connection): Promise<void>                      // remote revocation, if supported
  summarize(connection): ConnectionSummary                // settings display, no secrets
}
```

Core drives the flow: collect (rendering `fields` or the custom component) →
`validate` → `normalize` → encrypt + store + stamp audit fields → `test` on
demand. Rotation (§14) re-runs validate/normalize against the *existing*
connection id. Because the provider returns a typed normalized payload and
core performs the write, encryption, health state, and audit fields stay
uniform across providers — custom-by-convention storage is exactly what this
forbids. This replaces `IntegrationsSettings.tsx`'s hardcoded provider
metadata and single password field, and the per-provider if-else in
`integrations.ts`.

**OAuth-flow providers** (deferred until the first one lands, contract named
now): the redirect/callback route is core-owned
(`/auth/integrations/:providerId/callback`), binds provider id + CSRF state
into the OAuth `state` parameter, and hands the code to the provider's
`validate`. Refresh is `refreshAuth` invoked by core when a fetch returns
`provider_needs_auth` and `authKind === 'oauth'`; a failed refresh flips
`status: 'needs-auth'` and surfaces in settings and as a notice.

## 4. Capabilities

Linear supports comments and branch suggestions; Rollbar is read-mostly with
attach-to-task as its main flow; GitHub has high-risk writes; Sentry will add
resolve/assign; Better Stack incident ack is operationally dangerous; Notion
has no issue state at all. Without a declared model every pane and source
hand-rolls "what can this provider do?".

```ts
type ProviderCapabilities = {
  browse?: boolean
  linkExisting?: boolean             // attach an existing item to a task
  promoteToTask?: boolean
  comments?: 'none' | 'read' | 'write'
  statusMutation?: boolean           // resolve/close/assign-style writes
  assignment?: boolean
  branchSuggestion?: boolean
  repoAffinity?: 'intrinsic' | 'project' | 'workspace' | 'none'
  contextFormat?: boolean
  webhooks?: boolean                 // §15 — declared, not yet consumed
  userFeed?: boolean                 // ext §9.1 — can produce a user-scoped feed
                                     //   (assigned-to-me, inbox); declared, not yet consumed
}
```

The set is **open by design** — a new capability is additive data, not a
breaking change to a closed union. `webhooks` and `userFeed` are the current
declared-but-not-yet-consumed markers: `userFeed` reserves the "this provider
can produce a user-scoped, repo-less feed" flag a future dashboard (ext §9.1)
would gate cards on, so providers that can't (e.g. an error tracker with no
per-user assignment) simply omit it and contribute no card.

Capabilities are declared per provider and *resolved per connection* at
validation time (a token may lack the scope for a declared capability —
`CapabilityState` on the connection records `available | missing-scope |
degraded`). Consumers:

- **UI affordances** — panes/sources show or hide comment boxes, promote
  buttons, branch-name seeds by reading capabilities, not by knowing the
  provider.
- **Agent-tool exposure** (§16) — generic integration tools filter on
  capability; provider write tools must name the capability they require.
- **Mutation gating** (§11) — a mutation whose capability is absent is a
  `provider_missing_scope` error before any upstream call.
- **Conformance tests** (§18) — the suite is table-driven off declared
  capabilities: declare `comments: 'write'` and the suite demands the
  mutation, the cache-invalidation policy, and the error mapping.

## 5. External refs and link integrity

`task_links` is `(taskId, integrationId, identifier)` with a denormalized
`provider` string. Two gaps: identifier shape and write integrity.

**Identity.** Providers differ in what identifies an item: Linear has `ENG-42`
*and* an internal UUID; Rollbar's visible counter is the app identifier;
GitHub PRs are owner/name/number plus numeric ids plus node ids; Sentry has
issue ids, short ids, event ids, and org/project slugs; Notion page ids have
no stable human name. The generic contract distinguishes what current code
conflates:

```ts
type ExternalRef = {
  providerId: string
  connectionId: string               // which credential resolves the locator
  displayId: string                  // what users see: 'ENG-42', '#142'
  externalId?: string                // stable provider id for API calls
  url?: string                       // canonical web URL
  locator?: Record<string, string>   // API scope: { org, project, issue } etc.
}
```

`task_links.identifier` remains the display id. The provider's
`ExternalIdContract` declares how a stored `identifier` expands to a full
`ExternalRef` for simple providers (Linear: identifier + connection is
enough); providers whose refs need more scope store the full ref in a nullable
`task_links.refJson` column (data-model track), validated by the provider
codec on read like every JSON blob. Without this, Sentry-style providers push
opaque JSON into `issues.data` and panes/context/tools guess their way back
out — the exact shape-guessing Phase 7 deletes.

**Integrity.** Task-link writes currently accept `{ integrationId, provider,
identifier }` from the client and insert them directly — nothing validates
that `provider` matches the integration row. Tolerable with hardcoded UI;
not with plugins, and not once agent tools can create links. The rule, both
data integrity and security:

- The client (or agent tool) sends `connectionId` + the provider-owned ref.
- **Core loads the connection and stamps `providerId` from it** — the
  denormalized column becomes derived data, never caller-supplied.
- A provider with no connection concept declares that explicitly
  (`authKind: 'none'`) and core stamps from the descriptor.
- A plugin cannot forge another provider's links by passing a string; an
  agent tool cannot create rows whose provider and connection disagree.

## 6. Scope bindings: workspace, repo, and beyond

`workspace_projects` (workspace ↔ Linear project) is one relationship type
presented as if it were the model. The relationships providers actually need:
workspace ↔ provider project/team/service, repo ↔ Sentry project / Better
Stack service / Notion database, provider project ↔ multiple repos,
account-level defaults independent of any workspace. The generic contract:

```ts
type ExternalBinding = {
  ownerScope: 'app' | 'workspace' | 'repo' | 'task'
  ownerId: string
  providerId: string                 // stamped from connection, as in §5
  connectionId: string
  externalType: 'project' | 'team' | 'service' | 'database' | 'repo' | string
  externalId: string
  config?: unknown                   // provider codec-owned per-binding config
}
```

Implementation is incremental: **`workspace_projects` is documented as the
first binding table** (ownerScope `workspace`, externalType `project`) and
stays as-is through Phase 7; the generalized table lands with the first
provider needing repo-scoped or multi-type bindings (Sentry is the likely
trigger). What changes now is the docs' claim: the table is an instance of
this contract, not the completed model. Binding deletion follows declared
parent lineage (ext §8.5) — workspace removal clears its bindings the same
derived way it clears `workspace_config`.

Settings surfaces split along the same lines (this resolves the
provider/connection/workspace config ambiguity): **provider-level** static
metadata and docs (plugin code), **connection config** (§3 — account, base
URL, token, health; the integrations settings page), **workspace binding
config** (which external projects/services matter to this workspace — the
Linear project picker generalized), **repo binding config** (per-repo
overrides, when a provider needs them), and **view preferences** (filters,
sorts, collapsed sections — ordinary T3 prefs slices, state §5.1a). A
provider declares which of these surfaces it contributes; each writes through
its own tier's store, never a neighbour's.

## 7. Cache, sync, and codecs

Mirrored-resource descriptors *(points §4.9)* give providers the sync engine;
this section adds the invariants the engine cannot infer.

**The summary/detail invariant: a list fetch must never clobber detail.**
Linear already encodes this subtly — batch summaries preserve prior
`description`, `comments`, `activity`; Rollbar's list and detail share one
shape today; Sentry will have distinct issue-list, issue-detail, event,
comment, and release payloads. The generic cached-item shape:

```ts
type CachedExternalItem<TSummary, TDetail> = {
  ref: ExternalRef
  summary: TSummary
  detail?: TDetail
  listFetchedAt?: number
  detailFetchedAt?: number
  schemaVersion: number
  deletedAt?: number                 // tombstone: provider-deleted, kept for links
}
```

The full shape is the target; the invariant is binding from Phase 7 even
where the storage stays `issues.data` — a provider's `persist` for a list
fetch merges over prior detail fields, never replaces the row wholesale, and
the conformance suite (§18) feeds a detailed row through a list refresh to
prove it.

**Cold/stale/failed policy for linked items** (extends the context rule
already stated in *points §4.7*): serve stale marked as stale; a missing
cache row yields an explicitly absent marker, never a silent hole and never
a blocking fetch inside context assembly; a failed connection degrades to
stale cache where it exists (Rollbar's stale-beats-nothing behaviour —
*parity §6* — becomes the generic rule). Browse views may block on cold
fetches; linked-item surfaces (panes, context) must not.

**Tombstones:** a provider-deleted item keeps its row with `deletedAt` while
any task link references it — panes and context render "deleted upstream"
rather than a hole; the row prunes with the last link.

**Codecs are part of the provider schema, not a convenience.** Every provider
declares: the current `schemaVersion`; `parseSummary(raw)` /
`parseDetail(raw)` (or one `parseCachedItem`); normalization from older
versions (read-time normalization + next-write upgrade, per state §5.1a —
never resets); safe fallback on malformed rows (render identifier-only, log,
don't throw); what persists after list vs detail fetches; and what is
*excluded* — fields too large, secret-bearing, or reconstructable. Core never
reads provider blob shapes; `taskContext.ts`'s `state?.name ?? status ??
level` guessing is deleted, not generalized.

**Per-connection discipline** rides the sync engine: in-flight dedupe and
rate-limit backoff are keyed per connection, not just per provider (two
Linear workspaces back off independently); pagination caps come from the
provider's budgets (§17).

## 8. Browse, promote, and attach

Promotion is where provider data crosses into core task state — worktree
creation, repo selection, branch naming, task links, default panes — so
`seedTask?: (item) => TaskSeed` is too loose. The typed contract lives on the
source contribution (*points §4.2* carries the shape:
`canPromote`/`prepare`/`confirm`/`create`/`afterCreate`); this section pins
the integration semantics each provider must answer through it:

- **Repo affinity** comes from the capability declaration (§4): `intrinsic`
  (a GitHub PR knows its repo), `project`/`workspace` (resolved through
  bindings, §6), or `none` (Rollbar-style — `prepare` must ask the user to
  pick repo and branch). Core renders the picker; the provider declares the
  need.
- **Branch suggestion**: providers with `branchSuggestion` seed the branch
  name (Linear's `branchName` — *parity §6*); core owns deduping against
  existing branches/worktrees, feeding the same branch ladder every task
  creation uses *(parity §2)*.
- **Title derivation and links at birth** are `prepare`'s output: the
  `TaskDraft` names the task title and the `ExternalRef`s to link on
  creation, written through the stamped path (§5).
- **Which pane opens** stays the source's `defaultPane` plus core's
  activation fallback ladder *(points §4.2)*.
- **Already-linked items**: `canPromote` returns a `PromotionMode` — if the
  item is already linked to an active task, the mode is
  `navigate-to-existing`, not a duplicate task. Core supplies the existing
  link lookup; the provider doesn't re-implement it.
- **Attach-to-current-task is a distinct mode**, not a degenerate promote:
  providers with `linkExisting` support attaching from browse (Rollbar's
  `+task` — *parity §6* names it a core flow) without leaving the current
  task.
- **Provider write-backs on create** (e.g. commenting a back-link on the
  Linear issue) happen in `afterCreate`, are declared mutations (§11), and
  failures there surface as notices — the task creation itself has already
  succeeded and must not roll back.

## 9. Context formatting

Context sections are contributions *(points §4.7)*; what was missing is the
per-provider contract behind the generic "issues" section. Core asks the
provider registered for `link.providerId` to format its own cached rows:

```ts
interface LinkContextFormatter<T> {
  parseCached(raw: unknown): ParseResult<T>          // the §7 codec, reused
  summarize(ref: ExternalRef, item: T | null, state: CacheState): ContextItem
  detail?(ref: ExternalRef, item: T, budget: Budget): ContextItem
}
```

Each provider declares: the compact summary format; the expanded detail
format; max items and byte budget (feeding the section's declared budget —
no invisible slice, *points §4.7*); staleness marker semantics; which fields
are safe and useful for agents; whether comments/activity are included,
summarized, indexed-only, or omitted; and the missing-cache posture (absent
marker vs identifier-only — never a blocking refresh). When several providers
contribute linked items, ordering is core policy (stable: provider id, then
link creation time), not a per-provider negotiation.

## 10. Pane intents

Integration panes receive `{ task }` like every pane *(points §4.1)* and
today filter task links internally with pane-private chip state. That
underspecifies cross-plugin navigation: opening a specific linked item from
a context-tray jump, opening the pane right after attaching a link, jumping
from a content link to an item or comment, and handling multiple links from
one provider. The core mechanism already exists — `openPane(id, intent)`
(ext §3.4); integration panes declare their supported intents:

```ts
type IntegrationPaneIntent =
  | { type: 'show-ref'; ref: ExternalRef }
  | { type: 'show-comment'; ref: ExternalRef; commentId: string }
  | { type: 'compose-comment'; ref: ExternalRef; quotedText?: string }
```

An intent naming a ref the pane can't resolve renders the pane's normal state
with a notice-level marker, never a throw (tenet 6 at the intent level).
Multi-provider "linked context" panes, if ever wanted, compose the same
intents — which is exactly why they route through the dispatcher and not
pane-private signals.

## 11. Mutations

Linear has comment creation; GitHub has merge/review/rerun; Rollbar is
read-mostly; Sentry will add resolve/assign; Better Stack incident ack should
never be an agent default. Routes and tools alone don't capture write
semantics — each provider mutation is declared:

```ts
interface ProviderMutation {
  id: string                          // 'linear.comment', 'sentry.resolve'
  capability: keyof ProviderCapabilities   // gate: absent capability = no mutation
  risk: 'write' | 'execute'           // the agent-tool taxonomy (points §4.8), reused
  freshness?: 'live-fetch-first'      // writes that must not act on stale state
  invalidates: ResourceSelector[]     // cache invalidation after success
  idempotent: boolean                 // retry posture on network failure
  run(input, ctx): Promise<Result>    // errors map to §12 codes
}
```

Rules the declaration carries:

- **Provenance is recorded** the same way agent tools already record it —
  user action, agent action, or workflow action comes from the calling
  channel's scope, never self-reported.
- **Optimistic updates are opt-in and named**; the default is
  invalidate-and-refetch (Linear's comment flow today: write, refetch detail,
  preserve thread parent id — *parity §6*).
- **Agent exposure derives from this declaration** — the agent-tool
  permission registry consumes the mutation's `risk` tier; a plugin does not
  invent its own risk labels. High-operational-risk mutations (incident
  ack/resolve) ship agent-disabled by default regardless of tier.
- **Error codes** map to the §12 taxonomy; upstream prose rides in `detail`.

## 12. Error taxonomy

The API envelope is standardized (Phase 0's `ApiError`); provider errors are
not — `linear_not_connected`, `rollbar_not_connected`, `invalid_key`, and
upstream status leaks are scattered per provider. Generic categories, because
core UI and agent-tool projection need to *behave* off them:

```ts
type ProviderErrorCode =
  | 'provider_not_connected'
  | 'provider_needs_auth'          // reauth/refresh required
  | 'provider_missing_scope'
  | 'provider_rate_limited'
  | 'provider_unavailable'         // upstream down/unreachable
  | 'provider_resource_not_found'
  | 'provider_resource_deleted'
  | 'provider_resource_forbidden'  // SSO/org authorization, per-resource
  | 'provider_bad_config'
  | 'provider_secret_unreadable'   // decrypt failure — rotation/backup case
```

Provider-specific detail attaches in `detail`; a provider may add
provider-scoped codes for cases with no generic behaviour, but every error a
generic surface handles carries a generic code. Migration is a **deliberate
Phase 7 rename with client branches updated in the same PR** — not Phase 0's
mechanical sweep, which never changes vocabulary *(parity §16)*. The GitHub
identity foldings (`reauth`, `sso`, `rate_limited`) are core vocabulary tied
to the session flow and stay byte-identical (security invariant 9); the
github *product* plugin maps its per-resource failures onto the generic codes
like any provider at the surfaces that need generic behaviour.

Status mapping: `provider_not_connected` / `provider_needs_auth` /
`provider_bad_config` / `provider_secret_unreadable` reflect connection
`status` (§3) and render in settings health; `rate_limited` / `unavailable`
trigger backoff (§7) and degrade to stale cache; the `resource_*` codes are
per-item and never flip connection status (§2's GitHub lesson, generalized).

## 13. Reference discovery and resolution

Linear's linkifier (scanning `linear.app` URLs in PR text) is the seed of a
deeper requirement: discovered references should be resolvable into task
links and context, and resolution must be provider-owned and
connection-aware. Bare identifiers are dangerous — Linear's `ENG-42`
first-hit-wins across connections is a documented ceiling *(parity §6)*;
Sentry/Better Stack URLs carry org/project scope that picks the connection;
Notion links carry page ids with no title until fetched.

```ts
interface ReferenceResolver {
  detectRefs(text: string, source: ContentContext): CandidateRef[]  // with confidence
  resolveRef(candidate: CandidateRef, connections: IntegrationConnection[]):
    Promise<ExternalRef | null>
  linkify(ref: ExternalRef): NavigationTarget          // the content-link contribution
  canAutoLink(ref: ExternalRef): 'attach' | 'suggest' | 'linkify-only'
}
```

`linkify` is what the existing content-link point *(points §4.13)* consumes;
`detect`/`resolve`/`canAutoLink` are the layers behind it that make a
discovered ref attachable (through the §5 write path — resolution produces a
`connectionId`, so the stamped provider id is honest). URL-scoped refs
resolve deterministically; bare identifiers keep first-hit-wins as the
*declared* ceiling until a provider needs better, and `canAutoLink` defaults
to `linkify-only` — automatic attachment is a per-provider, per-confidence
decision, not a default.

## 14. Lifecycle: connect, validate, reauth, rotate, disable, disconnect, uninstall

Today's disconnect is one destructive cascade (workspace projects, cached
issues, task links, the integration row). Plugin disable is a different
operation the same cascade must not serve. The semantics, separated:

| Operation | Connection row | Secrets | Cached items | Task links | Bindings |
| --- | --- | --- | --- | --- | --- |
| **Connect** | created via §3 flow | encrypted, stored | — | — | — |
| **Validate/test** | `lastValidatedAt`, capability states updated | — | — | — | — |
| **Reauth needed** | `status: 'needs-auth'` | kept | kept, served stale | kept, render stale | kept |
| **Rotate secret** | **id stable**, `authRef` replaced | replaced | kept | kept | kept |
| **Disable plugin** | kept, inert | kept | kept, no refresh | kept, inert render | kept |
| **Disconnect** | deleted | deleted | deleted (default) | deleted (default) | deleted |
| **Uninstall (future dynamic)** | provider id unknown → rows inert | kept until explicit cleanup | kept | kept | kept |

Disconnect's cascade becomes a **core default the provider's
`ProviderLifecycleHooks` can extend, not replace** — a provider may add
remote revocation (`revoke`, §3) or confirmation copy ("N tasks will lose
linked context"), but the row deletion order and completeness are core-owned
so no provider leaves orphans. The disconnect confirmation rides the
will-phase dialog pattern *(state §5, ux §1)*: plugins with linked state
surface concerns; the user decides.

Rotation is the case the current model cannot express at all (delete +
re-add changes the integration id and severs every link); with §3's
normalized flow it is a re-validate against a stable id.

## 15. Webhooks and background ingestion — the named seam

**Deferred, deliberately.** The app is polling/local-fetch oriented and that
is sufficient for GitHub/Linear/Rollbar. But the seam is named now so a
future webhook implementation extends the data path instead of bypassing it:
**provider event ingestion normalizes into mirrored-resource invalidations**
(the §7 descriptors — an event marks a resource stale and lets the engine
refetch, rather than writing rows directly), plus optionally a notification
*(points §4.13)* and a task-link suggestion (§13's `canAutoLink: 'suggest'`
path). Providers declare `webhooks: true` in capabilities when they have an
ingestion story; nothing consumes it yet. If ingestion lands, handlers need
signature verification and replay windows ([security.md](./security.md) §8)
— and a loopback app additionally needs a reachability story (relay or
tunnel) that is out of scope here.

## 16. Agent tools

Generic integration tools (core-owned, capability-filtered):

- list connections with capability states (no secrets, ever);
- list linked external refs for the current task;
- fetch provider-formatted context for one linked ref (through §9 — the same
  stale-cache posture agents already get, *points §4.7*);
- attach an external ref to the current task, when the provider's resolver
  accepts it (§13) — a `write`-tier tool using the §5 stamped write path;
- search/browse provider items within configured bindings (§6), where
  capabilities allow.

These generalize today's `linked_issues` MCP tool, which is the "too generic
and lossy" end of the spectrum — it survives as the list-refs tool, and the
per-ref formatted fetch replaces its guessed detail.

Provider-owned tools ride the ordinary agent-tool point *(points §4.8)* with
integration-specific declarations on top: the connection/capability they
require (evaluated in `when` — a missing capability hides the tool, the same
mechanism as `hasRunTargets`), their operating scope (task/workspace/repo/
app), whether they write to the provider (the §11 mutation declaration is the
source of truth for risk tier), and whether they can create task links (only
via the stamped path). The risk-tier permission page *(ux §3)* thereby shows
provider write tools alongside everything else — one honest inventory.

## 16.1 Memory evidence and proposals

Provider data can inform memory, but providers do not own accepted memory.
The memory contract is [memory.md](./memory.md): accepted repo/private memory
is core-governed markdown, and non-human writes are proposals.

An integration may contribute:

- evidence formatting for a linked external ref, using the same codec,
  staleness markers, and budgets as §9 context formatting;
- memory candidate extraction from task-linked items, provider mutations,
  webhook/trigger events, or repeated workflow outcomes;
- agent tools that create links, fetch provider context, or propose memory
  through the core `memory_write` proposal path.

It may not:

- write `.acorn/memory/*.md` or `~/.acorn/memory/*.md` directly;
- store raw provider payloads, secrets, logs, or transient item status as
  memory;
- delete accepted memories on plugin disable, provider disconnect, or
  connection reauth failure.

Provider-sourced memory candidates must stamp `providerId`, `connectionId`,
and codec-owned `ExternalRef` provenance. If the connection later disappears,
the accepted memory remains and its evidence link renders inert, just like a
stale commit/file reference. Redaction/deletion of accepted memory is a
separate governance action, not part of integration cascade.

## 17. Performance budgets

The shared scheduler and cheap-predicate rules (state §5.2) apply; providers
additionally declare budgets the core enforces rather than trusts:

- max concurrent outbound requests per provider **and per connection**;
- pagination caps for browse views (and UI virtualization above the cap —
  Linear project lists and Notion databases will exceed any sane page);
- max cached item size (oversize payloads truncate at persist with a marker,
  the same posture as prefs `maxBytes` — state §5.1a);
- max linked items included in context (feeding §9's budget);
- backoff floors after rate limits or repeated failures (consumed by the
  sync engine's per-connection backoff, §7);
- batch-size limits for identifier resolution (Linear's batch issue fetch is
  the current instance).

Budgets live on the descriptor so they are greppable data like the TTLs
*(points §4.9)*.

## 18. Conformance suite

Rides the plugin conformance suite ([testing.md](./testing.md) §4),
table-driven off the provider descriptor — the goal is not mocking upstream
APIs but proving every provider obeys the app contract. For each registered
provider:

- connect-form validation accepts valid and rejects invalid credentials;
  normalization stores no secret in any public response;
- provider metadata renders from the registry (no hardcoded central lists);
- task-link creation derives provider id from the connection; a mismatched
  client-supplied provider is rejected (§5);
- the cache codec tolerates current, old-version, and malformed blobs; a
  list refresh over a detailed row preserves detail (§7);
- browse handles empty, stale, failed, paginated, and rate-limited responses;
- promote/attach produces the declared task draft, seed, and links (§8);
- the pane renders missing cache, stale cache, deleted item (tombstone),
  multiple links, and malformed data without throwing, and handles its
  declared intents (§10);
- the context formatter respects declared budgets and staleness markers (§9);
- disconnect/disable/reauth/rotate preserve or remove exactly the §14 table's
  rows;
- agent tools honor capability and permission gates (§16);
- declared capabilities have their obligations: `comments: 'write'` has a
  mutation with invalidation policy, `contextFormat` has a formatter, and so
  on (§4).

The provider-specific *behaviours* (Linear first-hit-wins, Rollbar
stale-beats-nothing, threaded replies) remain the parity regression tests of
*(parity §6)* — conformance proves contract obedience, parity proves the
shipped providers didn't change.

## 19. Minimum contract before provider #3

The gate implementation Phase 7 enforces (its "before integration #3"
deadline, made concrete). Before Sentry, Better Stack, Notion, or any
non-trivial provider lands, these exist:

1. The `IntegrationProviderContribution` registry with activation-time
   cross-checks (§1).
2. The normalized connection model — typed columns for core-read fields,
   codec-owned `config`, `SecretRef` for secrets (§3).
3. Core-owned connect/validate/store/rotate/disconnect flow driven by
   provider hooks (§3, §14).
4. Core-derived provider id on task links and bindings (§5, §6).
5. `ExternalRef` as the link identity model; `refJson` available for
   providers that need locators (§5).
6. Provider-owned codecs for `issues.data` with the summary/detail merge
   invariant (§7).
7. The typed promotion/attach contract on source contributions (§8,
   *points §4.2*).
8. Provider-owned context formatters; core shape-guessing deleted (§9).
9. Capability declarations consumed by UI, mutations, and agent tools (§4).
10. The generic provider error taxonomy with the deliberate code migration
    (§12).
11. The conformance suite running against Linear and Rollbar expressed as
    providers (§18).

Deferred with named seams: OAuth flow + refresh (§3 — first OAuth provider),
the generalized `ExternalBinding` table (§6 — first repo-scoped binding),
webhooks (§15), pane multi-item "linked context" composition (§10), and
multi-secret connections (§3's model holds one `authRef`; a provider
separating read/write tokens extends `SecretRef` to a keyed set — nothing
else changes).

Linear and Rollbar re-expressed through this contract are the proof the
abstractions are real; the Sentry dry-run file list (Phase 7's done
criterion) is the proof they are sufficient. If the dry run shows a Sentry
integration touching core files, the contract — not the dry run — is what
gets fixed.
