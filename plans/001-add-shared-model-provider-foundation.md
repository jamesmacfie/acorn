# Add a shared model-provider foundation

Status: proposed
Priority: P1
Effort: L
Risk: medium
Category: architecture / feature foundation
Planned at: `d39f7797e9b76eae582b596b194084dacbf0c351` on 2026-07-24

## Summary

Add a built-in `model-providers` plugin that lets a user save direct OpenAI and Anthropic API keys
in Settings and lets any server-side plugin use the configured connection through a
provider-neutral core text-generation runtime.

The implementation should reuse Acorn's existing encrypted `integrations` rows, connection
lifecycle routes, and descriptor-driven Settings UI. It should first separate that reusable
connection layer from the external-item integration contract. OpenAI and Anthropic are credentialed
integrations, but they are not sources of task links, mirrored resources, comments, or external
references.

This plan deliberately does **not** add AI query generation to the database plugin. It establishes
the boundary that the later database work will consume.

## Product naming

Use:

- Plugin folder and capability name: `model-providers`
- Settings language: **Model providers**
- Provider labels: **OpenAI** and **Anthropic**
- Connection capability: `textGeneration`

`model-providers` is narrower and more durable than `ai`, while avoiding the implementation jargon
of `llm`. The credential belongs to Anthropic, not to a single Claude model, so the provider should
be called Anthropic even if the UI later mentions Claude models.

## Goals

- A user can add, rotate, test, disable, and remove an OpenAI or Anthropic API key through the
  existing Integrations settings surface.
- API keys remain write-only in the renderer and encrypted at rest with `SESSION_ENC_KEY`.
- A server-side plugin can:
  - list safe connection summaries and determine whether text generation is available;
  - select a concrete connection by opaque connection ID;
  - request one-shot text generation without importing OpenAI/Anthropic plugin code;
  - receive provider-neutral text, model identity, and token-usage metadata when available.
- The architecture remains open to additional model providers and consumers.
- Existing GitHub, Linear, and Rollbar integration behavior remains unchanged.
- No new core-to-plugin or plugin-to-plugin dependency edge is added.

## Non-goals

- Do not modify the database plugin in this change.
- Do not add a generic browser-accessible "send any prompt" endpoint.
- Do not add chat threads, streaming, attachments, tool calling, embeddings, image generation,
  prompt history, usage billing, or cost dashboards.
- Do not support OpenAI-compatible custom endpoints, Azure OpenAI, Amazon Bedrock, or Vertex AI in
  the first cut.
- Do not expose API keys through internal HTTP, the public automation API, logs, errors, telemetry,
  or provider adapter results.
- Do not create a second credential table or a second credential-management UI.
- Do not make model providers participate in task links, external references, mirrored resources,
  or provider-owned source routes.

## Current architecture and constraints

### The existing storage model is already suitable

`apps/desktop/src/core/server/db/schema.ts:240` defines `integrations` as an opaque, per-user,
multi-row provider connection store. Its `authRef` value is encrypted before insertion, while
account, scope, capability, status, configuration, and validation metadata are stored separately.
This is the right persistence model for model-provider API keys, so this work should not need a
schema migration.

`apps/desktop/src/core/server/integrations/connections.ts:84` already owns the correct lifecycle:
provider validation, normalization, encryption, rotation, health tests, disabling, and deletion.
The renderer only receives the safe summary defined by
`apps/desktop/src/core/shared/api.ts:95-115`.

### The current provider registry combines two distinct concepts

`apps/desktop/src/core/server/integrations/types.ts:122` requires every
`IntegrationProviderContribution` to implement:

- credential connection behavior;
- external ID parsing;
- mirrored resources;
- task context and references;
- mutations;
- external-resource budgets and memory evidence policy.

`apps/desktop/src/core/server/integrations/registry.ts:7` and
`apps/desktop/src/core/server/integrations/conformance.test.ts:5` enforce those external-item
obligations. Registering OpenAI or Anthropic directly would therefore require meaningless dummy
resources, IDs, memory rules, and HTTP routers. That would make the types lie about the domain.

The correct seam is a small connection-provider contract shared by external-item integrations and
model providers, with separate registries for their domain-specific behavior.

### Settings is already descriptor-driven

`apps/desktop/src/core/client/settings/IntegrationsSettings.tsx:15-143` renders provider chips and
credential fields from the public provider catalog, then calls the generic connection lifecycle.
Adding provider descriptors is enough to produce the API-key inputs; a model-provider-specific
settings page is unnecessary.

The component currently imports generic lifecycle helpers from
`plugins/github/client/mutations.ts:74-87`. That is existing baselined core-to-plugin debt
(`core/boundaries.test.ts:116`) and should be corrected while this shared foundation is introduced.

### Cross-plugin access must go through core

`docs/plugins.md:12-13` defines plugins as statically composed contributions consumed through a core
registry or injected capability. `core/boundaries.test.ts:192` rejects new plugin-to-plugin imports.
Future database code must therefore import a core model runtime, never
`plugins/model-providers/server/openai` or `.../anthropic`.

### The future database consumer has two separate responsibilities

The database connection and schema live behind `DatabaseBridge`
(`plugins/database/server/routes/database.ts:14-27`), implemented by the per-task Postgres pools in
`plugins/database/main/database.ts:149`. The later database feature should:

1. ask its own bridge for a schema-only snapshot;
2. build its own SQL-generation prompt;
3. call the core model runtime with a selected connection ID;
4. return generated SQL to its editor without executing it.

The model-provider foundation should not know about Postgres, tasks, schemas, or SQL.

### Prior chat design is useful but not authoritative

`docs/next/chat/README.md:80-82` correctly says model providers must not be forced into the
external-item integration registry. It also proposes separate workspace-scoped credentials. The
latter conflicts with the new app-wide shared-provider requirement and would duplicate the existing
connection lifecycle. This implementation should update the future chat notes so chat can later
consume the shared connection foundation and store only workspace-level provider/model preferences.

## Target architecture

```text
Settings / any client plugin
        |
        | safe catalog + connection summaries only
        v
core connection routes and registry
        |
        | encrypted integrations row, selected by user + connection ID
        v
core model-provider runtime
        |
        | provider-neutral request, decrypted key scoped to one call
        v
model-providers plugin adapter
        |
        +---- OpenAI Responses API
        |
        +---- Anthropic Messages API
```

The split is:

- **Connection provider:** credential fields, validation, normalization, public metadata, connection
  health, capabilities, and request-concurrency limits.
- **External-item integration:** existing source/link/cache/ref behavior, extending a connection
  provider.
- **Model provider adapter:** one-shot text generation for one connection provider.
- **Consumer plugin:** owns the feature route, prompt, domain context, validation, and UI.

## Proposed contracts

The exact names may be adjusted to match nearby style, but the responsibilities must remain narrow.

### Connection provider

Add `ConnectionProviderContribution` in
`apps/desktop/src/core/server/integrations/types.ts`:

```ts
type ProviderRequestBudgets = Pick<
  ProviderBudgets,
  'maxConcurrentRequests' | 'maxConcurrentRequestsPerConnection'
>

type ConnectionProviderContribution = {
  id: string
  label: string
  glyph: string
  kind: IntegrationProviderKind
  connection: ConnectionContract<unknown>
  capabilities: ProviderCapabilities
  budgets: ProviderRequestBudgets
  toPublic(): PublicIntegrationProvider
}
```

Make `IntegrationProviderContribution` extend this base and retain its existing external-item
fields. Add a `connectionProviderRegistry` beside the current external-item registry.

The shared public contract should add:

- `model-provider` to `IntegrationProviderKind`;
- `textGeneration?: boolean` to the known `ProviderCapabilities` keys.

Keep provider IDs open strings so later providers do not require a closed union change.

### Model provider

Add a core-only model contract under `apps/desktop/src/core/server/modelProviders/`:

```ts
type GenerateTextInput = {
  system: string
  prompt: string
  modelId?: string
  maxOutputTokens: number
  signal?: AbortSignal
}

type GenerateTextResult = {
  text: string
  providerId: string
  connectionId: string
  modelId: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

type ModelProviderAdapter = {
  providerId: string
  recommendedModelId: string
  generateText(args: {
    secret: string
    config: unknown
    input: GenerateTextInput
  }): Promise<Omit<GenerateTextResult, 'providerId' | 'connectionId'>>
}
```

Do not add provider-specific request fields to the shared contract. If a future feature genuinely
needs structured output, tools, streaming, or multimodal input, add a separately typed capability
instead of growing `GenerateTextInput` into a bag of optional SDK arguments.

### Model runtime

Expose a core server function similar to:

```ts
generateTextForConnection({
  db,
  userId,
  encryptionKey,
  connectionId,
  input,
}): Promise<GenerateTextResult>
```

The runtime must:

1. load the connection by both `userId` and `connectionId`;
2. reject missing, disabled, or `needs-auth` connections;
3. require an adapter registered for the row's provider;
4. require the connection's `textGeneration` capability to be available;
5. decrypt the secret immediately before the provider call;
6. schedule the request through the existing per-provider/per-connection request scheduler;
7. apply a bounded timeout and propagate `AbortSignal`;
8. map authentication, rate-limit, bad-configuration, and unavailable errors to stable
   `ProviderOperationError` codes;
9. mark unreadable/auth-rejected connections `needs-auth` without putting secret or prompt content
   in `lastError`;
10. return safe result metadata and never return or log the key.

There should be no generic Hono route for this runtime. A generic route would let arbitrary renderer
code incur spend and exfiltrate arbitrary content. Each consumer plugin must own an authenticated,
CSRF-protected, domain-specific route and decide what context may leave the machine.

## Implementation plan

### 1. Characterize and extract the generic connection layer

Files:

- Modify `apps/desktop/src/core/server/integrations/types.ts`
- Add `apps/desktop/src/core/server/integrations/connectionRegistry.ts`
- Add `apps/desktop/src/core/server/integrations/connectionRegistry.test.ts`
- Modify `apps/desktop/src/core/server/integrations/registry.ts`
- Modify `apps/desktop/src/core/server/integrations/connections.ts`
- Modify `apps/desktop/src/core/server/integrations/budgetRuntime.ts`
- Modify `apps/desktop/src/core/server/routes/integrations.ts`
- Modify `apps/desktop/src/core/server/publicApi/coreIntegrations.ts`
- Modify `apps/desktop/src/core/shared/integrations.ts`
- Modify `apps/desktop/src/core/shared/api.ts` only if a public type/key version changes

Work:

- Add characterization tests for the current catalog and connection lifecycle before changing
  registry ownership.
- Introduce `ConnectionProviderContribution` and a registry that rejects duplicate provider IDs,
  duplicate credential-field IDs, invalid request budgets, and unsafe public descriptors.
- Keep the current `integrationProviderRegistry` responsible only for external-item behavior and its
  provider-owned routes.
- Register every existing GitHub/Linear/Rollbar descriptor in both registries at the app composition
  root. Add a conformance assertion that each external integration has the same object registered as
  its connection provider.
- Change connection creation, rotation, testing, listing, capability resolution, and the internal
  and public catalog endpoints to resolve providers from `connectionProviderRegistry`.
- Narrow `providerRequestScheduler.run` to the two request concurrency fields it actually consumes,
  so model providers do not invent cache/page/context budgets.
- Keep external reference creation on `integrationProviderRegistry`. If a caller attempts to turn a
  model-provider connection into an external ref, return `provider_bad_config`; do not throw an
  unclassified registry exception.
- Preserve all existing response shapes and encrypted-storage behavior.

Acceptance checks:

- Existing integration provider tests pass unchanged except for intentional registry setup edits.
- GitHub, Linear, and Rollbar remain in the catalog exactly once.
- A connection-only fake provider can be added, tested, summarized, and removed without declaring an
  external ID or mirrored resource.
- That fake provider cannot be used for a task link or external ref.
- No database migration is generated.

### 2. Move generic integration client calls into core ownership

Files:

- Add `apps/desktop/src/core/client/integrations/integrationClient.ts`
- Modify `apps/desktop/src/core/client/settings/IntegrationsSettings.tsx`
- Modify `apps/desktop/src/plugins/github/client/mutations.ts`
- Modify `apps/desktop/src/core/boundaries.test.ts`

Work:

- Move `connectIntegration`, `rotateIntegration`, `testIntegration`, and `deleteIntegration` from the
  GitHub plugin into a core client module beside the core integration queries/contracts.
- Update Settings to import the core client.
- Delete the now-obsolete core-to-GitHub baseline edge for `IntegrationsSettings.tsx`; do not replace
  it with another exemption.
- Do not otherwise reorganize GitHub mutation code.

Acceptance checks:

- The boundary baseline shrinks by one edge.
- The Settings behavior and request bodies are unchanged.

### 3. Add the provider-neutral model registry and runtime

Files:

- Add `apps/desktop/src/core/server/modelProviders/types.ts`
- Add `apps/desktop/src/core/server/modelProviders/registry.ts`
- Add `apps/desktop/src/core/server/modelProviders/registry.test.ts`
- Add `apps/desktop/src/core/server/modelProviders/runtime.ts`
- Add `apps/desktop/src/core/server/modelProviders/runtime.test.ts`

Work:

- Implement a registry keyed by the connection provider ID.
- Reject duplicate adapters and adapters whose matching connection provider is absent or does not
  declare `textGeneration`.
- Implement the model runtime described above.
- Use injected/fake adapters in runtime tests; no test may require a real API key or network access.
- Treat empty provider output as `provider_unavailable` rather than returning a successful empty
  generation.
- Bound `system`, `prompt`, and `maxOutputTokens` inputs at the consuming route as well as enforcing a
  defensive upper bound in the runtime. The runtime should not silently truncate prompts.
- Do not log prompts by default. Error logs may contain provider ID, connection ID, model ID, stable
  error code, and duration only.

Acceptance checks:

- Cross-user connection lookup is indistinguishable from a missing connection.
- Disabled, unreadable, and auth-rejected connections follow the expected state transitions.
- Cancellation and timeout stop the provider request.
- The scheduler limits concurrent calls by both provider and connection.
- Runtime results contain no secret or raw provider response.

### 4. Add the `model-providers` plugin

Files:

- Add `apps/desktop/src/plugins/model-providers/server/openai.ts`
- Add `apps/desktop/src/plugins/model-providers/server/anthropic.ts`
- Add `apps/desktop/src/plugins/model-providers/server/providers.test.ts`
- Modify `apps/desktop/src/app/server/providers.ts`
- Modify `apps/desktop/src/app/main/bootstrap.ts`
- Modify `apps/desktop/package.json`
- Modify `pnpm-lock.yaml`

Work:

- Add the official `openai` and `@anthropic-ai/sdk` packages to the desktop app.
- Export one connection contribution and one model adapter per provider.
- Register their connection contributions in `connectionProviderRegistry` and their adapters in the
  model registry from `app/server/providers.ts`. Do not register them in
  `integrationProviderRegistry`, and do not add provider-owned HTTP routers.
- Give each provider one required password field named `apiKey`.
- Normalize to:
  - encrypted API key as `secret`;
  - provider label as the connection label;
  - no secret-derived account metadata;
  - `textGeneration: available`;
  - only non-secret provider configuration.
- Validate and test credentials with a non-generating model-list request:
  - OpenAI: `GET /v1/models`;
  - Anthropic: `GET /v1/models`.
- Map 401/403 to `provider_needs_auth`, 429 to `provider_rate_limited`, and network/5xx failures to
  `provider_unavailable`.
- Implement OpenAI through the Responses API, set `store: false`, keep instructions separate from
  user input, and aggregate all returned output text rather than assuming the first output item is
  text.
- Implement Anthropic through the Messages API, using the top-level `system` field and a user
  message, then concatenate text content blocks only.
- Keep a provider-owned `recommendedModelId` for the first cut. Pin explicit model IDs and cover them
  with adapter tests; do not choose "the first model returned" from a live catalog.
- Add `{ id: 'model-providers', available: true }` to the boot/public capability list. This signals
  that the plugin is installed, not that a key is connected; consumers must inspect safe connection
  summaries for that.

Official API references to verify again during implementation:

- OpenAI text generation and Responses API:
  <https://developers.openai.com/api/docs/guides/text>
- Anthropic Models list:
  <https://platform.claude.com/docs/en/api/models/list>
- Anthropic Messages API:
  <https://platform.claude.com/docs/en/api/typescript/messages/create>

Acceptance checks:

- Both providers appear in Settings with a password input.
- Saving a key calls a mocked model-list endpoint and persists only encrypted secret material.
- Catalog, connection, error, and public API responses never contain the key.
- Rotating and testing use the new key and update health metadata.
- Provider request tests assert the exact safety-relevant payload shape and stable error mapping.
- Neither provider appears in external source lists or external-provider conformance loops.

### 5. Prove discovery and selection behavior

Files:

- Add or modify a focused test for
  `apps/desktop/src/core/client/settings/IntegrationsSettings.tsx` if the existing client test
  harness supports this component without disproportionate setup
- Add shared/core helper tests where availability filtering is implemented

Work:

- Define model availability as a connection summary where:
  - `status === 'connected'`;
  - `capabilities.textGeneration === 'available'`;
  - the matching public provider has `kind === 'model-provider'`.
- Provide a pure shared or core-client helper for this filtering if more than one consumer would
  otherwise duplicate it. The helper accepts only public summaries; it does not know secrets or
  adapters.
- Preserve the connection ID as the selection value. Provider ID alone is not sufficient because
  the existing schema supports multiple rows for a provider.
- Display provider label plus connection label/account label when a selector is later added. Do not
  expose key prefixes or suffixes as identity.

Acceptance checks:

- No configured provider produces an empty eligible list.
- OpenAI-only, Anthropic-only, and both-configured states produce the expected eligible connection
  IDs.
- Disabled, degraded, `needs-auth`, and capability-missing rows are not eligible.

### 6. Update durable architecture documentation

Files:

- Modify `docs/integrations.md`
- Modify `docs/plugins.md`
- Modify `docs/architecture-overview.md` if its registry summary needs the new distinction
- Modify `docs/next/chat/README.md`
- Modify `docs/next/chat/provider-and-context.md`

Work:

- Document the connection-provider versus external-item versus model-adapter split.
- Document credential scope, encryption, write-only renderer behavior, and safe discovery.
- Show the supported plugin consumption path: client checks safe summaries; authenticated
  feature-owned server route calls the core runtime.
- State explicitly that provider SDKs remain isolated in `plugins/model-providers`.
- Amend the future chat design: reuse app-wide provider connections, while workspace state may store
  a selected connection/model preference. Do not retain a second credential table in that future
  plan.
- Record the future database privacy boundary:
  - schema metadata and the user's natural-language request may be sent;
  - database URLs, credentials, and row contents are not sent by default;
  - generated SQL is inserted into the editor and is never auto-executed.

## Test and verification plan

Run from the repository root:

```bash
pnpm --filter @acorn/desktop test -- \
  src/core/server/integrations \
  src/core/server/modelProviders \
  src/plugins/model-providers
pnpm lint
pnpm test
pnpm --filter @acorn/desktop build
```

Manual verification:

1. Launch Acorn with a valid `SESSION_ENC_KEY`.
2. Open Settings → Integrations.
3. Confirm OpenAI and Anthropic appear and their key fields use password inputs.
4. Add one provider key, close/reopen Settings, and confirm only a safe connected summary remains.
5. Test and rotate the key.
6. Add the other provider and confirm both safe summaries are discoverable.
7. Disable or invalidate one connection and confirm it is not eligible for model use.
8. Disconnect both and confirm no provider-owned source/task-link UI appears.
9. Inspect the local `integrations` row and verify `authRef` is JWE ciphertext and no plaintext key
   appears in other columns.
10. Exercise a temporary test-only core runtime caller or automated adapter test; do not add a
    production generic prompt route for manual testing.

## Risks and mitigations

### Registry extraction changes existing integration plumbing

Risk: a provider could appear in Settings but not in external-source behavior, or vice versa.

Mitigation: characterize existing catalog/lifecycle behavior first; explicitly dual-register
external providers in the composition root; add a conformance cross-check; keep provider IDs and
public response shapes stable.

### Generic runtime could become an accidental data-exfiltration/spend endpoint

Risk: arbitrary renderer code could send local data or create unbounded API spend.

Mitigation: no generic HTTP route; only server-side core API; consuming routes own strict request
schemas, context policy, output limits, and UI intent; runtime has defensive timeout/token bounds.

### Provider APIs and models evolve

Risk: aliases move, payloads differ, or restricted keys cannot list models.

Mitigation: isolate SDK usage in two adapters, pin explicit recommended model IDs, mock payload
contracts, map errors centrally, and verify current official SDK/API documentation during
implementation. If a valid restricted key cannot call the model-list endpoint, stop and decide on a
non-billable validation policy rather than silently making a billable test request.

### Existing multi-connection semantics can create ambiguous labels

Risk: two OpenAI connections both display as "OpenAI".

Mitigation: the data model and runtime always select by opaque connection ID. Before implementation,
decide whether the first UI should allow multiple connections per model provider. If yes, add an
optional user-supplied connection label; if no, enforce one active row per provider in service/UI
logic without adding an irreversible database constraint.

### Old chat documentation diverges

Risk: a future chat implementation reintroduces workspace-scoped duplicate credentials.

Mitigation: update the future design in the same change and distinguish shared credentials from
workspace-level selection/preferences.

## Decisions to confirm before implementation

The recommended defaults are:

1. **Credential scope:** app-wide per authenticated Acorn/GitHub identity, matching the existing
   `integrations.userId`; workspaces store only a selected connection later.
2. **Model selection:** no model picker in this foundation; each adapter owns a pinned,
   balanced/recommended default, and the runtime returns the actual model ID used.
3. **Connection count:** one OpenAI and one Anthropic connection in the first UI, enforced
   reversibly in service/UI code while leaving the multi-row schema unchanged.

If multiple accounts per provider are needed immediately, change decision 3 before implementation
and add an optional connection-name field so future selectors are unambiguous.

## Stop conditions

Stop and reassess rather than expanding scope if:

- connection reuse unexpectedly requires a database migration or weakening encryption;
- the registry split requires any plugin-to-plugin import or a new boundary-test exemption;
- an official SDK cannot run in the Electron main/server Node target;
- credential validation requires a billable generation request;
- implementation would expose a generic generation endpoint to the renderer or public API;
- a real provider key is required for automated tests;
- model/provider selection requirements expand into chat, streaming, or model-catalog UI.

## Completion criteria

- The generic connection lifecycle supports connection-only providers without external-item
  semantics.
- OpenAI and Anthropic keys are manageable through existing Settings and are encrypted/write-only.
- Core exposes a tested provider-neutral, server-only text-generation runtime.
- Other plugins can discover eligible connections from safe summaries and call the runtime without
  importing provider implementations.
- Existing integrations and architectural boundary tests remain green.
- Documentation clearly describes the new extension point and the future database consumer.
- `pnpm lint`, `pnpm test`, and the desktop build pass.

## Git workflow

Stay on the current branch. Do not create a branch, commit, push, or open a pull request unless the
user explicitly requests it.
